<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** CIRT-03: composite index for the month-range queries of the Post Payroll Downloads and reports. Additive only. */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE INDEX IF NOT EXISTS cirt_monthly_payroll_company_month_idx ON cirt_monthly_payroll (company_id, month_year)');
        DB::statement('CREATE INDEX IF NOT EXISTS cirt_payroll_master_company_employee_from_idx ON cirt_payroll_master (company_id, employee_user_id, effective_from)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS cirt_monthly_payroll_company_month_idx');
        DB::statement('DROP INDEX IF EXISTS cirt_payroll_master_company_employee_from_idx');
    }
};
