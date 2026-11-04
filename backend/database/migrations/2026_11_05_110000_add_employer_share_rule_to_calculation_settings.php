<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * Employer share of the CPF remittance sheet (PENSION and EMP_ CONTR. columns). The ASRTU CPF Trust rule is not decided,
 * so all three settings are NULL by default and the sheet leaves both columns empty (and says so) until they are filled.
 *
 *   pension_percentage              % of the CPF wage (the sheet's Total column) paid as PENSION
 *   pension_wage_ceiling            wage cap for the pension share; NULL = no cap
 *   employer_contribution_percentage  % of the CPF wage paid as EMP_ CONTR.
 *
 * Additive, nullable: no existing amount is touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_calculation_settings')) {
            return;
        }
        Schema::table('cirt_payroll_calculation_settings', function ($table): void {
            if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'pension_percentage')) {
                $table->decimal('pension_percentage', 8, 4)->nullable();
            }
            if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'pension_wage_ceiling')) {
                $table->decimal('pension_wage_ceiling', 12, 2)->nullable();
            }
            if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'employer_contribution_percentage')) {
                $table->decimal('employer_contribution_percentage', 8, 4)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_payroll_calculation_settings')) {
            Schema::table('cirt_payroll_calculation_settings', function ($table): void {
                foreach (['pension_percentage', 'pension_wage_ceiling', 'employer_contribution_percentage'] as $column) {
                    if (Schema::hasColumn('cirt_payroll_calculation_settings', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
