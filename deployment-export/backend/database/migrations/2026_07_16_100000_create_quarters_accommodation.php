<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_quarters')) {
            Schema::create('cirt_quarters', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->string('quarter_name', 128);
                $table->string('quarter_type', 32);
                $table->decimal('monthly_rent', 12, 2)->default(0);
                $table->string('status', 32)->default('available');
                $table->uuid('assigned_employee_id')->nullable();
                $table->date('assigned_from')->nullable();
                $table->date('assigned_to')->nullable();
                $table->uuid('created_by')->nullable();
                $table->timestamps();
                $table->unique(['company_id', 'quarter_name']);
                $table->index(['company_id', 'status']);
            });
        }

        if (! Schema::hasTable('cirt_quarter_assignments')) {
            Schema::create('cirt_quarter_assignments', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->uuid('quarter_id');
                $table->uuid('employee_id');
                $table->date('assigned_from')->nullable();
                $table->date('assigned_to')->nullable();
                $table->decimal('rent_at_assignment', 12, 2)->default(0);
                $table->uuid('created_by')->nullable();
                $table->timestamps();
                $table->index(['company_id', 'quarter_id']);
            });
        }

        if (Schema::hasTable('cirt_payroll_master')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_master', 'quarter_id')) {
                    $table->uuid('quarter_id')->nullable();
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'has_quarter')) {
                    $table->boolean('has_quarter')->default(false);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'quarter_rent')) {
                    $table->decimal('quarter_rent', 12, 2)->default(0);
                }
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_monthly_payroll', 'quarter_rent_amount')) {
                    $table->decimal('quarter_rent_amount', 12, 2)->nullable();
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'has_quarter')) {
                    $table->boolean('has_quarter')->default(false);
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'quarter_id')) {
                    $table->uuid('quarter_id')->nullable();
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'quarter_name')) {
                    $table->string('quarter_name', 128)->nullable();
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'quarter_type')) {
                    $table->string('quarter_type', 32)->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_quarter_assignments');
        Schema::dropIfExists('cirt_quarters');
    }
};
