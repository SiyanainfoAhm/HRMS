<?php

namespace Tests\Database;

use App\Services\QuarterService;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Payroll rent for a month = quarter's live monthly rent for the assignments that OVERLAP
 * that month (inclusive dates), prorated by occupied days and summed. Never today-based,
 * never read from rent_at_assignment or the Payroll Master mirror.
 */
final class QuarterPayrollRentTest extends DatabaseTestCase
{
    private function svc(): QuarterService
    {
        return app(QuarterService::class);
    }

    /** Open assignments on active quarters that started well before Oct 2026. */
    private function settledAssignments(): array
    {
        return DB::table('cirt_quarter_assignments as a')
            ->join('cirt_quarters as q', 'q.id', '=', 'a.quarter_id')
            ->whereNull('a.assigned_to')->where('q.status', '!=', 'inactive')
            ->whereDate('a.assigned_from', '<=', '2026-09-30')
            ->get(['a.employee_id', 'a.quarter_id', 'q.company_id', 'q.quarter_name', 'q.quarter_type', 'q.monthly_rent'])->all();
    }

    /** @return array{0: string, 1: string, 2: string, 3: string} company, employee without assignments, quarter A, quarter B (rents set to 3000 / 6000) */
    private function sandbox(): array
    {
        ['company' => $company, 'users' => $users] = $this->sampleEmployees(40);
        $employee = null;
        foreach ($users as $uid) {
            if (! DB::table('cirt_quarter_assignments')->where('employee_id', $uid)->exists()) { $employee = $uid; break; }
        }
        $quarters = DB::table('cirt_quarters')->where('company_id', $company)->where('status', '!=', 'inactive')->limit(2)->pluck('id')->all();
        if ($employee === null || count($quarters) < 2) {
            $this->markTestSkipped('Local database has no unassigned employee / two active quarters to test with.');
        }
        // Every active quarter is normally occupied and the DB allows one open assignment per
        // quarter, so close the current occupants (rolled back with the test transaction).
        DB::table('cirt_quarter_assignments')->whereIn('quarter_id', $quarters)->whereNull('assigned_to')->update(['assigned_to' => DB::raw('assigned_from')]);
        DB::table('cirt_quarters')->where('id', $quarters[0])->update(['monthly_rent' => 3000]);
        DB::table('cirt_quarters')->where('id', $quarters[1])->update(['monthly_rent' => 6000]);

        return [$company, $employee, (string) $quarters[0], (string) $quarters[1]];
    }

