<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Runs database/sql/28_payroll_integrity_hardening.sql, which is idempotent and
 * never deletes data. The SQL file stays the single source so a manual psql run
 * and `php artisan migrate` apply exactly the same statements.
 */
return new class extends Migration
{
    public function up(): void
    {
        $path = dirname(__DIR__, 3).'/database/sql/28_payroll_integrity_hardening.sql';
        if (! is_file($path)) {
            throw new RuntimeException("Migration SQL file is missing: {$path}. Deploy the complete release (including the database/sql folder).");
        }
        DB::unprepared((string) file_get_contents($path));
    }

    public function down(): void
    {
        // Non-destructive by design: the closed duplicate rows and the indexes are kept.
    }
};
