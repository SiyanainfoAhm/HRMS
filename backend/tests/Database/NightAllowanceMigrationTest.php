<?php

namespace Tests\Database;

use Illuminate\Support\Facades\DB;

/** CIRT-08: per-duty rates equal the 7th CPC table amounts; finalized payroll is untouched. */
final class NightAllowanceMigrationTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    public function test_per_duty_rate_is_the_table_amount_and_generated_rows_stay_on_their_basis(): void
    {
        $snapshot = $this->finalizedSnapshot();
        foreach (DB::table('cirt_monthly_payroll')->where('night_hours', '>', 0)->get() as $r) {
            $this->assertEqualsWithDelta(\App\Services\NightAllowanceRateService::allowanceAmount((float) $r->night_hours, (float) $r->night_allowance_rate, (string) $r->night_allowance_rate_basis), (float) $r->night_allowance_paid, 0.5, "night allowance follows its stored basis ({$r->night_allowance_rate_basis})");
        }
        foreach (DB::table('cirt_night_allowance_rates')->get() as $r) {
            $this->assertEqualsWithDelta((float) $r->rate_per_hour, (float) $r->rate_per_duty, 0.01, "slab {$r->slab_no}: per-duty rate is the table amount (not 8x)");
        }
        $this->assertFinalizedUnchanged($snapshot, 'the night allowance migration');
    }
}
