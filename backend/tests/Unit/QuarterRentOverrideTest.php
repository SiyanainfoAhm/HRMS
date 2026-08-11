<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use App\Services\QuarterService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/** Quarter assignment + effective rent (nullish 0) for Payroll Master / Run Payroll. */
final class QuarterRentOverrideTest extends TestCase
{
    public function test_resolve_effective_master_quarter_rent_nullish_zero(): void
    {
        $service = $this->quarterServiceWithoutBoot();

        $this->assertSame(300.0, $service->resolveEffectiveMasterQuarterRent(null, 300.0));
        $this->assertSame(300.0, $service->resolveEffectiveMasterQuarterRent('', 300.0));
        $this->assertSame(450.0, $service->resolveEffectiveMasterQuarterRent(450, 300.0));
        $this->assertSame(0.0, $service->resolveEffectiveMasterQuarterRent(0, 300.0));
        $this->assertSame(0.0, $service->resolveEffectiveMasterQuarterRent('0', 300.0));
        $this->assertSame(500.0, $service->resolveEffectiveMasterQuarterRent('500', 300.0));
    }

    public function test_payroll_calc_keeps_explicit_zero_quarter_rent(): void
    {
        $calc = (new PayrollCalculationService)->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => true,
            'quarter_rent' => 0,
        ]);

        $this->assertSame(0.0, $calc['quarter_rent']);
        $this->assertSame(0.0, $calc['hra_amount']);
        $this->assertTrue($calc['has_quarter']);
    }

    public function test_payroll_calc_uses_manual_override_rent(): void
    {
        $calc = (new PayrollCalculationService)->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => true,
            'quarter_rent' => 450,
        ]);

        $this->assertSame(450.0, $calc['quarter_rent']);
    }

    public function test_payroll_calc_unassigned_quarter_rent_is_zero(): void
    {
        $calc = (new PayrollCalculationService)->calculateMaster([
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
            'has_quarter' => false,
            'quarter_rent' => 450,
        ]);

        $this->assertSame(0.0, $calc['quarter_rent']);
        $this->assertFalse($calc['has_quarter']);
        $this->assertSame(14400.0, $calc['hra_amount']);
    }

    public function test_list_for_employee_form_does_not_filter_available_only(): void
    {
        $src = file_get_contents(dirname(__DIR__, 2).'/app/Services/QuarterService.php');
        $this->assertIsString($src);

        $start = strpos($src, 'function listForEmployeeForm');
        $this->assertNotFalse($start);
        $end = strpos($src, 'function create', $start);
        $this->assertNotFalse($end);
        $method = substr($src, $start, $end - $start);

        $this->assertStringContainsString("where('status', '!=', 'inactive')", $method);
        $this->assertStringNotContainsString("where('status', 'available')", $method);
    }

    private function quarterServiceWithoutBoot(): QuarterService
    {
        $ref = new ReflectionClass(QuarterService::class);

        return $ref->newInstanceWithoutConstructor();
    }
}
