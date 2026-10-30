<?php

namespace Tests\Database;

use App\Services\QuarterService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Quarter assignment resolution used by payroll preview, draft and run.
 */
final class QuarterAssignmentTest extends DatabaseTestCase
{
    private function openAssignment(string $company, string $quarter, string $employee, string $from, ?string $to, float $rent): void
    {
        DB::table('cirt_quarter_assignments')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $company, 'quarter_id' => $quarter, 'employee_id' => $employee,
            'assigned_from' => $from, 'assigned_to' => $to, 'rent_at_assignment' => $rent,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array{0: string, 1: string, 2: string, 3: string} company, employee, quarter A, quarter B (employee has no assignment) */
    private function fixtures(): array
    {
        ['company' => $company, 'users' => $users] = $this->sampleEmployees(25);
        $employee = null;
        foreach ($users as $uid) {
            if (! DB::table('cirt_quarter_assignments')->where('employee_id', $uid)->exists()) { $employee = $uid; break; }
        }
        $quarters = DB::table('cirt_quarters')->where('company_id', $company)->limit(2)->pluck('id')->all();
        if ($employee === null || count($quarters) < 2) {
            $this->markTestSkipped('Local database has no unassigned employee / two quarters to test with.');
        }

        return [$company, $employee, (string) $quarters[0], (string) $quarters[1]];
    }

    private function insertOrSkip(callable $insert): void
    {
        try {
            DB::statement('SAVEPOINT s1');
            $insert();
        } catch (\Throwable $e) {
            DB::statement('ROLLBACK TO SAVEPOINT s1');
            $this->markTestSkipped('Database already enforces one open assignment (unique index): '.$e->getMessage());
        }
    }

    public function test_repeated_open_rows_for_the_same_quarter_resolve_to_one_assignment(): void
    {
        [$company, $employee, $quarterA] = $this->fixtures();
        $this->insertOrSkip(function () use ($company, $employee, $quarterA): void {
            $this->openAssignment($company, $quarterA, $employee, '2026-08-01', null, 880);
            $this->openAssignment($company, $quarterA, $employee, '2026-08-05', null, 880);
            $this->openAssignment($company, $quarterA, $employee, '2026-08-09', null, 880);
        });

        $meta = app(QuarterService::class)->quarterMetaForEmployeePeriod($company, $employee, 2026, 9);
        $this->assertTrue($meta['hasQuarter']);
        $this->assertSame($quarterA, $meta['quarterId']);
        $this->assertSame(880.0, $meta['quarterRent']);
    }

    public function test_two_different_quarters_on_the_same_day_is_a_conflict_not_a_guess(): void
    {
        [$company, $employee, $quarterA, $quarterB] = $this->fixtures();
        $this->insertOrSkip(function () use ($company, $employee, $quarterA, $quarterB): void {
            $this->openAssignment($company, $quarterA, $employee, '2026-08-01', null, 880);
            $this->openAssignment($company, $quarterB, $employee, '2026-08-01', null, 500);
        });

        $this->expectException(ValidationException::class);
        app(QuarterService::class)->quarterMetaForEmployeePeriod($company, $employee, 2026, 9);
    }

    public function test_effective_period_boundaries(): void
    {
        [$company, $employee, $quarterA] = $this->fixtures();
        $this->openAssignment($company, $quarterA, $employee, '2026-09-10', '2026-10-15', 700);
        $svc = app(QuarterService::class);

        $this->assertFalse($svc->quarterMetaForEmployeePeriod($company, $employee, 2026, 8)['hasQuarter'], 'before assigned_from');
        $this->assertTrue($svc->quarterMetaForEmployeePeriod($company, $employee, 2026, 9)['hasQuarter'], 'assigned mid-month counts at month end');
        $this->assertFalse($svc->quarterMetaForEmployeePeriod($company, $employee, 2026, 10)['hasQuarter'], 'released before month end');
        $this->assertSame(0.0, $svc->quarterMetaForEmployeePeriod($company, $employee, 2026, 10)['quarterRent']);
        $this->assertFalse($svc->quarterMetaForEmployeePeriod($company, $employee, 2026, 11)['hasQuarter']);
    }
}
