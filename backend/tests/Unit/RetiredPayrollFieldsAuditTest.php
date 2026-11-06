<?php

namespace Tests\Unit;

use App\Console\Commands\RetiredPayrollFieldsAudit;
use PHPUnit\Framework\TestCase;

final class RetiredPayrollFieldsAuditTest extends TestCase
{
    public function test_zero_and_empty_values_are_not_reported(): void
    {
        $payload = json_decode('{"governmentMonthly":{"spPayPaid":0,"spPayActual":"0","deductions":{"stdLicenceFee":0.0,"pt":200},"customEarnings":{}},"govRecalc":{"earningPaidOverrides":{"spPayPaid":null}}}');
        $this->assertSame([], RetiredPayrollFieldsAudit::nonZeroPaths($payload));
    }

    public function test_a_non_zero_value_is_reported_with_its_path(): void
    {
        $payload = json_decode('{"governmentMonthly":{"spPayPaid":200,"deductions":{"stdLicenceFee":"15.5"}},"rows":[{"sp_pay_paid":1000}]}');
        $found = RetiredPayrollFieldsAudit::nonZeroPaths($payload);
        $this->assertContains('governmentMonthly.spPayPaid = 200', $found);
        $this->assertContains('governmentMonthly.deductions.stdLicenceFee = "15.5"', $found);
        $this->assertContains('rows.0.sp_pay_paid = 1000', $found);
        $this->assertCount(3, $found);
    }
}
