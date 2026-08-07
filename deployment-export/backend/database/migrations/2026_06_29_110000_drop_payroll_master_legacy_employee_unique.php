<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Drop legacy full unique indexes on payroll master that block salary revisions.
 * Only one open row (effective_to IS NULL) per employee per company is enforced.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        $this->dropLegacyEmployeeUniqueness();

        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current');
        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user');

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

    private function dropLegacyEmployeeUniqueness(): void
    {
        foreach ([
            'ux_cirt_payroll_master_one_employee',
            'ux_cirt_payroll_master_one_current',
            'ux_cirt_payroll_master_one_current_user',
            'cirt_payroll_master_company_id_employee_user_id_unique',
            'HRMS_payroll_master_company_id_employee_user_id_key',
        ] as $name) {
            DB::statement("ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS {$name}");
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }

        // Drop any other non-partial unique indexes on (company_id, employee_user_id).
        DB::statement(<<<'SQL'
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT c.conname AS name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'cirt_payroll_master'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%employee_user_id%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%effective_to%'
  LOOP
    EXECUTE format('ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS %I', idx.name);
  END LOOP;

  FOR idx IN
    SELECT indexname AS name, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'cirt_payroll_master'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%employee_user_id%'
      AND indexdef NOT LIKE '%effective_to%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx.name);
  END LOOP;
END $$;
SQL);
    }
};