    private function assign(string $company, string $employee, string $quarter, string $from, ?string $to): void
    {
        DB::table('cirt_quarter_assignments')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $company, 'quarter_id' => $quarter, 'employee_id' => $employee,
            'assigned_from' => $from, 'assigned_to' => $to, 'rent_at_assignment' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_october_rent_equals_quarters_master_for_every_assignment_that_overlaps_october(): void
    {
        $rows = $this->settledAssignments();
        if ($rows === []) {
            $this->markTestSkipped('No open quarter assignments in the local database.');
        }
        $total = 0.0;
        foreach ($rows as $r) {
            $meta = $this->svc()->quarterMetaForDraft((string) $r->company_id, (string) $r->employee_id, 2026, 10);
            $this->assertTrue($meta['hasQuarter'], "{$r->quarter_name} must be charged");
            $this->assertSame((string) $r->quarter_id, $meta['quarterId']);
            $this->assertSame($r->quarter_name, $meta['quarterName']);
            $this->assertNotSame('', (string) $meta['quarterType']);
            $this->assertSame((float) $r->monthly_rent, $meta['quarterRent'], "{$r->quarter_name} rent");
            $total += $meta['quarterRent'];
        }
        $this->assertSame((float) array_sum(array_map(fn ($r) => (float) $r->monthly_rent, $rows)), $total);
    }

    public function test_stale_cached_rent_on_assignment_and_master_is_ignored(): void
    {
        $r = $this->settledAssignments()[0] ?? $this->markTestSkipped('No open quarter assignments.');
        DB::table('cirt_quarter_assignments')->where('quarter_id', $r->quarter_id)->whereNull('assigned_to')->update(['rent_at_assignment' => 1650]);
        DB::table('cirt_payroll_master')->where('employee_user_id', $r->employee_id)->whereNull('effective_to')
            ->update(['quarter_rent' => 1000, 'has_quarter' => false, 'quarter_id' => null]);

        $meta = $this->svc()->quarterMetaForDraft((string) $r->company_id, (string) $r->employee_id, 2026, 10);
        $this->assertTrue($meta['hasQuarter']);
        $this->assertSame((float) $r->monthly_rent, $meta['quarterRent']);
    }

    public function test_inactive_quarter_never_deducts(): void
    {
        $r = $this->settledAssignments()[0] ?? $this->markTestSkipped('No open quarter assignments.');
        DB::table('cirt_quarters')->where('id', $r->quarter_id)->update(['status' => 'inactive']);

        $meta = $this->svc()->quarterMetaForDraft((string) $r->company_id, (string) $r->employee_id, 2026, 10);
        $this->assertFalse($meta['hasQuarter']);
        $this->assertSame(0.0, $meta['quarterRent']);
    }

    public function test_assigned_after_month_end_is_not_charged(): void
    {
        [$company, $employee, $quarterA] = $this->sandbox();
        $this->assign($company, $employee, $quarterA, '2026-11-03', null);

        $october = $this->svc()->quarterMetaForDraft($company, $employee, 2026, 10);
        $this->assertFalse($october['hasQuarter']);
        $this->assertSame(0.0, $october['quarterRent']);

        $this->assertSame(Money::proportion(3000, 28, 30), $this->svc()->quarterMetaForDraft($company, $employee, 2026, 11)['quarterRent'], 'November: 3rd..30th = 28 days');
    }

    public function test_vacated_mid_month_is_prorated_with_inclusive_end_date(): void
    {
        [$company, $employee, $quarterA] = $this->sandbox();
        $this->assign($company, $employee, $quarterA, '2026-08-01', '2026-10-14');

        $october = $this->svc()->quarterMetaForDraft($company, $employee, 2026, 10);
        $this->assertTrue($october['hasQuarter']);
        $this->assertSame(14, $october['occupiedDays']);
        $this->assertSame(Money::proportion(3000, 14, 31), $october['quarterRent']);
        $this->assertSame(1355.0, $october['quarterRent'], '3000 x 14 / 31 = 1354.84 -> 1355');
        $this->assertSame(3000.0, $this->svc()->quarterMetaForDraft($company, $employee, 2026, 9)['quarterRent'], 'full month while occupied');
        $this->assertFalse($this->svc()->quarterMetaForDraft($company, $employee, 2026, 11)['hasQuarter'], 'vacated before November');
    }

    public function test_past_month_draft_uses_that_months_assignments_and_two_in_one_month_are_summed(): void
    {
        [$company, $employee, $quarterA, $quarterB] = $this->sandbox();
        $this->assign($company, $employee, $quarterA, '2026-08-01', '2026-09-15');
        $this->assign($company, $employee, $quarterB, '2026-09-16', null);

        $august = $this->svc()->quarterMetaForDraft($company, $employee, 2026, 8);
        $this->assertSame($quarterA, $august['quarterId'], 'August is judged by August, not by today\'s assignment');
        $this->assertSame(3000.0, $august['quarterRent']);

        $september = $this->svc()->quarterMetaForDraft($company, $employee, 2026, 9);
        $this->assertSame(Money::proportion(3000, 15, 30) + Money::proportion(6000, 15, 30), $september['quarterRent']);
        $this->assertSame(4500.0, $september['quarterRent']);
        $this->assertSame(30, $september['occupiedDays']);

        $october = $this->svc()->quarterMetaForDraft($company, $employee, 2026, 10);
        $this->assertSame($quarterB, $october['quarterId']);
        $this->assertSame(6000.0, $october['quarterRent']);
    }
}
