<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_calculation_settings')) {
            Schema::table('cirt_payroll_calculation_settings', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_calculation_mode')) {
                    $table->string('cpf_calculation_mode', 32)->default('percentage');
                }
                if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_fixed_amount')) {
                    $table->decimal('cpf_fixed_amount', 12, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'electricity_unit_rate')) {
                    $table->decimal('electricity_unit_rate', 12, 2)->default(0);
                }
            });
        }

        if (Schema::hasTable('cirt_payroll_master')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_master', 'cpf_use_company_settings')) {
                    $table->boolean('cpf_use_company_settings')->default(true);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'cpf_percentage_override')) {
                    $table->decimal('cpf_percentage_override', 8, 2)->nullable();
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'cpf_basis_field_keys_override')) {
                    $table->json('cpf_basis_field_keys_override')->nullable();
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'cpf_calculation_mode')) {
                    $table->string('cpf_calculation_mode', 32)->nullable();
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'cpf_fixed_amount')) {
                    $table->decimal('cpf_fixed_amount', 12, 2)->nullable();
                }
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                foreach ([
                    'eol_reference_month' => fn () => $table->unsignedSmallInteger('eol_reference_month')->nullable(),
                    'eol_reference_year' => fn () => $table->unsignedSmallInteger('eol_reference_year')->nullable(),
                    'hpl_reference_month' => fn () => $table->unsignedSmallInteger('hpl_reference_month')->nullable(),
                    'hpl_reference_year' => fn () => $table->unsignedSmallInteger('hpl_reference_year')->nullable(),
                    'eol_basis_amount' => fn () => $table->decimal('eol_basis_amount', 12, 2)->nullable(),
                    'hpl_basis_amount' => fn () => $table->decimal('hpl_basis_amount', 12, 2)->nullable(),
                    'electricity_units_consumed' => fn () => $table->decimal('electricity_units_consumed', 12, 2)->default(0),
                    'electricity_unit_rate' => fn () => $table->decimal('electricity_unit_rate', 12, 2)->nullable(),
                    'electricity_manual_override' => fn () => $table->boolean('electricity_manual_override')->default(false),
                    'quarter_rent_manual_override' => fn () => $table->boolean('quarter_rent_manual_override')->default(false),
                    'cpf_calculation_mode' => fn () => $table->string('cpf_calculation_mode', 32)->nullable(),
                    'cpf_fixed_amount' => fn () => $table->decimal('cpf_fixed_amount', 12, 2)->nullable(),
                ] as $col => $adder) {
                    if (! Schema::hasColumn('cirt_monthly_payroll', $col)) {
                        $adder();
                    }
                }
            });

            // Backfill reference month/year from payroll period where possible.
            if (Schema::hasColumn('cirt_monthly_payroll', 'month_year')) {
                DB::statement("
                    UPDATE cirt_monthly_payroll
                    SET
                        eol_reference_month = COALESCE(eol_reference_month, EXTRACT(MONTH FROM month_year)::int),
                        eol_reference_year = COALESCE(eol_reference_year, EXTRACT(YEAR FROM month_year)::int),
                        hpl_reference_month = COALESCE(hpl_reference_month, EXTRACT(MONTH FROM month_year)::int),
                        hpl_reference_year = COALESCE(hpl_reference_year, EXTRACT(YEAR FROM month_year)::int)
                    WHERE month_year IS NOT NULL
                ");
            }
        }
    }

    public function down(): void
    {
        // Non-destructive payroll correction — columns retained for snapshot safety.
    }
};
