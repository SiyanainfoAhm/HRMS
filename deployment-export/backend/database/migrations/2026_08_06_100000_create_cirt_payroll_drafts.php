<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Run Payroll draft persistence (non-finalized monthly edits).
 * Local hrms only until explicitly deployed — does not touch cirt_monthly_payroll.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_drafts')) {
            Schema::create('cirt_payroll_drafts', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->unsignedSmallInteger('payroll_month');
                $table->unsignedSmallInteger('payroll_year');
                $table->string('status', 32)->default('draft'); // draft | finalized | discarded
                $table->unsignedInteger('version')->default(1);
                $table->uuid('created_by')->nullable();
                $table->uuid('updated_by')->nullable();
                $table->timestamp('finalized_at')->nullable();
                $table->uuid('finalized_period_id')->nullable();
                $table->timestamps();

                $table->foreign('company_id')
                    ->references('id')
                    ->on('cirt_institute')
                    ->cascadeOnDelete();

                $table->index(['company_id', 'payroll_year', 'payroll_month'], 'cirt_payroll_drafts_period_idx');
                $table->index(['company_id', 'status'], 'cirt_payroll_drafts_status_idx');
            });

            // One active draft per company/month/year
            DB::statement("
                CREATE UNIQUE INDEX cirt_payroll_drafts_active_unique
                ON cirt_payroll_drafts (company_id, payroll_year, payroll_month)
                WHERE status = 'draft'
            ");
        }

        if (! Schema::hasTable('cirt_payroll_draft_employees')) {
            Schema::create('cirt_payroll_draft_employees', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('payroll_draft_id');
                $table->uuid('employee_user_id');
                $table->string('employee_code', 64)->nullable();
                $table->uuid('payroll_master_id')->nullable();
                $table->decimal('pay_days', 8, 2)->nullable();
                $table->decimal('gross_pay', 14, 2)->nullable();
                $table->decimal('total_earnings', 14, 2)->nullable();
                $table->decimal('total_deductions', 14, 2)->nullable();
                $table->decimal('total_arrears', 14, 2)->nullable();
                $table->decimal('net_pay', 14, 2)->nullable();
                $table->text('remarks')->nullable();
                $table->jsonb('row_payload');
                $table->unsignedInteger('version')->default(1);
                $table->timestamps();

                $table->foreign('payroll_draft_id')
                    ->references('id')
                    ->on('cirt_payroll_drafts')
                    ->cascadeOnDelete();

                $table->foreign('employee_user_id')
                    ->references('id')
                    ->on('cirt_users')
                    ->cascadeOnDelete();

                $table->unique(
                    ['payroll_draft_id', 'employee_user_id'],
                    'cirt_payroll_draft_employees_unique'
                );
                $table->index('employee_user_id', 'cirt_payroll_draft_employees_user_idx');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_payroll_draft_employees');
        Schema::dropIfExists('cirt_payroll_drafts');
    }
};
