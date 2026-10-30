<?php

namespace Tests\Database;

use App\Services\PayrollDraftService;
use App\Support\PayrollTotals;
use Illuminate\Support\Facades\DB;

/**
 * Frontend payload -> PHP service -> DB -> load: every saved value must come back
 * exactly, patches must touch only the named field, and employees/periods must be
 * isolated from each other.
 */
final class DraftRoundTripTest extends DatabaseTestCase
{
    private const YEAR = 2031;
    private const MONTH = 1;

    private function row(string $userId, array $gmExtra = [], array $grExtra = []): array
    {
        $gm = array_merge([
            'basicPaid' => 34590, 'daPaid' => 18332.7, 'transportPaid' => 3600, 'hraPaid' => 0, 'hraActual' => 0,
            'daArrearsPaid' => 1000, 'transportArrearsPaid' => 200, 'grossArrear' => 1200, 'cpfArrear' => 144, 'netArrear' => 1056,
            'electricityUnitsConsumed' => 80, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
            'deductions' => ['pt' => 200, 'cpf' => 5000, 'electricity' => 49, 'water' => 314, 'mess' => 25, 'quarterRent' => 0],
            'totalEarnings' => 57922.7, 'totalDeductions' => 5588, 'netSalary' => 52334.7,
        ], $gmExtra);
        $gr = array_merge([
            'grossBasic' => 34590, 'daPercent' => 53, 'hraPercent' => 30, 'payLevel' => 10,
            'electricityUnitsConsumed' => 80, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
            'electricityManualOverride' => false, 'deductionDefaults' => ['electricity' => 49, 'water' => 314, 'mess' => 25],
            'deductionPaidOverrides' => [],
        ], $grExtra);

        return [
            'employeeUserId' => $userId, 'payDays' => 30, 'daArrear' => 1000, 'transportArrear' => 200, 'grossArrear' => 1200,
            'cpfArrear' => 144, 'netArrear' => 1056,
            'grossPay' => 57922.7, 'deductions' => 5588, 'netPay' => 52334.7,
            'governmentMonthly' => $gm, 'govRecalc' => $gr,
        ];
    }

    private function service(): PayrollDraftService
    {
        return app(PayrollDraftService::class);
    }

    private function actor(string $company): string
    {
        return (string) DB::table('cirt_users')->where('company_id', $company)->value('id');
    }

    /** @return array<string, array<string, mixed>> keyed by employee user id */
    private function loaded(string $company, int $month = self::MONTH): array
    {
        $out = [];
        foreach ($this->service()->getDraft($company, self::YEAR, $month)['employees'] as $e) {
            $out[(string) $e['employeeUserId']] = $e;
        }

        return $out;
    }

    public function test_full_save_then_load_keeps_units_arrears_and_typed_values_exactly(): void
    {
        ['company' => $company, 'users' => [$a, $b]] = $this->sampleEmployees();

        $saved = $this->service()->saveDraft($company, self::YEAR, self::MONTH, $this->actor($company), [$this->row($a), $this->row($b)], null, true);
        $this->assertSame(2, $saved['saved']);

        $loaded = $this->loaded($company);
        foreach ([$a, $b] as $uid) {
            $payload = $loaded[$uid]['rowPayload'];
            $gm = $payload['governmentMonthly'];
            $this->assertEquals(80, $gm['electricityUnitsConsumed'], 'units survive');
            $this->assertEquals(1000, $gm['daArrearsPaid'], 'DA arrear survives');
            $this->assertEquals(200, $gm['transportArrearsPaid'], 'TR arrear survives');
            $this->assertEquals(1200, $gm['grossArrear'], 'gross arrear survives');
            $this->assertEquals(314, $gm['deductions']['water'], 'typed water survives');
            $this->assertEquals(25, $gm['deductions']['mess'], 'typed mess survives');
            $this->assertNotEquals(49, $gm['deductions']['electricity'], 'units 80 must not be billed at the master default 49');
            $this->assertSame('unit_based', $payload['govRecalc']['electricityMode']);
            $this->assertSame([], PayrollTotals::reconcile($gm), 'gross - deductions = net and components add up');
        }
        // DB columns match the payload (no truncation / type change).
        $dbRow = DB::table('cirt_payroll_draft_employees as e')
            ->join('cirt_payroll_drafts as d', 'd.id', '=', 'e.payroll_draft_id')
            ->where('d.company_id', $company)->where('d.payroll_year', self::YEAR)->where('d.payroll_month', self::MONTH)
            ->where('d.status', 'draft')->where('e.employee_user_id', $a)->first();
        $this->assertEquals(30, $dbRow->pay_days);
        $this->assertEquals(1200, $dbRow->total_arrears);
        $this->assertEqualsWithDelta((float) $loaded[$a]['rowPayload']['governmentMonthly']['netSalary'], (float) $dbRow->net_pay, 0.01);
    }

    public function test_patch_changes_only_the_named_field_and_never_leaks_to_other_employees_or_periods(): void
    {
        ['company' => $company, 'users' => [$a, $b]] = $this->sampleEmployees();
        $actor = $this->actor($company);
        $first = $this->service()->saveDraft($company, self::YEAR, self::MONTH, $actor, [$this->row($a), $this->row($b)], null, true);
        $version = $first['draft']['version'];
        $before = $this->loaded($company);

        // Stale full row from the browser: every other field is zero. Only mess was edited.
        $stale = $this->row($a, ['daArrearsPaid' => 0, 'grossArrear' => 0, 'electricityUnitsConsumed' => 0]);
        $stale['governmentMonthly']['deductions'] = ['pt' => 0, 'cpf' => 0, 'electricity' => 0, 'water' => 0, 'mess' => 0, 'quarterRent' => 0];
        $stale['changedFields'] = ['govDeduction_mess'];
        $this->service()->saveDraft($company, self::YEAR, self::MONTH, $actor, [$stale], $version, false);

        $after = $this->loaded($company);
        $gmA = $after[$a]['rowPayload']['governmentMonthly'];
        $this->assertEquals(0, $gmA['deductions']['mess'], 'the edited field changed (explicit 0)');
        $this->assertEquals(314, $gmA['deductions']['water'], 'unedited water kept');
        $this->assertEquals(80, $gmA['electricityUnitsConsumed'], 'unedited units kept');
        $this->assertEquals(1000, $gmA['daArrearsPaid'], 'unedited arrear kept');
        $this->assertEquals(
            $before[$a]['rowPayload']['governmentMonthly']['deductions']['electricity'],
            $gmA['deductions']['electricity'],
            'electricity not reset by a mess edit',
        );
        $this->assertSame([], PayrollTotals::reconcile($gmA));
        $this->assertEquals($before[$b]['rowPayload'], $after[$b]['rowPayload'], 'other employee untouched');

        $this->assertSame([], $this->loaded($company, self::MONTH + 1), 'another period has no draft');
    }

    public function test_stale_version_is_rejected_not_silently_overwritten(): void
    {
        ['company' => $company, 'users' => [$a]] = $this->sampleEmployees(1);
        $actor = $this->actor($company);
        $first = $this->service()->saveDraft($company, self::YEAR, self::MONTH, $actor, [$this->row($a)], null, true);
        $patch = $this->row($a);
        $patch['changedFields'] = ['govDeduction_mess'];
        $this->service()->saveDraft($company, self::YEAR, self::MONTH, $actor, [$patch], $first['draft']['version'], false);
        $this->expectException(\App\Exceptions\PayrollConcurrencyException::class);
        $this->service()->saveDraft($company, self::YEAR, self::MONTH, $actor, [$patch], $first['draft']['version'], false);
    }
}
