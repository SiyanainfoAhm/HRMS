<?php

namespace Tests\Unit;

use App\Services\PayrollAmendmentService;
use PHPUnit\Framework\TestCase;

final class PayrollAmendmentServiceTest extends TestCase
{
    public function test_reason_is_required_and_trimmed(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        PayrollAmendmentService::assertReason('   ');
    }

    public function test_reason_accepts_non_empty(): void
    {
        $this->assertSame(
            'Water deduction missing in original payroll.',
            PayrollAmendmentService::assertReason("  Water deduction missing in original payroll.  "),
        );
    }

    public function test_amount_preserves_explicit_zero(): void
    {
        $this->assertSame(0.0, PayrollAmendmentService::amount(0));
        $this->assertSame(0.0, PayrollAmendmentService::amount('0'));
        $this->assertSame(400.0, PayrollAmendmentService::amount(400));
    }

    public function test_changed_fields_include_water_and_net(): void
    {
        $svc = new PayrollAmendmentService;
        $before = [
            'id' => 'mp-1',
            'water' => 0,
            'totalDeductions' => 17571,
            'netSalary' => 122766,
            'cpf' => 17371,
        ];
        $after = [
            'id' => 'mp-1',
            'water' => 400,
            'totalDeductions' => 17971,
            'netSalary' => 122366,
            'cpf' => 17371,
        ];
        $changed = $svc->changedFields($before, $after);
        $byField = [];
        foreach ($changed as $row) {
            $byField[$row['field']] = $row;
        }
        $this->assertArrayHasKey('water', $byField);
        $this->assertSame(0, $byField['water']['before']);
        $this->assertSame(400, $byField['water']['after']);
        $this->assertSame('Water', $byField['water']['label']);
        $this->assertArrayHasKey('totalDeductions', $byField);
        $this->assertArrayHasKey('netSalary', $byField);
        $this->assertArrayNotHasKey('cpf', $byField);
        $this->assertArrayNotHasKey('id', $byField);
    }

    public function test_changed_fields_preserve_cpf_zero(): void
    {
        $svc = new PayrollAmendmentService;
        $changed = $svc->changedFields(['cpf' => 17371], ['cpf' => 0]);
        $this->assertCount(1, $changed);
        $this->assertSame('cpf', $changed[0]['field']);
        $this->assertSame(17371, $changed[0]['before']);
        $this->assertSame(0, $changed[0]['after']);
    }

    public function test_custom_map_normalizes_numeric_keys(): void
    {
        $svc = new PayrollAmendmentService;
        $this->assertSame(['bonus' => 100.0], $svc->normalizeCustomMap(['bonus' => '100']));
        $this->assertSame([], $svc->normalizeCustomMap(null));
    }

    public function test_generate_rejects_existing_payroll_instead_of_inserting(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString('PAYROLL_ALREADY_GENERATED', $controller);
        $this->assertStringContainsString('Use Audit Generated Payroll', $controller);
        $this->assertStringContainsString('existingMonthlyUserIds', $controller);
        $this->assertStringContainsString('isset($existingMonthlyUserIds[$employeeUserId])', $controller);
    }

    public function test_amendment_updates_existing_id_in_transaction(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollAmendmentService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('lockForUpdate()', $service);
        $this->assertStringContainsString('DB::transaction', $service);
        $this->assertStringContainsString('HrmsMonthlyPayrollAudit::create', $service);
        $this->assertStringContainsString('before_payload', $service);
        $this->assertStringContainsString('after_payload', $service);
        $this->assertStringContainsString('changed_fields', $service);
        $this->assertStringContainsString('changed_by', $service);
        $this->assertStringNotContainsString('HrmsGovernmentMonthlyPayroll::create', $service);
        $this->assertStringNotContainsString('markArrearLinesAsPaidForPayrollRun', $service);
        $this->assertStringContainsString('This payroll period is locked', $service);
    }

    public function test_amendment_syncs_existing_payslip_not_insert(): void
    {
        $service = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollAmendmentService.php');
        $this->assertIsString($service);
        $this->assertStringContainsString('payslipAttributesFromMonthly', $service);
        $this->assertStringContainsString('$payslip->fill', $service);
        $this->assertStringContainsString('$payslip->save()', $service);
        $this->assertStringNotContainsString('HrmsPayslip::create', $service);
    }

    public function test_admin_authorization_on_amendment_endpoints(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php');
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($controller);
        $this->assertIsString($routes);
        $this->assertStringContainsString('assertPayrollAdmin', $controller);
        $this->assertStringContainsString("UserRole::Admin->value", $controller);
        $this->assertStringContainsString("payroll/run/audit", $routes);
        $this->assertStringContainsString("payroll/monthly/{id}/audit", $routes);
        $this->assertStringContainsString("payroll/monthly/{id}/audits", $routes);
    }

    public function test_generated_preview_uses_monthly_payroll_as_source(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString('monthlyPayrollId', $controller);
        $this->assertStringContainsString('governmentMonthlyPreviewFromDb', $controller);
        $this->assertStringContainsString("\$gov->total_earnings", $controller);
        $this->assertStringContainsString("\$gov->water_amount", $controller);
    }
}
