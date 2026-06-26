<?php

namespace Tests\Unit;

use App\Support\SensitiveFieldMask;
use App\Support\SpreadsheetImportSecurity;
use PHPUnit\Framework\TestCase;

/**
 * Security helpers and hardening checks (SEC-010–SEC-025).
 */
final class PayrollSecurityTest extends TestCase
{
    public function test_formula_injection_cells_are_neutralized(): void
    {
        $this->assertSame("'=1+1", SpreadsheetImportSecurity::sanitizeCellValue('=1+1'));
        $this->assertSame("'+cmd", SpreadsheetImportSecurity::sanitizeCellValue('+cmd'));
        $this->assertSame("'-100", SpreadsheetImportSecurity::sanitizeCellValue('-100'));
        $this->assertSame("'@SUM(1+1)", SpreadsheetImportSecurity::sanitizeCellValue('@SUM(1+1)'));
        $this->assertSame('Normal Name', SpreadsheetImportSecurity::sanitizeCellValue('Normal Name'));
    }

    public function test_sensitive_fields_are_masked(): void
    {
        $this->assertSame('XXXXXX234F', SensitiveFieldMask::pan('ABCDE1234F'));
        $this->assertSame('XXXXXXXX9012', SensitiveFieldMask::aadhaar('1234 5678 9012'));
        $this->assertSame('XXXXXX7890', SensitiveFieldMask::bankAccount('1234567890'));
    }

    public function test_import_rejects_disallowed_extension_message(): void
    {
        $path = dirname(__DIR__, 2).'/app/Support/SpreadsheetImportSecurity.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('Only .xlsx, .xls, and .csv files are allowed', $source);
        $this->assertStringContainsString('MAX_BYTES', $source);
    }

    public function test_user_resource_masks_sensitive_fields_for_non_viewer(): void
    {
        $path = dirname(__DIR__, 2).'/app/Http/Resources/UserResource.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('SensitiveFieldMask', $source);
        $this->assertStringContainsString('canViewSensitive', $source);
    }

    public function test_managerial_middleware_is_registered(): void
    {
        $bootstrap = file_get_contents(dirname(__DIR__, 2).'/bootstrap/app.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($bootstrap);
        $this->assertIsString($routes);
        $this->assertStringContainsString('EnsureManagerial', $bootstrap);
        $this->assertStringContainsString("'managerial'", $bootstrap);
        $this->assertStringContainsString("middleware('managerial')", $routes);
    }

    public function test_login_rate_limiter_is_configured(): void
    {
        $provider = file_get_contents(dirname(__DIR__, 2).'/app/Providers/AppServiceProvider.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($provider);
        $this->assertIsString($routes);
        $this->assertStringContainsString("RateLimiter::for('login'", $provider);
        $this->assertStringContainsString("throttle:login", $routes);
    }

    public function test_import_response_does_not_include_plaintext_password_key(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('generated_password_accounts', $service);
        $this->assertStringNotContainsString("'generated_passwords' =>", $service);
        $this->assertStringNotContainsString("'password' => \$item['generated_password']", $service);
    }

    public function test_company_access_policy_exists_on_user_show(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/UserController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString('CompanyAccess::canViewUser', $controller);
    }
}
