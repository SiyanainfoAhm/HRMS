<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * CIRT leave calculation (Ref ADM:Gen:1521): an employee can have HPL and EOL in several months in one leave
 * period, each calculated on its own month. A saved payroll row now keeps the leave lines it was generated from
 * and the resulting HPL / EOL salary adjustment (HPL = Basic + DA cut; EOL = Basic + DA + HRA + Medical cut), so the
 * payslip shows the amount that was actually taken off instead of re-deriving it from one reference month.
 *
 * Additive and nullable: no existing amount is touched. Rows saved earlier keep NULL and the payslip falls back to
 * the previous single-reference-month calculation for them.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return;
        }
        Schema::table('cirt_monthly_payroll', function ($table): void {
            if (! Schema::hasColumn('cirt_monthly_payroll', 'leave_lines')) {
                $table->json('leave_lines')->nullable();
            }
            if (! Schema::hasColumn('cirt_monthly_payroll', 'hpl_adjustment')) {
                $table->decimal('hpl_adjustment', 12, 2)->nullable();
            }
            if (! Schema::hasColumn('cirt_monthly_payroll', 'eol_adjustment')) {
                $table->decimal('eol_adjustment', 12, 2)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function ($table): void {
                foreach (['leave_lines', 'hpl_adjustment', 'eol_adjustment'] as $column) {
                    if (Schema::hasColumn('cirt_monthly_payroll', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
