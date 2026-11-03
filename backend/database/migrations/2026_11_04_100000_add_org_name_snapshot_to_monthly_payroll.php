<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Division / designation are stored by NAME on Payroll Master rows and a Settings rename rewrites the current master,
 * so a month generated earlier would show the NEW name in reports. Each saved payroll row now carries the division and
 * designation text it was generated with (division_name / designation_name, nullable).
 *
 * Additive only: no payroll amount is touched. Existing rows are filled once from the master version they were
 * generated against (payroll_master_id), so history is frozen at its current spelling; rows with no master stay NULL
 * and reports fall back to the master's division.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return;
        }
        Schema::table('cirt_monthly_payroll', function ($table): void {
            if (! Schema::hasColumn('cirt_monthly_payroll', 'division_name')) {
                $table->string('division_name', 255)->nullable();
            }
            if (! Schema::hasColumn('cirt_monthly_payroll', 'designation_name')) {
                $table->string('designation_name', 255)->nullable();
            }
        });
        DB::statement(<<<'SQL'
            UPDATE cirt_monthly_payroll m
            SET division_name = NULLIF(BTRIM(pm.division), ''),
                designation_name = NULLIF(BTRIM(pm.designation), '')
            FROM cirt_payroll_master pm
            WHERE pm.id = m.payroll_master_id
              AND m.division_name IS NULL AND m.designation_name IS NULL
        SQL);
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function ($table): void {
                foreach (['division_name', 'designation_name'] as $column) {
                    if (Schema::hasColumn('cirt_monthly_payroll', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
