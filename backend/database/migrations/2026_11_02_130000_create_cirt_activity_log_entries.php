<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * CIRT-10. One MAIN record per action (not per employee) plus CHILD detail rows
 * (Changed Item | Previous Value | Updated Value) stored once per action.
 * The old per-employee table cirt_activity_logs is untouched and stays readable.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_activity_log_entries')) {
            Schema::create('cirt_activity_log_entries', function ($table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->string('action_code', 64);
                $table->string('action_label', 120);
                $table->string('module', 24); // Payroll | Master | Configuration
                $table->uuid('performed_by_user_id')->nullable();
                $table->string('performed_by_name', 160)->nullable();
                $table->timestampTz('performed_at');
                $table->smallInteger('payroll_year')->nullable();
                $table->smallInteger('payroll_month')->nullable();
                $table->integer('employee_count')->default(0);
                $table->integer('detail_count')->default(0);
                $table->string('outcome', 16)->default('succeeded');
                $table->string('request_id', 128)->nullable();
                $table->jsonb('metadata')->nullable();
                $table->index(['company_id', 'performed_at'], 'cirt_ale_company_time_idx');
                $table->index(['company_id', 'module', 'performed_at'], 'cirt_ale_company_module_idx');
                $table->index('action_code', 'cirt_ale_action_idx');
            });
        }
        if (! Schema::hasTable('cirt_activity_log_details')) {
            Schema::create('cirt_activity_log_details', function ($table) {
                $table->uuid('id')->primary();
                $table->uuid('entry_id');
                $table->uuid('employee_user_id')->nullable();
                $table->string('employee_label', 200)->nullable();
                $table->string('changed_item', 200);
                $table->text('previous_value')->nullable();
                $table->text('updated_value')->nullable();
                $table->integer('sort_order')->default(0);
                $table->foreign('entry_id')->references('id')->on('cirt_activity_log_entries')->cascadeOnDelete();
                $table->index(['entry_id', 'sort_order'], 'cirt_ald_entry_idx');
            });
        }
    }

    public function down(): void
    {
        // Drops only the new tables; the legacy cirt_activity_logs rows are not involved.
        Schema::dropIfExists('cirt_activity_log_details');
        Schema::dropIfExists('cirt_activity_log_entries');
    }
};
