<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_draft_audits')) return;

        Schema::create('cirt_payroll_draft_audits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('company_id');
            $table->uuid('payroll_draft_id');
            $table->unsignedSmallInteger('payroll_month');
            $table->unsignedSmallInteger('payroll_year');
            $table->string('action', 32);
            $table->unsignedInteger('employee_count')->default(0);
            $table->jsonb('employee_snapshot')->nullable();
            $table->uuid('performed_by')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['company_id', 'payroll_year', 'payroll_month'], 'cirt_draft_audits_period_idx');
            $table->index(['payroll_draft_id', 'created_at'], 'cirt_draft_audits_draft_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_payroll_draft_audits');
    }
};
