<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CIRT-09. Mess, Credit Society and Electricity are no longer configured in the Master
 * Payroll Deductions area. Display flag only: the stored Master defaults keep seeding
 * Run Payroll and the payroll calculation is untouched; nothing is deleted.
 */
return new class extends Migration
{
    private const KEYS = ['mess', 'credit_society', 'electricity'];

    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_field_definitions')) {
            DB::table('cirt_payroll_field_definitions')->whereIn('field_key', self::KEYS)
                ->update(['show_in_payroll_master' => false, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_payroll_field_definitions')) {
            DB::table('cirt_payroll_field_definitions')->whereIn('field_key', self::KEYS)
                ->update(['show_in_payroll_master' => true, 'updated_at' => now()]);
        }
    }
};
