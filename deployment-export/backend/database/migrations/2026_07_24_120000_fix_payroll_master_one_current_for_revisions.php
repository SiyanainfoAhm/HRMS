<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ensure payroll-master soft revisions can INSERT a new current row.
 *
 * - Heal duplicate open rows (keep newest by updated_at/created_at).
 * - Replace any non-partial unique on (company_id, employee_user_id) with
 *   ux_cirt_payroll_master_one_current WHERE effective_to IS NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        // Close duplicate open masters so the partial unique index can be (re)created.
        DB::statement("
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY company_id, employee_user_id
                        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
                    ) AS rn
                FROM cirt_payroll_master
                WHERE employee_user_id IS NOT NULL
                  AND effective_to IS NULL
            )
            UPDATE cirt_payroll_master m
            SET
                effective_to = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
                effective_end_date = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
                updated_at = NOW()
            FROM ranked r
            WHERE m.id = r.id
              AND r.rn > 1
        ");

        DB::statement("
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY company_id, user_id
                        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
                    ) AS rn
                FROM cirt_payroll_master
                WHERE employee_user_id IS NULL
                  AND user_id IS NOT NULL
                  AND effective_to IS NULL
            )
            UPDATE cirt_payroll_master m
            SET
                effective_to = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
                effective_end_date = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
                updated_at = NOW()
            FROM ranked r
            WHERE m.id = r.id
              AND r.rn > 1
        ");

        foreach ([
            'ux_cirt_payroll_master_one_employee',
            'ux_cirt_payroll_master_one_current',
            'ux_cirt_payroll_master_one_current_user',
        ] as $name) {
            DB::statement("ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS {$name}");
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }

        // Drop any other unique indexes on employee_user_id that omit effective_to.
        DB::statement("
            DO \$\$
            DECLARE
              idx record;
            BEGIN
              FOR idx IN
                SELECT indexname AS name
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'cirt_payroll_master'
                  AND indexdef LIKE '%UNIQUE%'
                  AND indexdef LIKE '%employee_user_id%'
                  AND indexdef NOT LIKE '%effective_to%'
              LOOP
                EXECUTE format('DROP INDEX IF EXISTS %I', idx.name);
              END LOOP;
            END \$\$;
        ");

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
        // Keep the corrected partial indexes; do not restore the broken legacy uniques.
    }
};
