<?php

namespace Tests\Unit;

use App\Services\PayrollPreflightValidationService;
use PHPUnit\Framework\TestCase;

final class PreflightCpfBasisTest extends TestCase
{
    private function row(array $basis): array
    {
        return ['employeeUserId' => 'e1', 'employeeName' => 'Asha Rao', 'govRecalc' => [
            'grossBasic' => 30000, 'daPercent' => 53, 'hraPercent' => 30, 'medicalFixed' => 0,
            'electricityApplicable' => false, 'electricityMode' => 'manual_fixed',
            'cpfConfig' => ['cpfPercentage' => 12, 'cpfBasisFieldKeys' => $basis, 'cpfCalculationMode' => 'percentage'],
        ]];
    }

    public function test_company_defined_earning_is_a_valid_cpf_basis(): void
    {
        $svc = new PayrollPreflightValidationService;
        $config = ['fields' => [['fieldKey' => 'testfield', 'isActive' => true]]];
        $this->assertTrue($svc->validate([$this->row(['gross_basic', 'testfield'])], $config, null, '2026-09-30')['canCalculate']);
    }

    public function test_unknown_basis_is_reported_by_employee_and_code(): void
    {
        $r = (new PayrollPreflightValidationService)->validate([$this->row(['gross_basic', 'nonsense'])], ['fields' => []], null, '2026-09-30');
        $this->assertFalse($r['canCalculate']);
        $this->assertSame('CPF_BASIS_INVALID', $r['blockingErrors'][0]['code']);
        $this->assertSame('Asha Rao', $r['blockingErrors'][0]['employee']);
    }
}
