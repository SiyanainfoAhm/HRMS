<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_da_revision_events')) {
            Schema::create('cirt_da_revision_events', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id')->index();
                $table->decimal('old_da_percent', 5, 2);
                $table->decimal('new_da_percent', 5, 2);
                $table->date('effective_from');
                $table->text('revision_reason')->nullable();
                $table->uuid('created_by')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('cirt_payroll_arrear_batches')) {
            Schema::create('cirt_payroll_arrear_batches', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id')->index();
                $table->uuid('payroll_period_id')->nullable()->index();
                $table->uuid('da_revision_event_id')->index();
                $table->unsignedSmallInteger('run_month');
                $table->unsignedSmallInteger('run_year');
                $table->date('arrear_from');
                $table->date('arrear_to');
                $table->string('status', 20)->default('draft'); // draft | finalized | cancelled
                $table->decimal('total_da_arrear', 14, 2)->default(0);
                $table->decimal('total_transport_arrear', 14, 2)->default(0);
                $table->decimal('total_gross_arrear', 14, 2)->default(0);
                $table->decimal('total_cpf_arrear', 14, 2)->default(0);
                $table->decimal('total_net_arrear', 14, 2)->default(0);
                $table->timestamps();

                $table->unique(['company_id', 'da_revision_event_id', 'run_year', 'run_month'], 'cirt_arrear_batch_rev_run_uniq');
            });
        }

        if (! Schema::hasTable('cirt_payroll_arrear_lines')) {
            Schema::create('cirt_payroll_arrear_lines', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('arrear_batch_id')->index();
                $table->uuid('payroll_period_id')->nullable()->index();
                $table->uuid('employee_user_id')->index();
                $table->unsignedSmallInteger('arrear_month');
                $table->unsignedSmallInteger('arrear_year');
                $table->decimal('basic', 14, 2)->default(0);
                $table->decimal('transport_base', 14, 2)->default(0);
                $table->decimal('old_da_percent', 5, 2)->default(0);
                $table->decimal('new_da_percent', 5, 2)->default(0);
                $table->decimal('old_da_amount', 14, 2)->default(0);
                $table->decimal('new_da_amount', 14, 2)->default(0);
                $table->decimal('da_arrear', 14, 2)->default(0);
                $table->decimal('old_transport_amount', 14, 2)->default(0);
                $table->decimal('new_transport_amount', 14, 2)->default(0);
                $table->decimal('transport_arrear', 14, 2)->default(0);
                $table->decimal('gross_arrear', 14, 2)->default(0);
                $table->decimal('cpf_rate', 5, 2)->default(12);
                $table->decimal('cpf_arrear', 14, 2)->default(0);
                $table->decimal('net_arrear', 14, 2)->default(0);
                $table->uuid('source_monthly_payroll_id')->nullable();
                $table->uuid('old_payroll_master_id')->nullable();
                $table->uuid('new_payroll_master_id')->nullable();
                $table->boolean('is_locked')->default(false);
                $table->timestamps();

                $table->unique(
                    ['employee_user_id', 'arrear_month', 'arrear_year', 'arrear_batch_id'],
                    'cirt_arrear_line_emp_month_batch_uniq',
                );
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_monthly_payroll', 'gross_arrear')) {
                    $table->decimal('gross_arrear', 14, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'cpf_arrear')) {
                    $table->decimal('cpf_arrear', 14, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'net_arrear')) {
                    $table->decimal('net_arrear', 14, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'arrear_batch_id')) {
                    $table->uuid('arrear_batch_id')->nullable()->index();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                foreach (['gross_arrear', 'cpf_arrear', 'net_arrear', 'arrear_batch_id'] as $col) {
                    if (Schema::hasColumn('cirt_monthly_payroll', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }

        Schema::dropIfExists('cirt_payroll_arrear_lines');
        Schema::dropIfExists('cirt_payroll_arrear_batches');
        Schema::dropIfExists('cirt_da_revision_events');
    }
};
