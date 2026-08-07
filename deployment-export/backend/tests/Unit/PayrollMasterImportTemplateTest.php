<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Documents Payroll Master import template structure (EMP-011, EMP-012).
 * Backend source: PayrollMasterService::importTemplateColumns()
 */
final class PayrollMasterImportTemplateTest extends TestCase
{
    public function test_import_template_includes_login_and_identity_columns(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php';
        $this->assertFileExists($path);
        $source = file_get_contents($path);
        $this->assertIsString($source);

        foreach ([
            'Employee Code*',
            'User Role',
            'Password',
            'Confirm Password',
            'PAN*',
            'Aadhaar*',
            'Bank Account Number*',
        ] as $header) {
            $this->assertStringContainsString($header, $source);
        }

        foreach ([
            'Total Earnings',
            'Take Home',
        ] as $runPayrollOnly) {
            $this->assertStringNotContainsString("'header' => '{$runPayrollOnly}'", $source);
        }
    }

    public function test_import_blocks_with_template_error_message(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('Invalid template. Missing required columns:', $source);
        $this->assertStringContainsString('Import blocked. Please fix the listed errors and upload again.', $source);
    }
}
