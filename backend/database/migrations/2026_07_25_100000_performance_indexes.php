<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Performance indexes for payroll list/search/filter paths.
 * Uses IF NOT EXISTS on PostgreSQL; skips when table/column missing.
 */
return new class extends Migration
{
    /** @var list<array{0: string, 1: string, 2: string}> */
    private const INDEXES = [
        ['cirt_users', 'idx_cirt_users_company_id', 'company_id'],
        ['cirt_users', 'idx_cirt_users_email', 'email'],
        ['cirt_users', 'idx_cirt_users_employee_code', 'employee_code'],
        ['cirt_payroll_master', 'idx_cirt_pm_company_id', 'company_id'],
        ['cirt_payroll_master', 'idx_cirt_pm_employee_code', 'employee_code'],
        ['cirt_payroll_master', 'idx_cirt_pm_employee_user_id', 'employee_user_id'],
        ['cirt_payroll_master', 'idx_cirt_pm_employee_id', 'employee_id'],
        ['cirt_payroll_master', 'idx_cirt_pm_department', 'department'],
        ['cirt_payroll_master', 'idx_cirt_pm_division', 'division'],
        ['cirt_payroll_master', 'idx_cirt_pm_designation', 'designation'],
        ['cirt_payroll_master', 'idx_cirt_pm_pay_level', 'pay_level'],
        ['cirt_payroll_master', 'idx_cirt_pm_status', 'status'],
        ['cirt_payroll_master', 'idx_cirt_pm_increment_month', 'increment_month'],
        ['cirt_payroll_master', 'idx_cirt_pm_has_quarter', 'has_quarter'],
        ['cirt_payroll_master', 'idx_cirt_pm_effective_start', 'effective_start_date'],
        ['cirt_payroll_master', 'idx_cirt_pm_effective_end', 'effective_end_date'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_company_id', 'company_id'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_payroll_period_id', 'payroll_period_id'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_employee_user_id', 'employee_user_id'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_payroll_master_id', 'payroll_master_id'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_salary_date', 'salary_date'],
        ['cirt_monthly_payroll', 'idx_cirt_gov_month_year', 'month_year'],
        ['cirt_payroll_periods', 'idx_cirt_periods_company_id', 'company_id'],
        ['cirt_payroll_periods', 'idx_cirt_periods_period_start', 'period_start'],
        ['cirt_payroll_periods', 'idx_cirt_periods_period_end', 'period_end'],
        ['cirt_payroll_periods', 'idx_cirt_periods_status', 'status'],
        ['cirt_payslips', 'idx_cirt_payslips_company_id', 'company_id'],
        ['cirt_payslips', 'idx_cirt_payslips_payroll_period_id', 'payroll_period_id'],
        ['cirt_payslips', 'idx_cirt_payslips_employee_user_id', 'employee_user_id'],
        ['cirt_payroll_field_definitions', 'idx_cirt_pfd_company_id', 'company_id'],
        ['cirt_payroll_field_definitions', 'idx_cirt_pfd_field_group', 'field_group'],
        ['cirt_payroll_field_definitions', 'idx_cirt_pfd_is_active', 'is_active'],
        ['cirt_payroll_field_values', 'idx_cirt_pfv_company_master', 'company_id, payroll_master_id'],
        ['cirt_payroll_field_values', 'idx_cirt_pfv_company_period', 'company_id, payroll_period_id'],
        ['cirt_quarters', 'idx_cirt_quarters_company_id', 'company_id'],
        ['cirt_quarters', 'idx_cirt_quarters_status', 'status'],
        ['cirt_quarter_assignments', 'idx_cirt_qa_company_quarter', 'company_id, quarter_id'],
        ['cirt_quarter_assignments', 'idx_cirt_qa_employee_id', 'employee_id'],
        ['cirt_salary_increments', 'idx_cirt_si_company_employee', 'company_id, employee_user_id'],
        ['cirt_salary_increments', 'idx_cirt_si_effective_start', 'effective_start_date'],
        ['cirt_night_allowance_rates', 'idx_cirt_nar_company_slab', 'company_id, slab_no'],
        ['cirt_payroll_arrear_batches', 'idx_cirt_arrear_batch_company_period', 'company_id, payroll_period_id'],
        ['cirt_payroll_arrear_lines', 'idx_cirt_arrear_line_batch', 'arrear_batch_id'],
        ['cirt_payroll_arrear_lines', 'idx_cirt_arrear_line_employee', 'employee_user_id'],
    ];

    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        foreach (self::INDEXES as [$table, $indexName, $columns]) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            foreach (explode(',', $columns) as $col) {
                $col = trim($col);
                if (! Schema::hasColumn($table, $col)) {
                    continue 2;
                }
            }
            $colsSql = implode(', ', array_map('trim', explode(',', $columns)));
            DB::statement("CREATE INDEX IF NOT EXISTS {$indexName} ON {$table} ({$colsSql})");
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            DB::statement(
                'CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_gov_monthly_period_user
                 ON cirt_monthly_payroll (payroll_period_id, employee_user_id)
                 WHERE payroll_period_id IS NOT NULL AND employee_user_id IS NOT NULL',
            );
        }
    }

    public function down(): void
    {
        // Non-destructive — retain indexes in production.
    }
};
