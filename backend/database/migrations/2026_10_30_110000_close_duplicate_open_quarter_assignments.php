<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Runs before 2026_10_30_120000 (which refuses to create its unique indexes while
 * duplicate open assignments exist). Closes redundant open rows for the SAME
 * employee + quarter with a zero-length period; nothing is deleted. Safe to run
 * repeatedly. Ambiguous cases (different quarters/employees) are left for a person.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
UPDATE cirt_quarter_assignments a
   SET assigned_to = COALESCE(a.assigned_from, CURRENT_DATE), updated_at = now()
  FROM (
        SELECT id, row_number() OVER (
                   PARTITION BY company_id, employee_id, quarter_id
                   ORDER BY assigned_from NULLS FIRST, created_at, id) AS rn
          FROM cirt_quarter_assignments
         WHERE assigned_to IS NULL
       ) r
 WHERE a.id = r.id AND r.rn > 1
SQL);
    }

    public function down(): void
    {
        // Non-destructive by design.
    }
};
