<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CIRT-08. Night Duty Allowance = (hours / 8) x rate per Pay Level, so the rate table needs a
 * per-duty rate and each generated row needs to remember which basis its stored rate uses.
 *
 *  - cirt_night_allowance_rates.rate_per_duty: seeded as rate_per_hour x 8, so the new formula
 *    yields exactly the previous amounts until the payroll team edits the rates in Settings.
 *    rate_per_hour is kept (history / rollback).
 *  - cirt_monthly_payroll.night_allowance_rate_basis: 'hour' for every existing row (they keep
 *    hours x rate), 'duty' only for rows generated from the new rate table. Finalized rows
 *    are not rewritten: the column defaults to 'hour'.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_night_allowance_rates') && ! Schema::hasColumn('cirt_night_allowance_rates', 'rate_per_duty')) {
            Schema::table('cirt_night_allowance_rates', function ($table) {
                $table->decimal('rate_per_duty', 12, 2)->nullable()->after('rate_per_hour');
            });
            DB::statement('UPDATE cirt_night_allowance_rates SET rate_per_duty = ROUND(rate_per_hour * 8, 2) WHERE rate_per_duty IS NULL');
        }
        if (Schema::hasTable('cirt_monthly_payroll') && ! Schema::hasColumn('cirt_monthly_payroll', 'night_allowance_rate_basis')) {
            Schema::table('cirt_monthly_payroll', function ($table) {
                $table->string('night_allowance_rate_basis', 8)->default('hour');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('cirt_monthly_payroll', 'night_allowance_rate_basis')) {
            Schema::table('cirt_monthly_payroll', fn ($t) => $t->dropColumn('night_allowance_rate_basis'));
        }
        if (Schema::hasColumn('cirt_night_allowance_rates', 'rate_per_duty')) {
            // Rates edited after this migration are lost on rollback; rate_per_hour is the fallback.
            Schema::table('cirt_night_allowance_rates', fn ($t) => $t->dropColumn('rate_per_duty'));
        }
    }
};
