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
}
