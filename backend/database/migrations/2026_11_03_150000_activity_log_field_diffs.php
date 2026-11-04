<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * Activity Log: compact field diffs ({field, old, new, type}) on the detail rows, a summary (period, counts, totals)
 * and a subject on the entry, and the indexes behind the Employee / Month filters. All columns are nullable, so older
 * records stay valid and the code writes them only when they exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_activity_log_entries')) {
            Schema::table('cirt_activity_log_entries', function ($table) {
                if (! Schema::hasColumn('cirt_activity_log_entries', 'summary')) $table->jsonb('summary')->nullable();
                if (! Schema::hasColumn('cirt_activity_log_entries', 'subject')) $table->string('subject', 200)->nullable();
            });
            Schema::table('cirt_activity_log_entries', function ($table) {
                if (! Schema::hasIndex('cirt_activity_log_entries', 'cirt_ale_company_period_idx')) $table->index(['company_id', 'payroll_year', 'payroll_month'], 'cirt_ale_company_period_idx');
                if (! Schema::hasIndex('cirt_activity_log_entries', 'cirt_ale_company_actor_idx')) $table->index(['company_id', 'performed_by_name'], 'cirt_ale_company_actor_idx');
            });
        }
        if (Schema::hasTable('cirt_activity_log_details')) {
            Schema::table('cirt_activity_log_details', function ($table) {
                if (! Schema::hasColumn('cirt_activity_log_details', 'diff')) $table->jsonb('diff')->nullable();
                if (! Schema::hasColumn('cirt_activity_log_details', 'change_kind')) $table->string('change_kind', 12)->nullable();
            });
            Schema::table('cirt_activity_log_details', function ($table) {
                if (! Schema::hasIndex('cirt_activity_log_details', 'cirt_ald_employee_idx')) $table->index('employee_user_id', 'cirt_ald_employee_idx');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_activity_log_details')) {
            Schema::table('cirt_activity_log_details', function ($table) {
                $table->dropIndex('cirt_ald_employee_idx');
                $table->dropColumn(['diff', 'change_kind']);
            });
        }
        if (Schema::hasTable('cirt_activity_log_entries')) {
            Schema::table('cirt_activity_log_entries', function ($table) {
                $table->dropIndex('cirt_ale_company_period_idx');
                $table->dropIndex('cirt_ale_company_actor_idx');
                $table->dropColumn(['summary', 'subject']);
            });
        }
    }
};
