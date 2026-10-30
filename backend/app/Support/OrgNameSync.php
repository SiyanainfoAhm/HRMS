<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Division / department / designation are stored by NAME on Payroll Master rows
 * (and designation on users). Renaming one in Settings must carry the new name to
 * those rows, and deleting one that Payroll Master still uses must be refused,
 * otherwise the master keeps a name payroll can no longer resolve.
 */
final class OrgNameSync
{
    private const COLUMNS = ['division', 'department', 'designation'];

    /** Rename on current Payroll Master rows (history keeps what was true then). */
    public static function rename(string $column, string $companyId, string $old, string $new): int
    {
        if (! in_array($column, self::COLUMNS, true) || trim($old) === '' || mb_strtolower(trim($old)) === mb_strtolower(trim($new)) && trim($old) === trim($new)) {
            return 0;
        }
        $count = DB::table('cirt_payroll_master')
            ->where('company_id', $companyId)->whereNull('effective_to')
            ->whereRaw("LOWER(TRIM({$column})) = ?", [mb_strtolower(trim($old))])
            ->update([$column => $new, 'updated_at' => now()]);
        if ($column === 'designation') {
            DB::table('cirt_users')->where('company_id', $companyId)
                ->whereRaw('LOWER(TRIM(designation)) = ?', [mb_strtolower(trim($old))])
                ->update(['designation' => $new]);
        }

        return $count;
    }

    /** Current Payroll Master rows that still use this name. */
    public static function masterUsage(string $column, string $companyId, string $name): int
    {
        if (! in_array($column, self::COLUMNS, true) || trim($name) === '') return 0;

        return DB::table('cirt_payroll_master')
            ->where('company_id', $companyId)->whereNull('effective_to')
            ->whereRaw("LOWER(TRIM({$column})) = ?", [mb_strtolower(trim($name))])
            ->count();
    }
}
