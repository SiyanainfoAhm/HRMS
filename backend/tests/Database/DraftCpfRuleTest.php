<?php

namespace Tests\Database;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Services\PayrollDraftService;
use App\Services\PostPayrollDownloadService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CPF in a draft follows the lines actually PAID (12% of Basic + DA + HRA + Medical + Transport as paid), the rule Run Payroll and
 * Generate use: a quarter holder's HRA is 0, so there is no notional HRA in the basis. Also: the employer-share settings are empty
 * by default and the CPF sheet reads them.
 */
final class DraftCpfRuleTest extends DatabaseTestCase
{
    private const YEAR = 2030;
    private const MONTH = 2;

    /** A quarter holder's draft row whose stored CPF still includes a notional HRA of 12,930 (the old behaviour). */
    private function seedRow(array $grExtra = [], float $storedCpf = 10560.0, array $gmExtra = []): array
    {
        $e = $this->world->employees[0]; // holds an open quarter assignment in the world
        $draft = HrmsPayrollDraft::query()->create([
            'id' => (string) Str::uuid(), 'company_id' => $this->world->company, 'payroll_month' => self::MONTH, 'payroll_year' => self::YEAR,
            'status' => HrmsPayrollDraft::STATUS_DRAFT, 'version' => 1, 'created_by' => $this->world->adminId, 'updated_by' => $this->world->adminId,
        ]);
        // Basic 41,000 + DA 25,830 + HRA 0 (quarter) + Transport 5,868 + Medical 3,000 = 75,698; 12% = 9,084.
        $gm = [
            'basicPaid' => 41000, 'daPaid' => 25830, 'hraPaid' => 0, 'hraActual' => 0, 'medicalPaid' => 3000, 'transportPaid' => 5868, 'hasQuarter' => true,
            'deductions' => ['pt' => 200, 'cpf' => $storedCpf, 'electricity' => 0, 'quarterRent' => 880],
            'totalEarnings' => 75698, 'totalDeductions' => 200 + $storedCpf + 880, 'netSalary' => 75698 - (200 + $storedCpf + 880),
        ];
        $gm = $gmExtra + $gm;
        $payload = [
            'employeeUserId' => $e['id'], 'employeeName' => $e['name'], 'employeeCode' => $e['code'], 'payDays' => 28, 'hasQuarter' => true,
            'grossPay' => 75698, 'deductions' => $gm['totalDeductions'], 'netPay' => $gm['netSalary'], 'governmentMonthly' => $gm,
            'govRecalc' => $grExtra + [
                'grossBasic' => 41000, 'daPercent' => 63, 'hraPercent' => 30, 'medicalFixed' => 3000, 'payLevel' => 10, 'hasQuarter' => true,
                'cpfConfig' => ['source' => 'company', 'cpfPercentage' => 12, 'cpfFixedAmount' => 0, 'cpfCalculationMode' => 'percentage',
                    'cpfBasisFieldKeys' => ['gross_basic', 'da', 'hra', 'medical', 'transport']],
                'deductionDefaults' => ['electricity' => 0], 'deductionPaidOverrides' => [],
            ],
        ];
        $row = HrmsPayrollDraftEmployee::query()->create([
            'id' => (string) Str::uuid(), 'payroll_draft_id' => $draft->id, 'employee_user_id' => $e['id'], 'employee_code' => $e['code'],
            'payroll_master_id' => $e['master'], 'pay_days' => 28, 'gross_pay' => 75698, 'total_earnings' => 75698,
            'total_deductions' => $gm['totalDeductions'], 'net_pay' => $gm['netSalary'], 'row_payload' => $payload, 'version' => 1,
        ]);

        return [$draft, $row];
    }

