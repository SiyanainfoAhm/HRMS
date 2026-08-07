<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_arrear_lines')) {
            return;
        }

        DB::statement("
            DELETE FROM cirt_payroll_arrear_lines
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                        ROW_NUMBER() OVER (
                            PARTITION BY
                                COALESCE(company_id::text, ''),
                                employee_user_id,
                                arrear_year,
                                arrear_month,
                                old_da_percent,
                                new_da_percent
                            ORDER BY
                                CASE
                                    WHEN UPPER(COALESCE(status, '')) IN ('PAID', 'INCLUDED') OR paid_at IS NOT NULL THEN 0
                                    ELSE 1
                                END,
                                created_at DESC NULLS LAST,
                                id DESC
                        ) AS rn
                    FROM cirt_payroll_arrear_lines
                    WHERE UPPER(COALESCE(status, 'UNPAID')) <> 'CANCELLED'
                ) ranked
                WHERE rn > 1
            )
        ");

        DB::statement("
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_arrear_unique_employee_month_da
            ON cirt_payroll_arrear_lines (
                company_id,
                employee_user_id,
                arrear_year,
                arrear_month,
                old_da_percent,
                new_da_percent
            )
            WHERE UPPER(COALESCE(status, 'UNPAID')) <> 'CANCELLED'
        ");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS ux_cirt_arrear_unique_employee_month_da');
    }
};
