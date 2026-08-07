<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Single-organization CIRT deployment checks (ORG-001–ORG-012).
 */
final class OrganizationModeTest extends TestCase
{
    public function test_org_001_login_page_has_no_company_selector_or_signup(): void
    {
        $login = file_get_contents(dirname(__DIR__, 3).'/src/app/auth/login/page.tsx');
        $this->assertIsString($login);
        $this->assertStringContainsString('Email address', $login);
        $this->assertStringContainsString('Password', $login);
        $this->assertStringNotContainsString('/auth/signup', $login);
        $this->assertStringNotContainsString('company', strtolower($login));
    }

    public function test_org_002_signup_disabled_on_frontend_and_api(): void
    {
        $signup = file_get_contents(dirname(__DIR__, 3).'/src/app/auth/signup/page.tsx');
        $auth = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/AuthController.php');
        $this->assertIsString($signup);
        $this->assertIsString($auth);
        $this->assertStringContainsString('Signup is disabled', $signup);
        $this->assertStringContainsString('Signup is disabled. Please contact administrator.', $auth);
        $this->assertStringContainsString('allow_public_signup', $auth);
    }

    public function test_org_003_fixed_organization_display_in_branding(): void
    {
        $branding = file_get_contents(dirname(__DIR__, 3).'/src/lib/appBranding.ts');
        $sidebar = file_get_contents(dirname(__DIR__, 3).'/src/components/Sidebar.tsx');
        $this->assertIsString($branding);
        $this->assertIsString($sidebar);
        $this->assertStringContainsString('CIRT Payroll', $branding);
        $this->assertStringContainsString("ORGANIZATION_NAME = \"CIRT\"", $branding);
        $this->assertStringContainsString('FIXED_ORG_BRANDING', $sidebar);
    }

    public function test_org_004_admin_cannot_rename_organization_in_settings(): void
    {
        $settings = file_get_contents(dirname(__DIR__, 3).'/src/app/(app)/settings/role-settings.tsx');
        $companyController = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/CompanyController.php');
        $this->assertIsString($settings);
        $this->assertIsString($companyController);
        $this->assertStringContainsString('Fixed for this CIRT Payroll deployment', $settings);
        $this->assertStringNotContainsString('Institute name', $settings);
        $this->assertStringContainsString("unset(\$payload['name'], \$payload['code'])", $companyController);
        $this->assertStringContainsString('organization_name_editable', $companyController);
    }

    public function test_org_005_default_company_service_exists(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/DefaultCompanyService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('function getDefaultCompany', $service);
        $this->assertStringContainsString('function getDefaultCompanyId', $service);
        $this->assertStringContainsString('ensureUserOnDefaultCompany', $service);
    }

    public function test_org_006_import_template_has_no_company_column(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');
        $this->assertIsString($service);
        $this->assertStringNotContainsString("'Company ID'", $service);
        $this->assertStringNotContainsString("'Company Name'", $service);
    }

    public function test_org_007_company_id_tampering_is_ignored(): void
    {
        $context = file_get_contents(dirname(__DIR__, 2).'/app/Support/CompanyContext.php');
        $middleware = file_get_contents(dirname(__DIR__, 2).'/app/Http/Middleware/EnsureCirtCompanyContext.php');
        $this->assertIsString($context);
        $this->assertIsString($middleware);
        $this->assertStringContainsString('withoutUntrustedCompanyId', $context);
        $this->assertStringContainsString('ensureUserOnDefaultCompany', $middleware);
    }

    public function test_org_008_company_access_keeps_managerial_checks(): void
    {
        $access = file_get_contents(dirname(__DIR__, 2).'/app/Support/CompanyAccess.php');
        $this->assertIsString($access);
        $this->assertStringContainsString('belongsToDefaultCompany', $access);
        $this->assertStringContainsString('isManagerial', $access);
    }

    public function test_org_009_employee_self_access_checks_remain(): void
    {
        $access = file_get_contents(dirname(__DIR__, 2).'/app/Support/CompanyAccess.php');
        $employee = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/EmployeeController.php');
        $this->assertIsString($access);
        $this->assertIsString($employee);
        $this->assertStringContainsString('user_id === $viewer->id', $access);
        $this->assertStringContainsString('CompanyAccess', $employee);
    }

    public function test_org_010_migration_backfills_company_linked_tables(): void
    {
        $migration = file_get_contents(dirname(__DIR__, 2).'/database/migrations/2026_07_20_100000_ensure_default_cirt_company_and_backfill.php');
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/DefaultCompanyService.php');
        $this->assertIsString($migration);
        $this->assertIsString($service);
        $this->assertStringContainsString('backfillCompanyIdOnTables', $migration);
        $this->assertStringContainsString('cirt_payroll_master', $service);
        $this->assertStringContainsString('cirt_monthly_payroll', $service);
    }

    public function test_org_011_export_does_not_expose_company_id_column(): void
    {
        $payrollExport = file_get_contents(dirname(__DIR__, 3).'/src/lib/payrollExcelExport.ts');
        $masterService = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');
        $this->assertIsString($payrollExport);
        $this->assertIsString($masterService);
        $this->assertStringNotContainsString('company_id', $payrollExport);
        $this->assertStringNotContainsString('Company ID', $masterService);
        $this->assertStringNotContainsString('Company Name', $masterService);
    }

    public function test_org_012_setup_company_route_removed_from_login_flow(): void
    {
        $layout = file_get_contents(dirname(__DIR__, 3).'/src/app/(app)/layout.tsx');
        $login = file_get_contents(dirname(__DIR__, 3).'/src/app/auth/login/page.tsx');
        $setup = file_get_contents(dirname(__DIR__, 3).'/src/app/setup/company/page.tsx');
        $this->assertIsString($layout);
        $this->assertIsString($login);
        $this->assertIsString($setup);
        $this->assertStringNotContainsString('/setup/company', $layout);
        $this->assertStringNotContainsString('/setup/company', $login);
        $this->assertStringContainsString('redirect("/settings")', $setup);
    }

    public function test_cirt_company_middleware_registered_on_api_routes(): void
    {
        $bootstrap = file_get_contents(dirname(__DIR__, 2).'/bootstrap/app.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($bootstrap);
        $this->assertIsString($routes);
        $this->assertStringContainsString('EnsureCirtCompanyContext', $bootstrap);
        $this->assertStringContainsString("'cirt.company'", $bootstrap);
        $this->assertStringContainsString("'cirt.company'", $routes);
    }
}
