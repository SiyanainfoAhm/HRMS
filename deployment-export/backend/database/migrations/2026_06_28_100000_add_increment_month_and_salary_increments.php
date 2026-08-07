<?php

use App\Support\IncrementMonth;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_master') && ! Schema::hasColumn('cirt_payroll_master', 'increment_month')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                $table->string('increment_month', 16)->default(IncrementMonth::DEFAULT)->after('pay_level');
            });

            DB::table('cirt_payroll_master')
                ->whereNull('increment_month')
                ->orWhere('increment_month', '')
                ->update(['increment_month' => IncrementMonth::DEFAULT]);
        }

        if (Schema::hasTable('cirt_payroll_master_history') && ! Schema::hasColumn('cirt_payroll_master_history', 'increment_month')) {
            Schema::table('cirt_payroll_master_history', function (Blueprint $table) {
                $table->string('increment_month', 16)->default(IncrementMonth::DEFAULT)->after('pay_level');
            });

            DB::table('cirt_payroll_master_history')
                ->whereNull('increment_month')
                ->orWhere('increment_month', '')
                ->update(['increment_month' => IncrementMonth::DEFAULT]);
        }

        if (! Schema::hasTable('cirt_salary_increments')) {
            Schema::create('cirt_salary_increments', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->uuid('employee_id')->nullable();
                $table->uuid('employee_user_id')->nullable();
                $table->string('employee_code', 64)->nullable();
                $table->string('increment_month', 16);
                $table->date('effective_start_date');
                $table->decimal('old_gross_basic', 14, 2);
                $table->decimal('increment_percentage', 8, 2);
                $table->decimal('increment_amount', 14, 2);
                $table->decimal('new_gross_basic', 14, 2);
                $table->uuid('applied_by')->nullable();
                $table->timestamp('applied_at')->nullable();
                $table->string('status', 32)->default('applied');
                $table->text('notes')->nullable();
                $table->timestamps();

                $table->index(['company_id', 'effective_start_date']);
                $table->index(['company_id', 'increment_month']);
                $table->unique(
                    ['company_id', 'employee_user_id', 'effective_start_date'],
                    'cirt_salary_increments_emp_effective_unique',
                );
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_salary_increments');

        if (Schema::hasTable('cirt_payroll_master_history') && Schema::hasColumn('cirt_payroll_master_history', 'increment_month')) {
            Schema::table('cirt_payroll_master_history', function (Blueprint $table) {
                $table->dropColumn('increment_month');
            });
        }

        if (Schema::hasTable('cirt_payroll_master') && Schema::hasColumn('cirt_payroll_master', 'increment_month')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                $table->dropColumn('increment_month');
            });
        }
    }
};
