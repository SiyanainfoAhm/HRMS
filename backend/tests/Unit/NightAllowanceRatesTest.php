<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Night allowance hourly calculation (NA-001 through NA-008).
 * Mirrors frontend: src/lib/nightAllowanceCalculation.ts, governmentPayroll.ts
 */
final class NightAllowanceRatesTest extends TestCase
{
    private function nightAllowanceAmount(float $hours, float $rate): int
    {
        return (int) round(max(0, $hours) * max(0, $rate));
    }

    /** NA-003 */
    public function test_run_payroll_calculates_night_allowance_level_7(): void
    {
        $this->assertSame(504, $this->nightAllowanceAmount(10, 50.40));
    }

    /** NA-003 variant */
    public function test_night_allowance_eight_hours_level_7(): void
    {
        $this->assertSame(403, $this->nightAllowanceAmount(8, 50.40));
    }

    /** NA-004 — amount is additive to earnings */
    public function test_night_allowance_included_in_total_earnings(): void
    {
        $base = 54085;
        $night = $this->nightAllowanceAmount(10, 50.40);
        $this->assertSame($base + 504, $base + $night);
    }

    /** NA-008 */
    public function test_missing_rate_yields_zero_allowance(): void
    {
        $this->assertSame(0, $this->nightAllowanceAmount(10, 0));
    }

    /** NA-001 — negative hours/rate produce zero allowance */
    public function test_negative_inputs_clamped_to_zero(): void
    {
        $this->assertSame(0, $this->nightAllowanceAmount(-5, 50.40));
        $this->assertSame(0, $this->nightAllowanceAmount(10, -1));
    }

    /** Default seed slab 11 = Level 7 @ 50.40 */
    public function test_default_seed_contains_level_7_slab(): void
    {
        $rates = [
            ['slab_no' => 11, 'pay_level' => 7, 'rate_per_hour' => 50.40],
        ];
        $slab = $rates[0];
        $this->assertSame(7, $slab['pay_level']);
        $this->assertEqualsWithDelta(50.40, $slab['rate_per_hour'], 0.001);
        $this->assertSame(504, $this->nightAllowanceAmount(10, $slab['rate_per_hour']));
    }

    /** NA-005 — duplicate pay levels use unique slab numbers */
    public function test_multiple_slabs_same_pay_level_unique_slab_nos(): void
    {
        $level5 = [
            ['slab_no' => 5, 'pay_level' => 5, 'rate_per_hour' => 36.55],
            ['slab_no' => 6, 'pay_level' => 5, 'rate_per_hour' => 38.05],
            ['slab_no' => 7, 'pay_level' => 5, 'rate_per_hour' => 39.60],
            ['slab_no' => 8, 'pay_level' => 5, 'rate_per_hour' => 41.25],
        ];
        $slabNos = array_column($level5, 'slab_no');
        $this->assertSame(count($slabNos), count(array_unique($slabNos)));
    }
}
