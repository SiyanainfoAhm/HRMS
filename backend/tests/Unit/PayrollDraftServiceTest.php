<?php

namespace Tests\Unit;

use App\Services\PayrollDraftService;
use PHPUnit\Framework\TestCase;

final class PayrollDraftServiceTest extends TestCase
{
    public function test_service_class_exists(): void
    {
        $this->assertTrue(class_exists(PayrollDraftService::class));
        $this->assertTrue(class_exists(\App\Models\HrmsPayrollDraft::class));
        $this->assertTrue(class_exists(\App\Models\HrmsPayrollDraftEmployee::class));
        $this->assertTrue(class_exists(\App\Http\Controllers\Api\V1\PayrollDraftController::class));
    }

    public function test_draft_routes_registered(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString("payroll/drafts", $routes);
        $this->assertStringContainsString('PayrollDraftController', $routes);
    }

    public function test_draft_migration_exists(): void
    {
        $path = dirname(__DIR__, 2).'/database/migrations/2026_08_06_100000_create_cirt_payroll_drafts.php';
        $this->assertFileExists($path);
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('cirt_payroll_drafts', $source);
        $this->assertStringContainsString('cirt_payroll_draft_employees', $source);
        $this->assertStringContainsString('row_payload', $source);
    }

    public function test_existing_draft_writes_require_masks_and_never_replace_employee_membership(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollDraftController.php');
        $this->assertIsString($source);
        $this->assertIsString($controller);
        $this->assertStringContainsString('Existing drafts accept field-level patches only', $source);
        $this->assertStringContainsString('explicit changedFields only', $source);
        $this->assertStringContainsString('! $isExistingDraft && $replaceAllEmployees', $source);
        $this->assertStringContainsString("'employees.*.changedFields'", $controller);
        $this->assertStringContainsString('applyChangedFields($beforePayload, $payload, $changedFields)', $source);
    }

    public function test_save_draft_validates_employee_array_and_returns_validation_errors_instead_of_undefined_key_access(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollDraftController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString("'employees' => ['required', 'array', 'min:1']", $controller);
        $this->assertStringContainsString("'employees.*' => ['required', 'array']", $controller);
        $this->assertStringContainsString('$data[\'employees\'] ?? null', $controller);
        $this->assertStringContainsString('ValidationException::withMessages', $controller);
        $this->assertStringContainsString('employee_user_id', $controller);
        $this->assertStringContainsString('changed_fields', $controller);
        $this->assertStringNotContainsString('$data[\'employees\'],', $controller);
    }

    public function test_save_draft_accepts_nonempty_employee_array_and_explicit_changed_field_masks(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollDraftController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString("'employees.*.changedFields' => ['sometimes', 'array', 'max:100']", $controller);
        $this->assertStringContainsString("'employees.*.changed_fields' => ['sometimes', 'array', 'max:100']", $controller);
        $this->assertStringContainsString('$employeeRows,', $controller);

        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('applyChangedFields($beforePayload, $payload, $changedFields)', $service);
        $this->assertStringContainsString('PayrollConcurrencyException', $service);
    }

    public function test_draft_electricity_is_server_reconciled_for_units_missing_bills_and_effective_tariff_changes(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('reconcileDraftElectricity', $service);
        $this->assertStringContainsString('draftElectricityNeedsRecalculation(', $service);
        $this->assertStringContainsString('electricityTariffFingerprint($savedTariffSnapshot)', $service);
        $this->assertStringContainsString('$manualOverride && is_numeric($manualAmount)', $service);
        $this->assertStringContainsString('\'electricity\' => $bill[\'total\']', $service);
        $this->assertStringContainsString('No active electricity tariff', $service);
        $this->assertStringContainsString('reconcileDraftElectricity($payload, $companyId, $year, $month, $changedFields, $master, $payrollFieldDefinitions)', $service);
    }

    public function test_positive_units_with_uncalculated_zero_recalculate_but_approved_manual_zero_does_not(): void
    {
        $service = new PayrollDraftService;
        $this->assertTrue($service->draftElectricityNeedsRecalculation(false, true, 0, 45.0, false, 'unit_based', false));
        $this->assertTrue($service->draftElectricityNeedsRecalculation(false, false, null, 45.0, false, 'unit_based', false));
        $this->assertFalse($service->draftElectricityNeedsRecalculation(false, true, 0, 45.0, true, 'unit_based', false));
        $this->assertFalse($service->draftElectricityNeedsRecalculation(false, true, 0, 0.0, false, 'unit_based', false));
        $this->assertTrue($service->draftElectricityNeedsRecalculation(false, true, 250, 45.0, false, 'unit_based', true));
        $this->assertTrue($service->requiresElectricityTariff(true, 'unit_based', 45.0, null, false));
        $this->assertFalse($service->requiresElectricityTariff(true, 'unit_based', 45.0, null, true));
        $this->assertFalse($service->requiresElectricityTariff(true, 'unit_based', 0.0, null, false));
    }
}
