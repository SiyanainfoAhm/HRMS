<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use App\Support\PayrollFieldRegistry;
use PHPUnit\Framework\TestCase;

final class EmployeeCpfOverrideTest extends TestCase
{
    private PayrollCalculationService $calc;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calc = new PayrollCalculationService;
    }

    public function test_custom_fixed_zero_does_not_fall_through_to_percentage(): void
    {
        $result = $this->calc->calculateMaster(
            [
                'pay_level' => 10,
                'gross_basic_pay' => 90000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS,
                'cpf_calculation_mode' => 'fixed_amount',
                'cpf_fixed_amount' => 0,
            ],
        );

        $this->assertSame(0.0, (float) $result['cpf_effective']);
    }

    public function test_custom_fixed_five_hundred(): void
    {
        $result = $this->calc->calculateMaster(
            [
                'pay_level' => 10,
                'gross_basic_pay' => 90000,
                'cpf_default' => 0,
            ],
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => ['gross_basic'],
                'cpf_calculation_mode' => 'fixed_amount',
                'cpf_fixed_amount' => 500,
            ],
        );

        $this->assertSame(500.0, (float) $result['cpf_effective']);
    }

    public function test_custom_fixed_matches_explicit_amount(): void
    {
        $result = $this->calc->calculateMaster(
            [
                'pay_level' => 10,
                'gross_basic_pay' => 90000,
                'cpf_default' => 0,
            ],
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => ['gross_basic'],
                'cpf_calculation_mode' => 'fixed_amount',
                'cpf_fixed_amount' => 22262,
            ],
        );

        $this->assertSame(22262.0, (float) $result['cpf_effective']);
    }

    public function test_institute_percentage_when_company_mode(): void
    {
        $result = $this->calc->calculateMaster(
            [
                'pay_level' => 10,
                'gross_basic_pay' => 100000,
                'da_percent' => 0,
                'hra_percent' => 0,
                'medical' => 0,
                'cpf_default' => 0,
                'transport_base' => 0,
                'transport_da' => 0,
                'transport_total' => 0,
            ],
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => ['gross_basic'],
                'cpf_calculation_mode' => 'percentage',
                'cpf_fixed_amount' => 0,
            ],
        );

        $this->assertSame(12000.0, (float) $result['cpf_effective']);
    }

    public function test_switch_fixed_zero_then_percentage_uses_basis(): void
    {
        $fixedZero = $this->calc->calculateMaster(
            ['pay_level' => 1, 'gross_basic_pay' => 100000, 'cpf_default' => 0, 'da_percent' => 0, 'hra_percent' => 0, 'medical' => 0, 'transport_total' => 0],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic'], 'cpf_calculation_mode' => 'fixed_amount', 'cpf_fixed_amount' => 0],
        );
        $pct = $this->calc->calculateMaster(
            ['pay_level' => 1, 'gross_basic_pay' => 100000, 'cpf_default' => 0, 'da_percent' => 0, 'hra_percent' => 0, 'medical' => 0, 'transport_total' => 0],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic'], 'cpf_calculation_mode' => 'percentage', 'cpf_fixed_amount' => 0],
        );

        $this->assertSame(0.0, (float) $fixedZero['cpf_effective']);
        $this->assertSame(12000.0, (float) $pct['cpf_effective']);
    }

    public function test_nullable_float_zero_preserved_in_merge_source(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString("cpf_fixed_amount", $source);
        $this->assertStringContainsString('max(0, (float)', $source);
        // Must not use truthy ?: null for fixed amount
        $this->assertStringNotContainsString('cpf_fixed_amount ?: null', $source);
        $this->assertStringNotContainsString('cpfFixedAmount ?: null', $source);
    }

    public function test_formula_preview_fixed_zero(): void
    {
        $preview = PayrollFieldRegistry::cpfFormulaPreview([], 12, 'fixed_amount', 0);
        $this->assertStringContainsString('Fixed Amount', $preview);
        $this->assertStringContainsString('0', $preview);
    }
}
