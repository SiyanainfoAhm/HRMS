<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Allow closed payroll master rows to remain for cirt_monthly_payroll FK snapshots.
 * Only one open (effective_to IS NULL) row per employee per company.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        foreach ([
            'ux_cirt_payroll_master_one_employee',
            'ux_cirt_payroll_master_one_current',
            'ux_cirt_payroll_master_one_current_user',
        ] as $name) {
            DB::statement("ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS {$name}");
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }

        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
            ON cirt_payroll_master (company_id, employee_user_id)
            WHERE employee_user_id IS NOT NULL AND effective_to IS NULL
        ');
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
            ON cirt_payroll_master (company_id, user_id)
            WHERE employee_user_id IS NULL AND user_id IS NOT NULL AND effective_to IS NULL
        ');
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current');
        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user');

        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
            ON cirt_payroll_master (company_id, employee_user_id)
            WHERE employee_user_id IS NOT NULL
        ');
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
            ON cirt_payroll_master (company_id, user_id)
            WHERE employee_user_id IS NULL AND user_id IS NOT NULL
        ');
    }
};
