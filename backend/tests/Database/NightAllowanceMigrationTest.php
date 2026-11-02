<?php

namespace Tests\Database;

use Illuminate\Support\Facades\DB;

/** CIRT-08: migration seeds per-duty rates without changing amounts; finalized payroll is untouched. */
final class NightAllowanceMigrationTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    public function test_per_duty_rate_is_seeded_from_hourly_and_generated_rows_stay_on_hour_basis(): void
    {
        $snapshot = $this->finalizedSnapshot();
        $this->assertSame(0, DB::table('cirt_monthly_payroll')->where('night_allowance_rate_basis', '<>', 'hour')->count());
        foreach (DB::table('cirt_night_allowance_rates')->get() as $r) {
            $this->assertEqualsWithDelta((float) $r->rate_per_hour * 8, (float) $r->rate_per_duty, 0.01, "slab {$r->slab_no}");
        }
        // The one local row that has night allowance: amount unchanged by the new column.
        $row = DB::table('cirt_monthly_payroll')->where('night_allowance_paid', '>', 0)->first();
        if ($row !== null) {
            $this->assertEqualsWithDelta(
                round((float) $row->night_hours * (float) $row->night_allowance_rate),
                (float) $row->night_allowance_paid,
                1.0,
            );
        }
        $this->assertFinalizedUnchanged($snapshot, 'the night allowance migration');
    }
}
