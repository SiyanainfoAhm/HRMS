<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PayrollUiControlsTest extends TestCase
{
    public function test_removed_controls_do_not_reappear_in_the_payroll_ui(): void
    {
        $root = dirname(__DIR__, 3);
        $settings = file_get_contents($root.'/src/app/(app)/settings/role-settings.tsx');
        $fields = file_get_contents($root.'/src/components/settings/PayrollConfigurationSettings.tsx');
        $master = file_get_contents($root.'/src/components/payroll/PayrollMasterScreen.tsx');
        $exportService = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollMasterService.php');

        $this->assertIsString($settings);
        $this->assertIsString($fields);
        $this->assertIsString($master);
        $this->assertIsString($exportService);
        $this->assertStringNotContainsString('professionalTaxAnnual', $settings);
        $this->assertStringNotContainsString('>Add role<', $settings);
        $this->assertStringNotContainsString('label="Calculation type"', $fields);
        $this->assertStringNotContainsString('Sync Employees', $master);
        $this->assertStringContainsString('Export All', $master);
        $this->assertStringContainsString('Export Selected', $master);
        $this->assertStringContainsString('masterIds', $master);
        $this->assertStringContainsString('whereIn(\'id\', $masterIds)', $exportService);
        $this->assertStringContainsString('formatExportRows($masters, $companyId)', $exportService);
        $this->assertStringContainsString('getCustomFieldValuesForMasters', $exportService);
        $this->assertStringContainsString('rowToExport($r, $columns)', $exportService);
    }

    public function test_payroll_scroller_cleans_up_continuous_arrow_scrolling(): void
    {
        $root = dirname(__DIR__, 3);
        $scroller = file_get_contents($root.'/src/components/payroll/PayrollComponentScroller.tsx');
        $header = file_get_contents($root.'/src/components/payroll/PayrollEmployeeCardHeader.tsx');

        $this->assertIsString($scroller);
        $this->assertIsString($header);
        $this->assertStringContainsString('requestAnimationFrame', $scroller);
        $this->assertStringContainsString('cancelAnimationFrame', $scroller);
        $this->assertStringContainsString('window.addEventListener("blur", stop)', $scroller);
        $this->assertStringNotContainsString('resetScroll', $scroller);
        $this->assertStringNotContainsString('RotateCcw', $header);
        $this->assertStringContainsString('onPointerDown', $header);
        $this->assertStringContainsString('onPointerUp', $header);
    }
}
