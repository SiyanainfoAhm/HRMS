<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_activity_logs')) return;

        Schema::create('cirt_activity_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('company_id');
            $table->uuid('actor_user_id')->nullable();
            $table->string('actor_role', 32)->nullable();
            $table->string('action', 100);
            $table->string('outcome', 16)->default('succeeded');
            $table->uuid('target_employee_user_id')->nullable();
            $table->unsignedSmallInteger('payroll_year')->nullable();
            $table->unsignedSmallInteger('payroll_month')->nullable();
            $table->uuid('payroll_period_id')->nullable();
            $table->uuid('monthly_payroll_id')->nullable();
            $table->string('field_changed', 100)->nullable();
            $table->jsonb('changed_fields')->nullable();
            $table->jsonb('previous_value')->nullable();
            $table->jsonb('new_value')->nullable();
            $table->string('request_id', 128)->nullable();
            $table->jsonb('metadata')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('company_id')->references('id')->on('cirt_institute')->restrictOnDelete();
            $table->foreign('actor_user_id')->references('id')->on('cirt_users')->nullOnDelete();
            $table->foreign('target_employee_user_id')->references('id')->on('cirt_users')->nullOnDelete();
            $table->foreign('payroll_period_id')->references('id')->on('cirt_payroll_periods')->nullOnDelete();
            $table->foreign('monthly_payroll_id')->references('id')->on('cirt_monthly_payroll')->nullOnDelete();
            $table->index(['company_id', 'created_at'], 'cirt_activity_company_time_idx');
            $table->index(['company_id', 'payroll_year', 'payroll_month', 'created_at'], 'cirt_activity_period_idx');
            $table->index(['company_id', 'actor_user_id', 'created_at'], 'cirt_activity_actor_idx');
            $table->index(['company_id', 'target_employee_user_id', 'created_at'], 'cirt_activity_employee_idx');
            $table->index(['company_id', 'action', 'created_at'], 'cirt_activity_action_idx');
            $table->index('request_id', 'cirt_activity_request_idx');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_activity_logs')) {
            throw new RuntimeException('Activity logs are append-only. Archive them explicitly before removing this table.');
        }
    }
};
