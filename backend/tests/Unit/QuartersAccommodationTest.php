<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use PHPUnit\Framework\TestCase;

/** QTR-004 / QTR-005 — quarter assignment affects HRA and quarter rent deduction */
final class QuartersAccommodationTest extends TestCase
{
    private PayrollCalculationService $calculator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new PayrollCalculationService;
    }

    public function test_qtr_005_hra_calculated_without_quarter(): void
    {
        $calc = $this->calculator->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => false,
        ]);

        $this->assertSame(14400.0, $calc['hra_amount']);
    }

    public function test_qtr_004_hra_zero_and_quarter_rent_deducted_with_quarter(): void
    {
        $without = $this->calculator->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => false,
        ]);

        $with = $this->calculator->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => true,
            'quarter_rent' => 1200,
        ]);

        $this->assertSame(0.0, $with['hra_amount']);
        $this->assertSame(1200.0, $with['quarter_rent']);
        $this->assertSame(14400.0, $without['hra_amount']);
        $this->assertTrue($with['has_quarter']);
        $this->assertFalse($without['has_quarter']);
    }

    public function test_qtr_001_quarters_api_routes_exist(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString('settings/quarters', $routes);
        $this->assertFileExists(dirname(__DIR__, 2).'/app/Services/QuarterService.php');
    }
}
