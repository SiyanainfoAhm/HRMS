<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The division / designation text a payroll row is generated with, saved on the row (division_name / designation_name)
 * so reports show the name as it was for that month even after a Settings rename. Returns [] until the migration
 * 2026_11_04_100000 has been applied, so generation keeps working on an older schema.
 */
final class OrgNameSnapshot
{
    private static ?bool $available = null;

    public static function available(): bool
    {
        return self::$available ??= Schema::hasTable('cirt_monthly_payroll')
            && Schema::hasColumn('cirt_monthly_payroll', 'division_name')
            && Schema::hasColumn('cirt_monthly_payroll', 'designation_name');
    }

    /** For tests that add the columns inside a transaction. */
    public static function forget(): void
    {
        self::$available = null;
    }

    /** @return array{division_name?: ?string, designation_name?: ?string} */
    public static function forMaster(?string $masterId): array
    {
        if ($masterId === null || $masterId === '' || ! self::available()) {
            return [];
        }
        $m = DB::table('cirt_payroll_master')->where('id', $masterId)->first(['division', 'designation']);
        $clean = static fn ($v): ?string => ($t = trim((string) $v)) === '' ? null : $t;

        return ['division_name' => $clean($m->division ?? null), 'designation_name' => $clean($m->designation ?? null)];
    }
}
