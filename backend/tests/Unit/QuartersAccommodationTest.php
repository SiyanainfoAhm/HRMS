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

    public function test_active_assignment_table_drives_period_resolution_and_master_sync(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/QuarterService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString("protected \$table = 'cirt_quarter_assignments'", file_get_contents(dirname(__DIR__, 2).'/app/Models/HrmsQuarterAssignment.php'));
        $this->assertStringContainsString('quarterMetaForEmployeePeriod', $source);
        $this->assertStringContainsString('Multiple quarter assignments are active', $source);
        $this->assertStringContainsString('syncCurrentPayrollMasterQuarter', $source);
        $this->assertStringContainsString("'has_quarter' => \$assigned", $source);
        $this->assertStringContainsString("'hraEligible' => false", $source);
    }

    public function test_preview_uses_period_assignment_and_generated_rows_use_saved_quarter_snapshot(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php');
        $this->assertIsString($source);
        $this->assertStringContainsString('quarterMetaForEmployeePeriod(', $source);
        $this->assertStringContainsString('Generated payroll is a historical snapshot', $source);
        $this->assertStringContainsString("'quarterId' => \$gov->quarter_id", $source);
        $this->assertStringContainsString("'quarterRent' => (float) (\$gov->quarter_rent_amount ?? 0)", $source);
    }

    public function test_master_display_and_repair_script_are_authoritative_and_dry_run_by_default(): void
    {
        $masterSource = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');
        $script = file_get_contents(dirname(__DIR__, 2).'/scripts/repair-cirt-quarter-payroll-sync.php');
        $migration = file_get_contents(dirname(__DIR__, 2).'/database/migrations/2026_10_30_120000_add_unique_open_quarter_assignment_indexes.php');
        $this->assertIsString($masterSource);
        $this->assertIsString($script);
        $this->assertIsString($migration);
        $this->assertStringContainsString("...\$this->quarterService->quarterMetaForMaster", $masterSource);
        $this->assertStringContainsString("if (! \$apply)", $script);
        $this->assertStringContainsString("already has generated payroll records", $script);
        $this->assertStringContainsString('Multiple active quarters overlap', $script);
        $this->assertStringContainsString('DB::transaction', $script);
        $this->assertStringContainsString('COUNT(*) > 1', $migration);
        $this->assertStringContainsString('cirt_quarter_assignment_one_open_per_employee', $migration);
    }
}
