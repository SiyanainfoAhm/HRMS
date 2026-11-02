<?php

namespace Tests\Database;

use App\Exceptions\PayrollConcurrencyException;
use App\Services\PayrollDraftService;
use App\Support\PayrollTotals;
use Illuminate\Support\Facades\DB;

/**
 * Server half of the 409 regression: a patch sent with a stale draft version is
 * refused (409) without touching anything; the same patch re-sent against the latest
 * version keeps the user's units/electricity/water/arrears, leaves mess alone, and
 * keeps what the other session saved.
 */
final class DraftConflictRetryTest extends DatabaseTestCase
{
    private const YEAR = 2031;
    private const MONTH = 3;

    private function row(string $uid, array $gm = [], array $extra = []): array
    {
        return array_merge([
            'employeeUserId' => $uid, 'payDays' => 30, 'daArrear' => 0, 'transportArrear' => 0, 'grossArrear' => 0, 'incentive' => 0,
            'grossPay' => 57000.0, 'deductions' => 388.0, 'netPay' => 56612.0,
            'governmentMonthly' => array_merge([
                'basicPaid' => 34590, 'daPaid' => 18332.7, 'transportPaid' => 3600, 'hraPaid' => 0, 'hraActual' => 0,
                'daArrearsPaid' => 0, 'transportArrearsPaid' => 0, 'grossArrear' => 0,
                'electricityUnitsConsumed' => 0, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
                'deductions' => ['electricity' => 49, 'water' => 314, 'mess' => 25],
                'totalEarnings' => 56522.7, 'totalDeductions' => 388, 'netSalary' => 56134.7,
            ], $gm),
            'govRecalc' => [
                'grossBasic' => 34590, 'daPercent' => 53, 'hraPercent' => 30, 'payLevel' => 10,
                'electricityUnitsConsumed' => 0, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
                'electricityManualOverride' => false, 'deductionDefaults' => ['electricity' => 49, 'water' => 314, 'mess' => 25],
                'deductionPaidOverrides' => [],
            ],
        ], $extra);
    }

    public function test_stale_version_409_then_retry_keeps_units_electricity_water_mess_and_arrears(): void
    {
        ['company' => $company, 'users' => [$a, $b]] = $this->sampleEmployees();
        $actor = (string) DB::table('cirt_users')->where('company_id', $company)->value('id');
        $svc = app(PayrollDraftService::class);

        $v1 = $svc->saveDraft($company, self::YEAR, self::MONTH, $actor, [$this->row($a), $this->row($b)], null, true)['draft']['version'];

        // The user (browser 1) types units 80, water 400 and a DA arrear of 1000 on a copy of the row.
        $mine = $this->row($a, [
            'electricityUnitsConsumed' => 80, 'deductions' => ['electricity' => 98, 'water' => 400, 'mess' => 25],
            'daArrearsPaid' => 1000, 'grossArrear' => 1000,
        ], ['daArrear' => 1000, 'grossArrear' => 1000]);
        $mine['govRecalc']['electricityUnitsConsumed'] = 80;
        $mine['changedFields'] = ['electricityUnitsConsumed', 'govDeduction_water', 'daArrear'];

        // Meanwhile a second session saves an unrelated field (incentive) on the same employee.
        $other = $this->row($a, [], ['incentive' => 500]);
        $other['changedFields'] = ['incentive'];
        $v2 = $svc->saveDraft($company, self::YEAR, self::MONTH, $actor, [$other], $v1, false)['draft']['version'];
        $this->assertGreaterThan($v1, $v2);

        // 1. Browser 1 still holds v1: refused, and nothing is written.
        $before = json_encode(DB::table('cirt_payroll_draft_employees as e')->join('cirt_payroll_drafts as d', 'd.id', '=', 'e.payroll_draft_id')
            ->where('d.company_id', $company)->where('d.payroll_year', self::YEAR)->where('d.payroll_month', self::MONTH)->where('d.status', 'draft')
            ->orderBy('e.employee_user_id')->pluck('e.row_payload'));
        try {
            $svc->saveDraft($company, self::YEAR, self::MONTH, $actor, [$mine], $v1, false);
            $this->fail('a stale version must be refused');
        } catch (PayrollConcurrencyException $e) {
            $this->assertSame($v2, (int) $e->currentRevision, 'the conflict carries the latest version');
        }
        $after = json_encode(DB::table('cirt_payroll_draft_employees as e')->join('cirt_payroll_drafts as d', 'd.id', '=', 'e.payroll_draft_id')
            ->where('d.company_id', $company)->where('d.payroll_year', self::YEAR)->where('d.payroll_month', self::MONTH)->where('d.status', 'draft')
            ->orderBy('e.employee_user_id')->pluck('e.row_payload'));
        $this->assertSame($before, $after, 'the refused save changed nothing');

        // 2. The retry: same patch, latest version.
        $svc->saveDraft($company, self::YEAR, self::MONTH, $actor, [$mine], $v2, false);
        $saved = null;
        foreach ($svc->getDraft($company, self::YEAR, self::MONTH)['employees'] as $emp) {
            if ((string) $emp['employeeUserId'] === $a) $saved = $emp['rowPayload'];
        }
        $this->assertNotNull($saved);
        $gm = $saved['governmentMonthly'];
        $this->assertEquals(80, $gm['electricityUnitsConsumed'], 'units survive');
        $this->assertNotEquals(49, $gm['deductions']['electricity'], 'electricity follows the units, not the old 49');
        $this->assertEquals(400, $gm['deductions']['water'], 'typed water survives');
        $this->assertEquals(25, $gm['deductions']['mess'], 'mess (not touched) is unchanged');
        $this->assertEquals(1000, $saved['daArrear'], 'arrear survives');
        $this->assertEquals(1000, $gm['daArrearsPaid'], 'the DA arrear line survives and reaches gross');
        $this->assertEquals(500, $saved['incentive'], "the other session's change survives the retry");
        $this->assertSame([], PayrollTotals::reconcile($gm), 'gross - deductions = net still holds');
    }
}
