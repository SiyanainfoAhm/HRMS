<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions') || ! Schema::hasTable('cirt_institute')) {
            return;
        }

        foreach (DB::table('cirt_institute')->pluck('id') as $companyId) {
            foreach ([
                ['field_label' => 'Telephone Allowance', 'field_key' => 'telephone_allowance', 'field_group' => 'earnings', 'include_in_total_earnings' => true, 'include_in_total_deductions' => false, 'display_order' => 82],
                ['field_label' => 'GPF', 'field_key' => 'gpf', 'field_group' => 'deductions', 'include_in_total_earnings' => false, 'include_in_total_deductions' => true, 'display_order' => 99],
            ] as $field) {
                if (DB::table('cirt_payroll_field_definitions')->where('company_id', $companyId)->where('field_key', $field['field_key'])->exists()) {
                    continue;
                }
                DB::table('cirt_payroll_field_definitions')->insert([
                    'id' => (string) Str::uuid(), 'company_id' => $companyId, 'field_label' => $field['field_label'], 'field_key' => $field['field_key'],
                    'field_group' => $field['field_group'], 'field_type' => 'number', 'calculation_type' => 'manual_entry', 'default_value' => null,
                    'is_required' => false, 'show_in_payroll_master' => true, 'show_in_run_payroll' => true, 'show_in_salary_slip' => true,
                    'include_in_total_earnings' => $field['include_in_total_earnings'], 'include_in_total_deductions' => $field['include_in_total_deductions'],
                    'is_system' => true, 'is_active' => true, 'display_order' => $field['display_order'], 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_payroll_field_definitions')) {
            DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['telephone_allowance', 'gpf'])->delete();
        }
    }
};
