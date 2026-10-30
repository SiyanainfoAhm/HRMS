<?php

namespace Tests\Unit;

use App\Services\PayrollPreflightValidationService;
use PHPUnit\Framework\TestCase;

class PayrollPreflightValidationServiceTest extends TestCase
{
    private function validRow(): array
    {
        return ['employeeUserId' => 'e-1', 'employeeName' => 'CIRT Employee', 'customFieldValues' => [
            'telephone_allowance' => '500', 'gpf' => '100',
        ], 'govRecalc' => [
            'grossBasic' => 50000, 'daPercent' => 58, 'hraPercent' => 18, 'medicalFixed' => 3000,
            'electricityApplicable' => false, 'electricityMode' => 'unit_based', 'transportTotal' => 5688,
            'cpfConfig' => ['cpfPercentage' => 12, 'cpfBasisFieldKeys' => ['gross_basic', 'da'], 'cpfCalculationMode' => 'percentage'],
            'customEarnings' => ['telephone_allowance' => 500], 'earningPaidOverrides' => [],
        ]];
    }

    public function test_valid_master_passes_preflight(): void
    {
        $result = (new PayrollPreflightValidationService)->validate([$this->validRow()], [], null, '2026-10-31');
        $this->assertTrue($result['canCalculate']);
        $this->assertSame(0, $result['blockingErrorCount']);
    }

    public function test_unit_based_electricity_without_tariff_blocks_employee_but_zero_units_are_allowed(): void
    {
        $row = $this->validRow();
        $row['govRecalc']['electricityApplicable'] = true;
        $row['govRecalc']['electricityUnitsConsumed'] = 0;
        $result = (new PayrollPreflightValidationService)->validate([$row], [], null, '2026-10-31');
        $this->assertFalse($result['canCalculate']);
        $this->assertSame(['ELECTRICITY_TARIFF_REQUIRED'], array_column($result['blockingErrors'], 'code'));
    }

    public function test_quarter_resident_can_keep_hra_entitlement_when_payable_hra_is_zero(): void
    {
        $row = $this->validRow();
        $row['govRecalc']['hasQuarter'] = true;
        $row['govRecalc']['hraPercent'] = 30; // Payroll Master entitlement.
        $row['govRecalc']['hraPaid'] = 0; // Effective payable HRA for this run.

        $result = (new PayrollPreflightValidationService)->validate([$row], [], null, '2026-10-31');

        $this->assertTrue($result['canCalculate']);
        $this->assertSame([], $result['blockingErrors']);
    }

    public function test_quarter_resident_with_non_zero_payable_hra_is_blocked(): void
    {
        $row = $this->validRow();
        $row['govRecalc']['hasQuarter'] = true;
        $row['govRecalc']['hraPercent'] = 30;
        $row['govRecalc']['hraPaid'] = 15000;

        $result = (new PayrollPreflightValidationService)->validate([$row], [], null, '2026-10-31');

        $this->assertFalse($result['canCalculate']);
        $this->assertSame(['HRA_QUARTER_CONFLICT'], array_column($result['blockingErrors'], 'code'));
    }

    public function test_non_quarter_employee_with_normal_hra_passes(): void
    {
        $row = $this->validRow();
        $row['govRecalc']['hraPaid'] = 15000;

        $result = (new PayrollPreflightValidationService)->validate([$row], [], null, '2026-10-31');

        $this->assertTrue($result['canCalculate']);
    }

    public function test_cpf_policy_and_component_duplication_are_not_silently_accepted(): void
    {
        $row = $this->validRow();
        $row['govRecalc']['cpfConfig']['cpfPercentage'] = 101;
        $row['govRecalc']['cpfConfig']['cpfBasisFieldKeys'] = ['invented_basis'];
        $row['govRecalc']['customEarnings']['education_allowance'] = 10;
        $row['govRecalc']['earningPaidOverrides']['educationAllowancePaid'] = 10;
        $result = (new PayrollPreflightValidationService)->validate([$row], [], null, '2026-10-31');
        $this->assertSame(['CPF_RATE_INVALID', 'CPF_BASIS_INVALID', 'COMPONENT_DUPLICATED'], array_column($result['blockingErrors'], 'code'));
    }

    public function test_saved_rows_must_reconcile_before_new_run_is_written(): void
    {
        $service = new PayrollPreflightValidationService;
        $this->assertCount(1, $service->validateCalculatedRows([['employeeUserId' => 'e-1', 'grossPay' => 100, 'deductions' => 20, 'netPay' => 79]]));
        $this->assertSame([], $service->validateCalculatedRows([['employeeUserId' => 'e-1', 'grossPay' => 100, 'deductions' => 20, 'netPay' => 80]]));
    }

    public function test_source_contains_reusable_effective_date_and_export_guards(): void
    {
        $root = dirname(__DIR__, 2);
        $fields = file_get_contents($root.'/app/Services/PayrollFieldService.php');
        $exports = file_get_contents($root.'/app/Services/EmployeePayrollExportService.php');
        $this->assertStringContainsString("'one_time'", $fields);
        $this->assertStringContainsString('effective_from', $fields);
        $this->assertStringContainsString('Residential accommodation metadata is output-only', $exports);
    }
}
