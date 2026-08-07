<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            Schema::create('cirt_payroll_field_definitions', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->string('field_label', 128);
                $table->string('field_key', 64);
                $table->string('field_group', 32);
                $table->string('field_type', 32)->default('number');
                $table->string('calculation_type', 32)->default('manual_entry');
                $table->string('default_value', 255)->nullable();
                $table->json('dropdown_options')->nullable();
                $table->boolean('is_required')->default(false);
                $table->boolean('show_in_payroll_master')->default(true);
                $table->boolean('show_in_run_payroll')->default(true);
                $table->boolean('show_in_salary_slip')->default(true);
                $table->boolean('include_in_total_earnings')->default(false);
                $table->boolean('include_in_total_deductions')->default(false);
                $table->boolean('is_system')->default(false);
                $table->boolean('is_active')->default(true);
                $table->unsignedInteger('display_order')->default(0);
                $table->uuid('created_by')->nullable();
                $table->timestamps();

                $table->unique(['company_id', 'field_key'], 'cirt_payroll_field_defs_company_key_unique');
                $table->index(['company_id', 'field_group', 'is_active']);
            });
        }

        if (! Schema::hasTable('cirt_payroll_field_values')) {
            Schema::create('cirt_payroll_field_values', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->uuid('employee_id')->nullable();
                $table->uuid('payroll_master_id')->nullable();
                $table->uuid('payroll_period_id')->nullable();
                $table->uuid('field_definition_id');
                $table->string('field_key', 64);
                $table->text('field_value')->nullable();
                $table->timestamps();

                $table->index(['company_id', 'payroll_master_id']);
                $table->index(['company_id', 'payroll_period_id', 'employee_id']);
                $table->unique(
                    ['company_id', 'payroll_master_id', 'field_definition_id'],
                    'cirt_payroll_field_values_master_field_unique',
                );
            });
        }

        if (! Schema::hasTable('cirt_payroll_calculation_settings')) {
            Schema::create('cirt_payroll_calculation_settings', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id')->unique();
                $table->decimal('cpf_percentage', 8, 2)->default(12);
                $table->json('cpf_basis_field_keys');
                $table->timestamps();
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_monthly_payroll', 'custom_earnings')) {
                    $table->json('custom_earnings')->nullable();
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'custom_deductions')) {
                    $table->json('custom_deductions')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (Schema::hasColumn('cirt_monthly_payroll', 'custom_earnings')) {
                    $table->dropColumn('custom_earnings');
                }
                if (Schema::hasColumn('cirt_monthly_payroll', 'custom_deductions')) {
                    $table->dropColumn('custom_deductions');
                }
            });
        }

        Schema::dropIfExists('cirt_payroll_calculation_settings');
        Schema::dropIfExists('cirt_payroll_field_values');
        Schema::dropIfExists('cirt_payroll_field_definitions');
    }
};
