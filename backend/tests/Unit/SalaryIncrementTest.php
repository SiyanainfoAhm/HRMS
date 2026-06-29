<?php

namespace Tests\Unit;

use App\Support\IncrementMonth;
use PHPUnit\Framework\TestCase;

/** INC-006, INC-008 — salary increment calculation and month normalization */
final class SalaryIncrementTest extends TestCase
{
    public function test_calculate_new_gross_basic_rounds_to_nearest_rupee(): void
    {
        $this->assertSame(49440.0, IncrementMonth::calculateNewGrossBasic(48000, 3));
        $this->assertSame(49200.0, IncrementMonth::calculateNewGrossBasic(48000, 2.5));
    }

    public function test_normalize_increment_month_case_insensitive(): void
    {
        foreach (['jan', 'january', 'JANUARY', 'Jan'] as $raw) {
            $this->assertSame(IncrementMonth::JANUARY, IncrementMonth::normalize($raw));
        }
        foreach (['jul', 'july', 'JULY', 'Jul'] as $raw) {
            $this->assertSame(IncrementMonth::JULY, IncrementMonth::normalize($raw));
        }
        $this->assertNull(IncrementMonth::normalize('March'));
        $this->assertNull(IncrementMonth::normalize(''));
    }

    public function test_default_effective_dates(): void
    {
        $this->assertSame('2026-01-01', IncrementMonth::defaultEffectiveDate('January', 2026));
        $this->assertSame('2026-07-01', IncrementMonth::defaultEffectiveDate('July', 2026));
    }

    public function test_effective_date_must_match_increment_month(): void
    {
        $this->assertTrue(IncrementMonth::effectiveDateMatchesMonth('July', '2026-07-01'));
        $this->assertFalse(IncrementMonth::effectiveDateMatchesMonth('July', '2026-06-01'));
        $this->assertTrue(IncrementMonth::effectiveDateMatchesMonth('January', '2026-01-15'));
        $this->assertFalse(IncrementMonth::effectiveDateMatchesMonth('January', '2026-07-01'));
    }

    public function test_payroll_master_import_template_includes_increment_month(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('Increment Month*', $source);
        $this->assertStringContainsString('increment_month', $source);
        $this->assertStringContainsString('Increment Month is required.', $source);
        $this->assertStringContainsString('Increment month must be January or July.', $source);
    }

    public function test_salary_increment_service_and_apis_exist(): void
    {
        $this->assertFileExists(dirname(__DIR__, 2).'/app/Services/SalaryIncrementService.php');
        $this->assertFileExists(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/SalaryIncrementController.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString('settings/salary-increment/eligible', $routes);
        $this->assertStringContainsString('settings/salary-increment/apply', $routes);
        $this->assertStringContainsString('settings/salary-increment/history', $routes);
    }

    public function test_revise_master_soft_closes_instead_of_delete(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('Soft-close the superseded row so cirt_monthly_payroll FK references remain valid.', $source);
        $this->assertStringNotContainsString('$master->delete();', $source);
    }

    public function test_duplicate_increment_message_format(): void
    {
        $msg = IncrementMonth::duplicateMessage('July', 2026);
        $this->assertStringContainsString('July 2026', $msg);
    }
}
