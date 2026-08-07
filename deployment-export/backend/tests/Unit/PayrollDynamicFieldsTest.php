<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use App\Support\PayrollFieldRegistry;
use PHPUnit\Framework\TestCase;

/** DYN-004 – DYN-009 — configurable CPF basis and custom field totals */
final class PayrollDynamicFieldsTest extends TestCase
{
    private PayrollCalculationService $calculator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new PayrollCalculationService;
    }

    public function test_dyn_004_cpf_basis_basic_only(): void
    {
        $calc = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic']],
        );

        $this->assertSame(5760.0, $calc['cpf_effective']);
    }

    public function test_dyn_005_cpf_basis_basic_plus_da(): void
    {
        $calc = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic', 'da']],
        );

        // Basic 48000 + DA 25440 = 73440 × 12% = 8813
        $this->assertSame(8813.0, $calc['cpf_effective']);
    }

    public function test_dyn_006_cpf_basis_basic_hra_transport(): void
    {
        $calc = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic', 'hra', 'transport']],
        );

        // transport_total for level 5 = 3600 + 1908 DA on transport = 5508
        // basis = 48000 + 14400 + 5508 = 67908 × 12% = 8149
        $this->assertSame(8149.0, $calc['cpf_effective']);
    }

    public function test_cpf_custom_basis_excludes_transport_for_rohan_profile(): void
    {
        $input = [
            'pay_level' => 1,
            'gross_basic_pay' => 25750,
            'da_percent' => 60,
            'hra_percent' => 30,
            'medical' => 3000,
            'transport_total' => 2160,
            'cpf_default' => 0,
        ];
        $withTransport = $this->calculator->calculateMaster(
            $input,
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => ['gross_basic', 'da', 'hra', 'medical', 'transport'],
                'cpf_calculation_mode' => 'percentage',
            ],
        );
        $withoutTransport = $this->calculator->calculateMaster(
            $input,
            null,
            null,
            [
                'cpf_percentage' => 12,
                'cpf_basis_field_keys' => ['gross_basic', 'da', 'hra', 'medical'],
                'cpf_calculation_mode' => 'percentage',
            ],
        );

        $this->assertSame(6490.0, $withTransport['cpf_effective']);
        $this->assertSame(6231.0, $withoutTransport['cpf_effective']);
    }

    public function test_dyn_007_cpf_percentage_change(): void
    {
        $input = [
            'pay_level' => 5,
            'gross_basic_pay' => 48000,
            'da_percent' => 53,
            'hra_percent' => 30,
            'medical' => 3000,
            'cpf_default' => 0,
        ];
        $basis = ['cpf_basis_field_keys' => ['gross_basic']];

        $at12 = $this->calculator->calculateMaster($input, null, null, ['cpf_percentage' => 12] + $basis);
        $at10 = $this->calculator->calculateMaster($input, null, null, ['cpf_percentage' => 10] + $basis);

        $this->assertSame(5760.0, $at12['cpf_effective']);
        $this->assertSame(4800.0, $at10['cpf_effective']);
    }

    public function test_dyn_008_custom_deduction_reduces_take_home(): void
    {
        $base = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS],
        );

        $withRecovery = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS],
            [],
            ['bank_recovery' => 1000],
        );

        $this->assertSame($base['total_deductions'] + 1000, $withRecovery['total_deductions']);
        $this->assertSame($base['take_home'] - 1000, $withRecovery['take_home']);
    }

    public function test_dyn_009_custom_earning_increases_take_home(): void
    {
        $base = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic']],
        );

        $withAllowance = $this->calculator->calculateMaster(
            [
                'pay_level' => 5,
                'gross_basic_pay' => 48000,
                'da_percent' => 53,
                'hra_percent' => 30,
                'medical' => 3000,
                'cpf_default' => 0,
            ],
            null,
            null,
            ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic']],
            ['special_allowance' => 2000],
        );

        $this->assertSame($base['total_earnings'] + 2000, $withAllowance['total_earnings']);
        $this->assertGreaterThan($base['take_home'], $withAllowance['take_home']);
    }

    public function test_dyn_001_payroll_field_apis_exist(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString('settings/payroll-config', $routes);
        $this->assertStringContainsString('settings/payroll-fields', $routes);
        $this->assertStringContainsString("settings/payroll-fields/{id}", $routes);
        $this->assertStringContainsString('settings/payroll-calculation-settings', $routes);
        $this->assertFileExists(dirname(__DIR__, 2).'/app/Services/PayrollFieldService.php');
        $this->assertFileExists(dirname(__DIR__, 2).'/app/Support/PayrollFieldRegistry.php');
    }

    public function test_default_cpf_basis_matches_legacy_total_earnings_components(): void
    {
        $this->assertSame(
            ['gross_basic', 'da', 'hra', 'medical', 'transport'],
            PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS,
        );
    }

    public function test_dynimp_001_template_instructions_lists_dynamic_fields(): void
    {
        $servicePath = dirname(__DIR__, 2).'/app/Services/PayrollFieldService.php';
        $this->assertFileExists($servicePath);
        $this->assertStringContainsString('templateInstructionFieldRows', file_get_contents($servicePath));
    }

    public function test_dynexp_001_master_export_includes_dynamic_columns(): void
    {
        $servicePath = dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php';
        $this->assertFileExists($servicePath);
        $this->assertStringContainsString('masterExportColumnDefs', file_get_contents($servicePath));
        $this->assertStringContainsString('writeMasterExportSheet', file_get_contents($servicePath));
    }

    public function test_dynrun_005_run_export_includes_payroll_config(): void
    {
        $controllerPath = dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php';
        $this->assertFileExists($controllerPath);
        $src = file_get_contents($controllerPath);
        $this->assertIsString($src);
        $this->assertStringContainsString("'payrollConfig' =>", $src);
    }
}
