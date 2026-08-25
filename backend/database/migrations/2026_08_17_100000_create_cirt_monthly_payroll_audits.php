<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive audit trail for Admin amendments of already-generated monthly payroll.
 * Does not modify existing cirt_monthly_payroll values.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll_audits')) {
            return;
        }

        Schema::create('cirt_monthly_payroll_audits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('company_id');
            $table->uuid('monthly_payroll_id');
            $table->uuid('payroll_period_id')->nullable();
            $table->uuid('employee_user_id');
            $table->uuid('changed_by');
            $table->string('changed_by_name', 255)->nullable();
            $table->text('change_reason');
            $table->jsonb('before_payload');
            $table->jsonb('after_payload');
            $table->jsonb('changed_fields');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['company_id', 'monthly_payroll_id'], 'cirt_mp_audits_monthly_idx');
            $table->index(['company_id', 'payroll_period_id'], 'cirt_mp_audits_period_idx');
            $table->index(['employee_user_id', 'created_at'], 'cirt_mp_audits_employee_idx');
            $table->index('changed_by', 'cirt_mp_audits_changed_by_idx');
        });

        if (Schema::hasTable('cirt_institute')) {
            Schema::table('cirt_monthly_payroll_audits', function (Blueprint $table) {
                $table->foreign('company_id')
                    ->references('id')
                    ->on('cirt_institute')
                    ->cascadeOnDelete();
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll_audits', function (Blueprint $table) {
                $table->foreign('monthly_payroll_id')
                    ->references('id')
                    ->on('cirt_monthly_payroll')
                    ->cascadeOnDelete();
            });
        }

        if (Schema::hasTable('cirt_payroll_periods')) {
            Schema::table('cirt_monthly_payroll_audits', function (Blueprint $table) {
                $table->foreign('payroll_period_id')
                    ->references('id')
                    ->on('cirt_payroll_periods')
                    ->nullOnDelete();
            });
        }

        if (Schema::hasTable('cirt_users')) {
            Schema::table('cirt_monthly_payroll_audits', function (Blueprint $table) {
                $table->foreign('employee_user_id')
                    ->references('id')
                    ->on('cirt_users')
                    ->cascadeOnDelete();
                $table->foreign('changed_by')
                    ->references('id')
                    ->on('cirt_users')
                    ->restrictOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_monthly_payroll_audits');
    }
};
