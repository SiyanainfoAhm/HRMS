<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Current payroll master rows must have open end dates.
 * Legacy revisions set effective_end_date while effective_to stayed NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        if (Schema::hasColumn('cirt_payroll_master', 'effective_end_date')) {
            DB::statement('
                UPDATE cirt_payroll_master
                SET effective_end_date = NULL
                WHERE effective_to IS NULL AND effective_end_date IS NOT NULL
            ');
        }

        if (Schema::hasColumn('cirt_payroll_master', 'effective_to')) {
            DB::statement('
                UPDATE cirt_payroll_master
                SET effective_to = NULL
                WHERE effective_to IS NOT NULL
            ');
        }
    }

    public function down(): void
    {
        // Non-reversible: prior effective_end_date values were stale on current rows.
    }
};
