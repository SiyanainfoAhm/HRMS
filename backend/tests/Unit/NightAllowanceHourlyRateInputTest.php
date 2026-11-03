<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use PHPUnit\Framework\TestCase;

/** PHP half of the hourly-rate Settings tests in src/lib/nightAllowanceHourly.test.ts. */
final class NightAllowanceHourlyRateInputTest extends TestCase
{
    private const OFFICIAL_HOURLY = ['23.20', '26.10', '28.85', '32.65', '36.55', '38.05', '39.60', '41.25', '43.50', '46.00', '50.40', '55.45', '58.55', '63.60'];

    public function test_fourteen_stored_values_show_the_official_hourly_list_and_round_trip(): void
    {
        $f = json_decode((string) file_get_contents(__DIR__.'/../fixtures/night_allowance_cases.json'), true, 512, JSON_THROW_ON_ERROR);
        $slabs = array_values(array_filter($f['cases'], fn ($c) => (float) $c['hours'] === 0.0));
        $this->assertCount(14, $slabs);
        foreach ($slabs as $i => $c) {
            $this->assertSame(self::OFFICIAL_HOURLY[$i], number_format(NightAllowanceRateService::hourlyRateForDisplay((float) $c['perDuty']), 2, '.', ''), "slab {$c['slab']} display");
            $this->assertSame((float) $c['perDuty'], NightAllowanceRateService::hourlyToPerDuty(self::OFFICIAL_HOURLY[$i]), "slab {$c['slab']} typed hourly stores exactly 8x");
            $this->assertSame((float) $c['perDuty'], NightAllowanceRateService::hourlyToPerDuty((float) self::OFFICIAL_HOURLY[$i]), "slab {$c['slab']} numeric input");
            foreach ([0, 8, 120, 8.5] as $h) {
                $this->assertSame(
                    NightAllowanceRateService::allowanceAmount((float) $h, (float) $c['perDuty'], 'duty'),
                    NightAllowanceRateService::allowanceAmount((float) $h, NightAllowanceRateService::hourlyToPerDuty(self::OFFICIAL_HOURLY[$i]), 'duty'),
                );
            }
        }
        $this->assertSame(2784.0, NightAllowanceRateService::allowanceAmount(120, NightAllowanceRateService::hourlyToPerDuty('23.20'), 'duty'));
    }

    public function test_no_floating_point_drift_and_validation(): void
    {
        $this->assertSame(2.32, NightAllowanceRateService::hourlyToPerDuty('0.29'));
        $this->assertSame(458.8, NightAllowanceRateService::hourlyToPerDuty('57.35'));
        $this->assertSame(9876.48, NightAllowanceRateService::hourlyToPerDuty('1234.56'));
        $this->assertSame(184.0, NightAllowanceRateService::hourlyToPerDuty('23'));
        foreach (['', '0', '0.00', '-1', '23.205', 'abc', '1e3', '23,2'] as $bad) {
            $this->assertNull(NightAllowanceRateService::hourlyToPerDuty($bad), "rejects '$bad'");
        }
    }
}
