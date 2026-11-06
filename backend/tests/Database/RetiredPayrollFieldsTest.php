<?php

namespace Tests\Database;

use App\Services\PayrollDraftService;
use App\Services\PostPayrollDownloadService;
use App\Support\PayrollExportTotals;
use App\Support\PayrollFieldRegistry;
use App\Support\PayrollTotals;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Special Pay" (SP Pay) and "Std Licence Fee" are retired: quarter rent is the Quarter Rent line and every special
 * amount is in Special Allowance. Nothing reads, writes, totals, seeds or exports them any more, and the database has
 * no column for them (migration 2026_11_06_100000).
 */
final class RetiredPayrollFieldsTest extends DatabaseTestCase
{
    public function test_the_seven_columns_and_the_two_field_definitions_are_gone(): void
    {
        foreach (['cirt_monthly_payroll' => ['sp_pay_actual', 'sp_pay_paid', 'std_licence_fee_amount'],
            'cirt_payroll_master' => ['standard_licence_fee', 'std_licence_fee_default'],
            'cirt_payroll_master_history' => ['standard_licence_fee', 'std_licence_fee_default']] as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertFalse(Schema::hasColumn($table, $column), "{$table}.{$column} is dropped");
            }
        }
        $this->assertSame(0, DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['sp_pay', 'standard_licence_fee'])->count());
    }

    public function test_no_registry_total_or_export_list_carries_them(): void
    {
        $seeded = array_column(PayrollFieldRegistry::systemFieldDefinitions(), 'field_key');
        $this->assertNotContains('sp_pay', $seeded);
        $this->assertNotContains('standard_licence_fee', $seeded);
        $this->assertNotContains('sp_pay', PayrollFieldRegistry::EXTRA_CPF_BASIS_KEYS);
        $this->assertNotContains('sp_pay', PayrollFieldRegistry::MASTER_VALUE_SYSTEM_KEYS);
        $this->assertNotContains('spPayPaid', PayrollTotals::EARNING_KEYS);
        $this->assertNotContains('stdLicenceFee', PayrollTotals::DEDUCTION_KEYS);
        $this->assertNotContains('sp_pay_paid', (new \ReflectionClassConstant(PayrollExportTotals::class, 'EARNING_COLUMNS'))->getValue());
        $this->assertNotContains('std_licence_fee_amount', (new \ReflectionClassConstant(PayrollExportTotals::class, 'DEDUCTION_COLUMNS'))->getValue());
        $this->assertArrayNotHasKey('sp.pay', PostPayrollDownloadService::PAYBILL_EARNINGS);
        $this->assertArrayNotHasKey('Std.Lic.Fee', PostPayrollDownloadService::PAYBILL_DEDUCTIONS);
    }

    public function test_a_leftover_key_in_an_old_draft_does_not_reach_the_totals(): void
    {
        $svc = app(PayrollDraftService::class);
        $m = new \ReflectionMethod($svc, 'recalculateDraftTotals');
        $m->setAccessible(true);
        $payload = ['governmentMonthly' => ['basicPaid' => 1000, 'spPayPaid' => 500, 'customEarnings' => ['special_allowance' => 200],
            'deductions' => ['pt' => 100, 'stdLicenceFee' => 50]]];
        $out = $m->invoke($svc, $payload, []);
        $this->assertEquals(1200, $out['governmentMonthly']['totalEarnings'], 'Basic + Special Allowance only');
        $this->assertEquals(100, $out['governmentMonthly']['totalDeductions'], 'PT only');
    }
}
