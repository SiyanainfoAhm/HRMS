<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The application refuses to serve payroll requests against a database whose
 * schema is older than the code. Bump REQUIRED_MIGRATION whenever a release
 * needs a new migration.
 */
final class SchemaVersion
{
    public const REQUIRED_MIGRATION = '2026_10_30_130000_payroll_integrity_hardening';

    /** Tables and columns the payroll code reads and writes directly. */
    public const REQUIRED_COLUMNS = [
        'cirt_payroll_drafts' => ['company_id', 'payroll_year', 'payroll_month', 'status', 'version'],
        'cirt_payroll_draft_employees' => ['payroll_draft_id', 'employee_user_id', 'row_payload', 'total_arrears', 'version'],
        'cirt_payroll_master' => ['employee_user_id', 'electricity_mode', 'electricity_applicable', 'effective_to', 'quarter_id'],
        'cirt_quarter_assignments' => ['company_id', 'quarter_id', 'employee_id', 'assigned_from', 'assigned_to', 'rent_at_assignment'],
        'cirt_monthly_payroll' => ['payroll_period_id', 'employee_user_id', 'electricity_mode'],
    ];

    /** @var array{ok: bool, message: string}|null */
    private static ?array $memo = null;

    /** @return array{ok: bool, message: string} */
    public static function status(): array
    {
        if (self::$memo !== null) return self::$memo;

        try {
            if (! Schema::hasTable('migrations')) {
                return self::$memo = ['ok' => false, 'message' => 'Database schema is not initialised (no migrations table). Run: php artisan migrate --force'];
            }
            $found = DB::table('migrations')->where('migration', self::REQUIRED_MIGRATION)->exists();
            if (! $found) {
                $latest = (string) DB::table('migrations')->orderByDesc('id')->value('migration');

                return self::$memo = ['ok' => false, 'message' => sprintf(
                    'Database schema is out of date: this release requires migration "%s" but the latest applied is "%s". Back up the database and run: php artisan migrate --force',
                    self::REQUIRED_MIGRATION,
                    $latest ?: 'none',
                )];
            }
            foreach (self::REQUIRED_COLUMNS as $table => $columns) {
                if (! Schema::hasTable($table)) {
                    return self::$memo = ['ok' => false, 'message' => "Database schema is incomplete: table {$table} is missing."];
                }
                foreach ($columns as $column) {
                    if (! Schema::hasColumn($table, $column)) {
                        return self::$memo = ['ok' => false, 'message' => "Database schema is incomplete: column {$table}.{$column} is missing."];
                    }
                }
            }
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => 'Database schema could not be verified: '.$e->getMessage()];
        }

        return self::$memo = ['ok' => true, 'message' => 'Database schema matches this release.'];
    }

    public static function forget(): void
    {
        self::$memo = null;
    }
}
