<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const RETIRED_KEYS = [
        'pf_loan',
        'standard_licence_fee',
        'vehicle_charge',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        DB::table('cirt_payroll_field_definitions')
            ->whereIn('field_key', self::RETIRED_KEYS)
            ->update([
                'is_active' => false,
                'show_in_payroll_master' => false,
                'show_in_run_payroll' => false,
                'show_in_salary_slip' => false,
                'include_in_total_deductions' => false,
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        DB::table('cirt_payroll_field_definitions')
            ->whereIn('field_key', self::RETIRED_KEYS)
            ->update([
                'is_active' => true,
                'show_in_payroll_master' => true,
                'show_in_run_payroll' => true,
                'show_in_salary_slip' => true,
                'include_in_total_deductions' => true,
                'updated_at' => now(),
            ]);
    }
};
