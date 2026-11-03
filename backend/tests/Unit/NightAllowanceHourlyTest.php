<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use PHPUnit\Framework\TestCase;

/**
 * PHP half of src/lib/nightAllowanceHourly.test.ts: same fixture, same figures.
 * The 7th CPC table (Level 1 = 23.20 ...) is the amount per DUTY of 8 hours: NDA = hours / 8 x rate.
 */
final class NightAllowanceHourlyTest extends TestCase
{
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../fixtures/night_allowance_cases.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function test_all_fourteen_slabs_match_the_shared_cases(): void
    {
        $f = $this->fixture();
        $this->assertCount(56, $f['cases']);
        $table = [23.2, 26.1, 28.85, 32.65, 36.55, 38.05, 39.6, 41.25, 43.5, 46.0, 50.4, 55.45, 58.55, 63.6];
        foreach (array_values(array_filter($f['cases'], fn ($c) => (float) $c['hours'] === 0.0)) as $i => $c) {
            $this->assertSame($table[$i], (float) $c['perDuty'], "slab {$c['slab']} is the table value");
        }
        foreach ($f['cases'] as $c) {
            $this->assertSame(
                (float) $c['expected'],
                NightAllowanceRateService::allowanceAmount((float) $c['hours'], (float) $c['perDuty'], 'duty'),
                "slab {$c['slab']} level {$c['level']} {$c['hours']}h at {$c['perDuty']}/duty",
            );
        }
        $this->assertSame(348.0, NightAllowanceRateService::allowanceAmount(120, 23.2, 'duty'), 'Level 1, 120h = 15 duties x 23.20');
    }

    public function test_ceiling_is_respected(): void
    {
        $svc = new NightAllowanceRateService;
        $this->assertSame(348.0, $svc->resolveAmountWithCeiling(120, 23.2, 43600, 43600, false, null, 'duty')['amount']);
        $this->assertSame(0.0, $svc->resolveAmountWithCeiling(120, 23.2, 43601, 43600, false, null, 'duty')['amount']);
    }

    public function test_rate_row_without_a_per_duty_column_uses_the_legacy_column_as_is(): void
    {
        $this->assertSame(55.45, NightAllowanceRateService::ratePerDuty(null, 55.45), 'no x8');
        $this->assertSame(23.2, NightAllowanceRateService::ratePerDuty('23.20', 999.0), 'stored value wins');
    }

    public function test_open_draft_is_moved_to_duty_and_recalculated_from_the_typed_hours(): void
    {
        $svc = new NightAllowanceRateService;
        $rates = [['slabNo' => 3, 'payLevel' => 3, 'ratePerHour' => 28.85, 'ratePerDuty' => 28.85, 'effectiveFrom' => '2026-01-01', 'isActive' => true]];
        $payload = [
            'govRecalc' => ['payLevel' => 3, 'nightHours' => 15, 'nightAllowanceRate' => 28.85],
            'governmentMonthly' => ['nightHours' => 15, 'nightAllowanceRate' => 28.85, 'nightAllowancePaid' => 433, 'totalEarnings' => 50000, 'netSalary' => 40000],
            'grossPay' => 50000, 'netPay' => 40000,
        ];
        $r = $svc->normalizeDraftPayloadToDuty($payload, $rates, '2026-10-31');
        $this->assertTrue($r['changed']);
        $this->assertSame('duty', $r['payload']['govRecalc']['nightAllowanceRateBasis']);
        $this->assertSame(28.85, $r['payload']['govRecalc']['nightAllowanceRate']);
        $this->assertEquals(15, $r['payload']['govRecalc']['nightHours'], 'typed hours kept');
        $this->assertEqualsWithDelta(54.09, $r['payload']['governmentMonthly']['nightAllowancePaid'], 0.0001, '15h / 8 x 28.85 = 54.09375 -> 54.09');
        $this->assertEqualsWithDelta(50000 - 433 + 54.09, $r['payload']['governmentMonthly']['totalEarnings'], 0.0001);
        $this->assertEqualsWithDelta(40000 - 433 + 54.09, $r['payload']['governmentMonthly']['netSalary'], 0.0001);
        $this->assertEqualsWithDelta(50000 - 433 + 54.09, $r['payload']['grossPay'], 0.0001);

        $again = $svc->normalizeDraftPayloadToDuty($r['payload'], $rates, '2026-10-31');
        $this->assertFalse($again['changed'], 'idempotent');

        // Saved on 'duty' while the slab was 8x too high: exactly 8x is corrected, anything else is not (no threshold).
        $eight = $payload;
        $eight['govRecalc']['nightAllowanceRate'] = 230.8;
        $eight['govRecalc']['nightAllowanceRateBasis'] = 'duty';
        $fixed = $svc->normalizeDraftPayloadToDuty($eight, $rates, '2026-10-31');
        $this->assertTrue($fixed['changed']);
        $this->assertSame(28.85, $fixed['payload']['govRecalc']['nightAllowanceRate']);
        $this->assertEqualsWithDelta(54.09, $fixed['payload']['governmentMonthly']['nightAllowancePaid'], 0.0001);
        $custom = $payload;
        $custom['govRecalc']['nightAllowanceRate'] = 100.0;
        $custom['govRecalc']['nightAllowanceRateBasis'] = 'duty';
        $this->assertFalse($svc->normalizeDraftPayloadToDuty($custom, $rates, '2026-10-31')['changed']);

        // Typed override stays; a level without a slab is left alone.
        $typed = $payload;
        $typed['govRecalc']['nightAllowanceManualOverride'] = true;
        $typed['governmentMonthly']['nightAllowancePaid'] = 999;
        $this->assertEquals(999, $svc->normalizeDraftPayloadToDuty($typed, $rates, '2026-10-31')['payload']['governmentMonthly']['nightAllowancePaid']);
        $noSlab = $payload;
        $noSlab['govRecalc']['payLevel'] = 12;
        $this->assertFalse($svc->normalizeDraftPayloadToDuty($noSlab, $rates, '2026-10-31')['changed']);
    }
}
