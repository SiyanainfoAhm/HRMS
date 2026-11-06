<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Documents Run Payroll export column cleanup (PAYRUN-001).
 * Frontend source of truth: src/lib/payrollExcelExport.ts
 */
final class PayrollExcelExportColumnsTest extends TestCase
{
    public function test_export_source_excludes_duplicate_columns(): void
    {
        $path = dirname(__DIR__, 3).'/src/lib/payrollExcelExport.ts';
        $this->assertFileExists($path);
        $source = file_get_contents($path);
        $this->assertIsString($source);

        $this->assertStringContainsString('PAYROLL_EXCEL_REMOVED_COLUMNS', $source);
        $this->assertStringContainsString('"PayrollMode"', $source);
        $this->assertStringContainsString('"PT"', $source);
        $this->assertStringContainsString('"TakeHome"', $source);
        $this->assertStringContainsString('"ElectricityUnitRate"', $source);

        // The fixed columns are derived from the Run Payroll field list, not hard-coded (one source of truth).
        $this->assertStringContainsString('from "./runPayrollFields"', $source);
        $this->assertStringContainsString('RUN_PAYROLL_EARNING_LINES', $source);
        $this->assertStringContainsString('RUN_PAYROLL_DEDUCTION_LINES', $source);
        preg_match('/const EXPORT_COLUMNS[\s\S]*?\}\)\(\);/', $source, $m);
        $this->assertNotEmpty($m[0] ?? null, 'EXPORT_COLUMNS builder not found');
        foreach (['StdLicenceFee', 'SPPay', '"NetPay"', '"CTC"', '"TDS"', 'EmployerPF', 'NightHours', 'QuarterRent"', 'QuarterAssigned'] as $gone) {
            $this->assertStringNotContainsString($gone, $m[0], "$gone must not be an exported column");
        }

        $fields = file_get_contents(dirname(__DIR__, 3).'/src/lib/runPayrollFields.ts');
        $this->assertStringNotContainsString('stdLicenceFee', $fields, 'Std Licence Fee is not a Run Payroll line');
        $this->assertStringNotContainsString('spPayPaid', $fields, 'Special Pay is not a Run Payroll line (it is in Special Allowance)');
        $this->assertStringContainsString('key: "quarterRent"', $fields);
    }
}
