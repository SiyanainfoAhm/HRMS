<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The 7th CPC Night Duty Allowance table (Level 1 = 23.20 ...) is the amount per DUTY of 8 hours.
 * 2026_07_23_100000 seeded those figures into rate_per_hour and 2026_11_02_120000 then back-filled
 * rate_per_duty = rate_per_hour x 8, so every seeded slab held 8x the table value (185.60 ...).
 *
 * This corrects ONLY slab rows whose stored rate_per_duty is exactly 8x the table value for that
 * (slab_no, pay_level); any other value (edited in Settings, other slabs) is left untouched.
 * Idempotent: once corrected, a row no longer matches. Nothing else is modified; finalized payroll
 * rows, drafts and the legacy rate_per_hour column are not touched here.
 */
return new class extends Migration
{
    /** slab_no => [pay_level, table amount per duty] */
    private const TABLE = [
        1 => [1, 23.20], 2 => [2, 26.10], 3 => [3, 28.85], 4 => [4, 32.65], 5 => [5, 36.55],
        6 => [5, 38.05], 7 => [5, 39.60], 8 => [5, 41.25], 9 => [6, 43.50], 10 => [6, 46.00],
        11 => [7, 50.40], 12 => [8, 55.45], 13 => [8, 58.55], 14 => [9, 63.60],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('cirt_night_allowance_rates') || ! Schema::hasColumn('cirt_night_allowance_rates', 'rate_per_duty')) {
            return;
        }
        foreach (self::TABLE as $slab => [$level, $perDuty]) {
            DB::table('cirt_night_allowance_rates')
                ->where('slab_no', $slab)
                ->where('pay_level', $level)
                ->whereRaw('rate_per_duty = ROUND(?::numeric * 8, 2)', [$perDuty])
                ->update(['rate_per_duty' => $perDuty, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        // Intentionally empty: restoring the 8x values would re-introduce the error.
    }
};
