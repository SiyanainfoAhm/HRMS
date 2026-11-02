<?php

use App\Support\PayrollLabels;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * CIRT-04/05/06/07. Data only: no column changes, nothing is deleted.
 *  - system arrears fields get the single-source labels (PayrollLabels);
 *  - "Past Arrears" is added as an open free-entry earning (no formula);
 *  - a field keyed `unpaid_arrears`, if a database has one, is marked inactive
 *    (inactive = hidden from entry/selection; history and old reports keep it).
 * Historical payroll rows are never touched: monthly rows store amounts, not labels.
 */
return new class extends Migration
{
    private const PREVIOUS_LABELS = [
        'da_arrears' => 'DA Arrears',
        'transport_arrears' => 'Transport Arrears',
        'gross_arrears' => 'Gross Arrears',
        'net_arrears' => 'Net Arrears',
        'cpf_arrears' => 'CPF Arrears',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }
        $defs = DB::table('cirt_payroll_field_definitions');

        foreach (PayrollLabels::FIELD_LABELS as $key => $label) {
            DB::table('cirt_payroll_field_definitions')->where('field_key', $key)->update(['field_label' => $label, 'updated_at' => now()]);
        }

        foreach ((clone $defs)->distinct()->pluck('company_id') as $companyId) {
            $exists = DB::table('cirt_payroll_field_definitions')
                ->where('company_id', $companyId)->where('field_key', PayrollLabels::PAST_ARREARS_FIELD_KEY)->exists();
            if ($exists) {
                continue;
            }
            DB::table('cirt_payroll_field_definitions')->insert([
                'id' => (string) Str::uuid(), 'company_id' => $companyId,
                'field_label' => PayrollLabels::PAST_ARREARS, 'field_key' => PayrollLabels::PAST_ARREARS_FIELD_KEY,
                'field_group' => 'earnings', 'field_type' => 'number', 'calculation_type' => 'manual_entry',
                'default_value' => null, 'is_required' => false,
                'show_in_payroll_master' => false, 'show_in_run_payroll' => true, 'show_in_salary_slip' => true,
                'include_in_total_earnings' => true, 'include_in_total_deductions' => false,
                'is_system' => false, 'is_active' => true, 'display_order' => 101,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        DB::table('cirt_payroll_field_definitions')->where('field_key', 'unpaid_arrears')
            ->update(['is_active' => false, 'updated_at' => now()]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }
        foreach (self::PREVIOUS_LABELS as $key => $label) {
            DB::table('cirt_payroll_field_definitions')->where('field_key', $key)->update(['field_label' => $label, 'updated_at' => now()]);
        }
        // Never delete data: Past Arrears is deactivated (values already entered stay in the monthly rows).
        DB::table('cirt_payroll_field_definitions')->where('field_key', PayrollLabels::PAST_ARREARS_FIELD_KEY)
            ->update(['is_active' => false, 'updated_at' => now()]);
        // `unpaid_arrears` is intentionally NOT re-activated: re-enabling it is a manual decision.
    }
};
