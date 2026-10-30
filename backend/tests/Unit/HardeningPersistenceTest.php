<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

final class HardeningPersistenceTest extends TestCase
{
    public function test_activity_log_is_company_scoped_and_does_not_store_plain_passwords(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/ActivityLogService.php');
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/ActivityLogController.php');
        $migration = file_get_contents(dirname(__DIR__, 2).'/database/migrations/2026_10_27_100000_create_cirt_activity_logs.php');
        $this->assertIsString($service);
        $this->assertIsString($controller);
        $this->assertIsString($migration);
        $this->assertStringContainsString("'password'", $service);
        $this->assertStringContainsString("where('company_id'", $controller);
        $this->assertStringContainsString("'cirt_activity_company_time_idx'", $migration);
        $this->assertStringContainsString('append-only', strtolower($migration));
    }

    public function test_activity_log_api_filters_and_lazy_details_are_company_scoped_and_redacted(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/ActivityLogController.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $proxy = file_get_contents(dirname(__DIR__, 3).'/src/app/api/activity-logs/route.ts');
        $detailProxy = file_get_contents(dirname(__DIR__, 3).'/src/app/api/activity-logs/[id]/route.ts');

        $this->assertStringContainsString("'category' => ['sometimes', 'in:payroll,security,administration']", $controller);
        $this->assertStringContainsString("'outcome' => ['sometimes', 'in:succeeded,failed']", $controller);
        $this->assertStringContainsString("where('company_id', (string) \$request->user()->company_id)", $controller);
        $this->assertStringContainsString("preg_match('/password|token|secret|credential|account|ifsc|bank|email|phone/i'", $controller);
        $this->assertStringContainsString("Route::get('activity-logs/{id}'", $routes);
        $this->assertStringContainsString('requireAdmin: true', $proxy);
        $this->assertStringContainsString('requireAdmin: true', $detailProxy);
        $this->assertStringContainsString("'changeClassificationSource' =>", $controller);
        $this->assertStringContainsString('if ($direct !== [])', file_get_contents(dirname(__DIR__, 2).'/app/Services/ActivityLogService.php'));
    }

    public function test_fresh_payroll_preview_initializes_leave_fields_for_the_requested_month(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php');
        $this->assertStringContainsString("'hplDays' => 0", $controller);
        $this->assertStringContainsString("'eolDays' => 0", $controller);
        $this->assertStringContainsString("'leaveRemarks' => null", $controller);
        $this->assertStringContainsString("'eolReferenceMonth' => \$month", $controller);
        $this->assertStringContainsString("'eolReferenceYear' => \$year", $controller);
        $this->assertStringContainsString("'hplReferenceMonth' => \$month", $controller);
        $this->assertStringContainsString("'hplReferenceYear' => \$year", $controller);
        $this->assertStringContainsString("if (! \$existingPeriod || ! HrmsPayslip::where('payroll_period_id', \$existingPeriod->id)->exists())", $controller);
    }

    public function test_payroll_edit_lease_serializes_competing_writes_and_checks_expiry(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollEditLockService.php');
        $middleware = file_get_contents(dirname(__DIR__, 2).'/app/Http/Middleware/RequirePayrollEditLock.php');
        $migration = file_get_contents(dirname(__DIR__, 2).'/database/migrations/2026_10_27_110000_create_cirt_payroll_edit_locks.php');
        $this->assertStringContainsString('pg_advisory_xact_lock', $service);
        $this->assertStringContainsString('expires_at?->isFuture()', $service);
        $this->assertStringContainsString('PAYROLL_EDIT_LOCK_LOST', $middleware);
        $this->assertStringContainsString("'cirt_payroll_edit_lock_owner_unique'", $migration);
    }

    public function test_draft_write_and_reset_require_matching_versions_for_existing_drafts(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertStringContainsString('$expectedVersion === null', $service);
        $this->assertStringContainsString("(int) \$draft->version !== (int) \$expectedVersion", $service);
        $this->assertStringContainsString('lockForUpdate()', $service);
        $this->assertStringContainsString('expectedVersion', $service);
    }

    public function test_employee_payslip_route_is_self_scoped_and_manager_payslip_view_is_gated(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayslipController.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertStringContainsString("buildPayslipsResponse(\$user->company_id, \$user->id)", $controller);
        $this->assertStringContainsString("if (! \$auth->role?->isManagerial())", $controller);
        $this->assertStringContainsString("Route::get('payslips/me'", $routes);
        $this->assertStringContainsString("Route::get('payslips/employee'", $routes);
    }

    public function test_cross_month_draft_uniqueness_includes_company_year_and_month(): void
    {
        $migration = file_get_contents(dirname(__DIR__, 2).'/database/migrations/2026_08_06_100000_create_cirt_payroll_drafts.php');
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertStringContainsString("['company_id', 'payroll_year', 'payroll_month']", $migration);
        $this->assertStringContainsString("->where('payroll_year', \$year)", $service);
        $this->assertStringContainsString("->where('payroll_month', \$month)", $service);
    }
}
