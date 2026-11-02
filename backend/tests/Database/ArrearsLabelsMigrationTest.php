<?php

namespace Tests\Database;

use App\Support\PayrollFieldRegistry;
use App\Support\PayrollLabels;
use App\Support\PayrollTotals;
use Illuminate\Support\Facades\DB;

/** CIRT-04/05/06/07: labels, Past Arrears, Unpaid Arrears inactive, Net Arrears derived, finalized untouched. */
final class ArrearsLabelsMigrationTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private function runMigration(): void
    {
        (require base_path('database/migrations/2026_11_02_100000_cirt_fix_arrears_labels_and_past_arrears.php'))->up();
    }

    public function test_registry_and_database_use_the_single_label_source_and_finalized_payroll_is_unchanged(): void
    {
        $before = $this->finalizedSnapshot();
        DB::table('cirt_monthly_payroll')->exists() || $this->markTestSkipped('No generated payroll in this database.');

        // Make a company look like production did before the fix, then run the migration.
        DB::table('cirt_payroll_field_definitions')->where('field_key', 'cpf_arrears')->update(['field_label' => 'CPF Arrears']);
        DB::table('cirt_payroll_field_definitions')->where('field_key', 'past_arrears')->delete();
        $company = DB::table('cirt_payroll_field_definitions')->value('company_id');
        DB::table('cirt_payroll_field_definitions')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'company_id' => $company, 'field_label' => 'Unpaid Arrears',
            'field_key' => 'unpaid_arrears', 'field_group' => 'earnings', 'field_type' => 'number', 'calculation_type' => 'manual_entry',
            'is_active' => true, 'is_system' => false, 'display_order' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->runMigration();
        $this->runMigration(); // idempotent

        foreach (PayrollLabels::FIELD_LABELS as $key => $label) {
            $this->assertSame($label, DB::table('cirt_payroll_field_definitions')->where('field_key', $key)->value('field_label'), $key);
        }
        $past = DB::table('cirt_payroll_field_definitions')->where('field_key', 'past_arrears')->first();
        $this->assertSame('Past Arrears', $past->field_label);
        $this->assertSame('manual_entry', $past->calculation_type, 'free entry, no formula');
        $this->assertTrue((bool) $past->include_in_total_earnings);
        $this->assertSame(1, DB::table('cirt_payroll_field_definitions')->where('company_id', $company)->where('field_key', 'past_arrears')->count());
        $this->assertFalse((bool) DB::table('cirt_payroll_field_definitions')->where('field_key', 'unpaid_arrears')->value('is_active'));
        $this->assertSame(1, DB::table('cirt_payroll_field_definitions')->where('field_key', 'unpaid_arrears')->count(), 'inactive, not deleted');

        $labels = collect(PayrollFieldRegistry::systemFieldDefinitions())->pluck('field_label', 'field_key');
        foreach (PayrollLabels::FIELD_LABELS as $key => $label) {
            $this->assertSame($label, $labels[$key], "registry {$key}");
        }

        $this->assertFinalizedUnchanged($before, 'the CIRT-05/06/07 migration');
    }

    public function test_net_arrear_is_derived_from_gross_minus_cpf_arrear(): void
    {
        // Sept 2026 employee 037: gross 22636 typed, net saved as 0 by the old path.
        $this->assertSame(22636.0, PayrollTotals::netArrear(['grossArrear' => 22636, 'cpfArrear' => 0, 'netArrear' => 0]));
        $this->assertSame(1056.0, PayrollTotals::netArrear(['gross_arrear' => 1200, 'cpf_arrear' => 144, 'net_arrear' => 999]));
        $this->assertSame(0.0, PayrollTotals::netArrear(['grossArrear' => 100, 'cpfArrear' => 150]));
        $this->assertSame(0.0, PayrollTotals::netArrear([]));
        // Net Arrears never enters Gross or Deductions.
        $gm = ['grossArrear' => 1200, 'cpfArrear' => 144, 'netArrear' => 1056];
        $this->assertSame(1200.0, PayrollTotals::fixedEarnings($gm));
        $this->assertSame(144.0, PayrollTotals::fixedDeductions($gm));
    }
}