    public function test_a_quarter_holders_draft_cpf_is_12_percent_of_the_paid_lines(): void
    {
        $this->seedRow();
        $employees = app(PayrollDraftService::class)->getDraft($this->world->company, self::YEAR, self::MONTH)['employees'];
        $gm = $employees[0]['rowPayload']['governmentMonthly'];

        $this->assertSame(0.0, (float) $gm['hraPaid'], 'no HRA is paid to a quarter holder');
        $this->assertEquals(9084, $gm['deductions']['cpf'], 'CPF = 12% of 75,698, not of 75,698 + notional HRA');
        $rent = (float) $gm['deductions']['quarterRent']; // the Quarters master rent, authoritative
        $this->assertEquals(200 + 9084 + $rent, $gm['totalDeductions'], 'Total Deductions follow the CPF');
        $this->assertEquals(75698 - (200 + 9084 + $rent), $gm['netSalary'], 'Net follows too');
    }

    public function test_a_typed_cpf_is_left_alone(): void
    {
        $this->seedRow(['cpfManualOverride' => true]);
        $gm = app(PayrollDraftService::class)->getDraft($this->world->company, self::YEAR, self::MONTH)['employees'][0]['rowPayload']['governmentMonthly'];
        $this->assertEquals(10560, $gm['deductions']['cpf'], 'a manual CPF override is never re-derived');
    }

    public function test_repair_reports_old_to_new_and_only_writes_when_applied(): void
    {
        [, $row] = $this->seedRow();
        $svc = app(PayrollDraftService::class);

        $dry = $svc->repairStoredDraftCpf($this->world->company, $row, false);
        $this->assertTrue($dry['changed']);
        $this->assertEquals([10560, 9084], [$dry['before']['cpf'], $dry['after']['cpf']]);
        $this->assertEquals(1476, $dry['before']['totalDeductions'] - $dry['after']['totalDeductions'], 'Total Deductions fall by the CPF difference (1,476)');
        $this->assertEquals(10560, $row->fresh()->row_payload['governmentMonthly']['deductions']['cpf'], 'a dry run writes nothing');

        $svc->repairStoredDraftCpf($this->world->company, $row, true, $this->world->adminId, 'test');
        $stored = $row->fresh();
        $this->assertEquals(9084, $stored->row_payload['governmentMonthly']['deductions']['cpf']);
        $this->assertEquals(2, (int) $stored->version, 'row version bumped');
        $this->assertSame(1, DB::table('cirt_payroll_draft_audits')->where('payroll_draft_id', $row->payroll_draft_id)->count(), 'one audit entry');

        $again = $svc->repairStoredDraftCpf($this->world->company, $stored, false);
        $this->assertFalse($again['changed'], 'idempotent: a second run changes nothing');
    }

    public function test_tr_arrears_paid_go_into_the_basis_and_cpf_is_rounded_up(): void
    {
        // CIRT rule (confirmed against FoxPro): with TR arrears paid, CPF = 12% of (paid lines + TR arrears), rounded UP.
        $this->seedRow([], 10560.0, ['transportArrearsPaid' => 324]);
        $gm = app(PayrollDraftService::class)->getDraft($this->world->company, self::YEAR, self::MONTH)['employees'][0]['rowPayload']['governmentMonthly'];
        $this->assertEquals((int) ceil((75698 + 324) * 0.12), $gm['deductions']['cpf'], '12% of 76,022 = 9,122.64 -> 9,123');
        $this->assertEquals(9123, $gm['deductions']['cpf']);
    }

    public function test_employer_share_settings_are_empty_by_default_and_the_sheet_reads_them(): void
    {
        $svc = new PostPayrollDownloadService;
        $this->assertNull($svc->employerShareRule($this->world->company), 'no rule until the CPF Trust rule is decided');

        DB::table('cirt_payroll_calculation_settings')->where('company_id', $this->world->company)
            ->update(['pension_percentage' => 8.33, 'pension_wage_ceiling' => 15000, 'employer_contribution_percentage' => 3.67]);
        $rule = $svc->employerShareRule($this->world->company);
        $this->assertEquals(['pensionPercentage' => 8.33, 'pensionWageCeiling' => 15000.0, 'employerContributionPercentage' => 3.67], $rule);

        // Clearing the percentages turns the rule off again.
        DB::table('cirt_payroll_calculation_settings')->where('company_id', $this->world->company)
            ->update(['pension_percentage' => null, 'employer_contribution_percentage' => null]);
        $this->assertNull($svc->employerShareRule($this->world->company));
    }
}
