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
        $this->assertStringContainsString('"ProfessionalTax"', $source);
        $this->assertStringContainsString('"NetPay"', $source);

        preg_match('/export const PAYROLL_EXCEL_HEADER = \[([\s\S]*?)\] as const;/', $source, $m);
        $this->assertNotEmpty($m[1] ?? null);
        $headerBlock = $m[1];
        $this->assertStringNotContainsString('"PayrollMode"', $headerBlock);
        $this->assertStringNotContainsString('"PT"', $headerBlock);
        $this->assertStringNotContainsString('"TakeHome"', $headerBlock);
        $this->assertStringContainsString('"ProfessionalTax"', $headerBlock);
        $this->assertStringContainsString('"NetPay"', $headerBlock);
    }
}
