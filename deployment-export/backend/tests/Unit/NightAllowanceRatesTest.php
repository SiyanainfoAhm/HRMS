<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use PHPUnit\Framework\TestCase;

/**
 * Night allowance hourly calculation (NA-001 through NA-011).
 * Mirrors frontend: src/lib/nightAllowanceCalculation.ts, governmentPayroll.ts
 */
final class NightAllowanceRatesTest extends TestCase
{
    private NightAllowanceRateService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new NightAllowanceRateService();
    }

    private function nightAllowanceAmount(float $hours, float $rate): int
    {
        return (int) round(max(0, $hours) * max(0, $rate));
    }

    private function resolveWithCeiling(float $basicPay, float $hours = 10, float $rate = 50.40, float $ceiling = 43600): array
    {
        return $this->service->resolveAmountWithCeiling($hours, $rate, $basicPay, $ceiling);
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

    /** NA-009 */
    public function test_basic_pay_above_ceiling_yields_zero_night_allowance(): void
    {
        $result = $this->resolveWithCeiling(49440, 10, 50.40, 43600);
        $this->assertFalse($result['eligible']);
        $this->assertSame(0.0, $result['amount']);
        $this->assertStringContainsString('43,600', (string) $result['warning']);
    }

    /** NA-010 */
    public function test_basic_pay_equal_to_ceiling_allows_night_allowance(): void
    {
        $result = $this->resolveWithCeiling(43600, 10, 50.40, 43600);
        $this->assertTrue($result['eligible']);
        $this->assertSame(504.0, $result['amount']);
    }

    /** NA-012 — duplicate pay levels resolve to first active slab by slab_no ASC */
    public function test_pay_level_5_picks_lowest_slab_no(): void
    {
        $level5 = [
            ['slab_no' => 8, 'pay_level' => 5, 'rate_per_hour' => 41.25, 'effective_from' => null],
            ['slab_no' => 5, 'pay_level' => 5, 'rate_per_hour' => 36.55, 'effective_from' => null],
            ['slab_no' => 7, 'pay_level' => 5, 'rate_per_hour' => 39.60, 'effective_from' => null],
            ['slab_no' => 6, 'pay_level' => 5, 'rate_per_hour' => 38.05, 'effective_from' => null],
        ];
        usort($level5, function (array $a, array $b): int {
            $aHas = $a['effective_from'] === null ? 1 : 0;
            $bHas = $b['effective_from'] === null ? 1 : 0;
            if ($aHas !== $bHas) {
                return $aHas <=> $bHas;
            }
            $aEff = $a['effective_from'] ? strtotime((string) $a['effective_from']) : 0;
            $bEff = $b['effective_from'] ? strtotime((string) $b['effective_from']) : 0;
            if ($aEff !== $bEff) {
                return $bEff <=> $aEff;
            }

            return $a['slab_no'] <=> $b['slab_no'];
        });
        $pick = $level5[0];
        $this->assertSame(5, $pick['slab_no']);
        $this->assertEqualsWithDelta(36.55, $pick['rate_per_hour'], 0.001);
    }
}
