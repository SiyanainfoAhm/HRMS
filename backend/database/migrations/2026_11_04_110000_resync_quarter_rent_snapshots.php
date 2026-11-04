<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll reads rent from the Quarters master only. This refreshes the Payroll Master
 * mirror (quarter_id / has_quarter / quarter_rent) of the current master row, which
 * import-created assignments never populated. Assignment rows (including
 * rent_at_assignment) and finalized payroll rows are history and are not touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_quarters') || ! Schema::hasTable('cirt_quarter_assignments')) {
            return;
        }

        // rent_at_assignment is historical assignment data (read by the repair script and kept as
        // an audit record), so it is deliberately NOT rewritten here. Payroll simply stops reading it.

        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        DB::statement(<<<'SQL'
            UPDATE cirt_payroll_master m
               SET quarter_id = q.id, has_quarter = true, quarter_rent = q.monthly_rent
              FROM cirt_quarter_assignments a
              JOIN cirt_quarters q ON q.id = a.quarter_id
             WHERE a.employee_id = m.employee_user_id
               AND a.assigned_to IS NULL
               AND q.status <> 'inactive'
               AND m.effective_to IS NULL
               AND (m.quarter_id IS DISTINCT FROM q.id OR m.has_quarter IS DISTINCT FROM true
                    OR m.quarter_rent IS DISTINCT FROM q.monthly_rent)
        SQL);

        // A current master with no active assignment must not keep claiming a quarter.
        DB::statement(<<<'SQL'
            UPDATE cirt_payroll_master m
               SET quarter_id = NULL, has_quarter = false, quarter_rent = 0
             WHERE m.effective_to IS NULL
               AND (m.has_quarter = true OR m.quarter_id IS NOT NULL OR m.quarter_rent <> 0)
               AND NOT EXISTS (
                   SELECT 1 FROM cirt_quarter_assignments a
                     JOIN cirt_quarters q ON q.id = a.quarter_id
                    WHERE a.employee_id = m.employee_user_id AND a.assigned_to IS NULL AND q.status <> 'inactive')
        SQL);
    }

    public function down(): void
    {
        // Stale snapshot values are intentionally not restored.
    }
};
