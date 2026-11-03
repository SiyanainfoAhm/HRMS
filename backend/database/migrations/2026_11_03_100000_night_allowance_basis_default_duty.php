<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * New payroll rows are per-duty. Only the column DEFAULT changes (idempotent): every existing
 * row, including generated/finalized months, keeps the basis it was stored with.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll') && Schema::hasColumn('cirt_monthly_payroll', 'night_allowance_rate_basis')) {
            DB::statement("ALTER TABLE cirt_monthly_payroll ALTER COLUMN night_allowance_rate_basis SET DEFAULT 'duty'");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll') && Schema::hasColumn('cirt_monthly_payroll', 'night_allowance_rate_basis')) {
            DB::statement("ALTER TABLE cirt_monthly_payroll ALTER COLUMN night_allowance_rate_basis SET DEFAULT 'hour'");
        }
    }
};
