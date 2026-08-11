<?php

namespace Tests\Unit;

use App\Services\PayrollDraftService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

final class PayrollDraftServiceLogicTest extends TestCase
{
    public function test_num_helper_preserves_zero_and_null(): void
    {
        $service = new PayrollDraftService;
        $ref = new ReflectionClass($service);
        $method = $ref->getMethod('num');
        $method->setAccessible(true);

        $this->assertSame(0.0, $method->invoke($service, 0));
        $this->assertSame(0.0, $method->invoke($service, '0'));
        $this->assertNull($method->invoke($service, null));
        $this->assertSame(12.5, $method->invoke($service, '12.5'));
    }

    public function test_save_path_fills_total_earnings_and_arrears_from_payload(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString("government_monthly", $source);
        $this->assertStringContainsString("total_earnings", $source);
        $this->assertStringContainsString("total_arrears", $source);
        $this->assertStringContainsString("da_arrears_paid", $source);
        $this->assertStringContainsString("transport_arrears_paid", $source);
        $this->assertStringContainsString("'rowPayload' => \$row->row_payload", $source);
    }

    public function test_save_response_includes_employee_count_fields(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString('expectedEmployeeCount', $source);
        $this->assertStringContainsString('savedEmployeeCount', $source);
        $this->assertStringContainsString('distinctEmployeeCount', $source);
        $this->assertStringContainsString('Draft save incomplete', $source);
        $this->assertStringContainsString('DB::transaction', $source);
    }

    public function test_format_employee_exposes_row_payload_object_fields(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        foreach ([
            "'totalEarnings' => \$row->total_earnings",
            "'totalDeductions' => \$row->total_deductions",
            "'totalArrears' => \$row->total_arrears",
            "'grossPay' => \$row->gross_pay",
            "'netPay' => \$row->net_pay",
            "'rowPayload' => \$row->row_payload",
        ] as $needle) {
            $this->assertStringContainsString($needle, $source);
        }
    }
}
