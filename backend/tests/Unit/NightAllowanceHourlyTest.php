<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use PHPUnit\Framework\TestCase;

/** PHP half of src/lib/nightAllowanceHourly.test.ts: same fixture, same figures. */
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
        foreach ($f['cases'] as $c) {
            $this->assertSame(
                (float) $c['expected'],
                NightAllowanceRateService::allowanceAmount((float) $c['hours'], (float) $c['perDuty'], 'duty'),
                "slab {$c['slab']} level {$c['level']} {$c['hours']}h at {$c['perDuty']}/duty",
            );
        }
        $this->assertSame(2784.0, NightAllowanceRateService::allowanceAmount(120, 185.6, 'duty'));
        $this->assertSame(23.2, NightAllowanceRateService::hourlyRateForDisplay(185.6));
    }

    public function test_ceiling_is_respected(): void
    {
        $svc = new NightAllowanceRateService;
        $this->assertSame(2784.0, $svc->resolveAmountWithCeiling(120, 185.6, 43600, 43600, false, null, 'duty')['amount']);
        $this->assertSame(0.0, $svc->resolveAmountWithCeiling(120, 185.6, 43601, 43600, false, null, 'duty')['amount']);
    }

    public function test_open_draft_is_moved_to_duty_with_the_slab_rate(): void
    {
        $svc = new NightAllowanceRateService;
        $rates = [['slabNo' => 3, 'payLevel' => 3, 'ratePerHour' => 28.85, 'ratePerDuty' => 230.8, 'effectiveFrom' => '2026-01-01', 'isActive' => true]];
        $payload = [
            'govRecalc' => ['payLevel' => 3, 'nightHours' => 15, 'nightAllowanceRate' => 28.85],
            'governmentMonthly' => ['nightHours' => 15, 'nightAllowanceRate' => 28.85, 'nightAllowancePaid' => 433, 'totalEarnings' => 50000, 'netSalary' => 40000],
            'grossPay' => 50000, 'netPay' => 40000,
        ];
        $r = $svc->normalizeDraftPayloadToDuty($payload, $rates, '2026-10-31');
        $this->assertTrue($r['changed']);
        $this->assertSame('duty', $r['payload']['govRecalc']['nightAllowanceRateBasis']);
        $this->assertSame(230.8, $r['payload']['govRecalc']['nightAllowanceRate']);
        $this->assertEquals(15, $r['payload']['govRecalc']['nightHours'], 'typed hours kept');
        $this->assertEquals(433, $r['payload']['governmentMonthly']['nightAllowancePaid'], '15h x 230.80 / 8 = 432.75 -> 433');
        $this->assertEquals(50000, $r['payload']['governmentMonthly']['totalEarnings']);

        // Idempotent.
        $again = $svc->normalizeDraftPayloadToDuty($r['payload'], $rates, '2026-10-31');
        $this->assertFalse($again['changed']);

        // A wrong amount (hours x per-duty) is corrected and gross/net move by the same delta.
        $wrong = $payload;
        $wrong['governmentMonthly']['nightAllowancePaid'] = 3462;
        $wrong['governmentMonthly']['totalEarnings'] = 53029;
        $wrong['governmentMonthly']['netSalary'] = 43029;
        $fixed = $svc->normalizeDraftPayloadToDuty($wrong, $rates, '2026-10-31');
        $this->assertEquals(433, $fixed['payload']['governmentMonthly']['nightAllowancePaid']);
        $this->assertEquals(50000, $fixed['payload']['governmentMonthly']['totalEarnings']);
        $this->assertEquals(40000, $fixed['payload']['governmentMonthly']['netSalary']);

        // Typed override stays; level without a slab is left alone.
        $typed = $payload;
        $typed['govRecalc']['nightAllowanceManualOverride'] = true;
        $typed['governmentMonthly']['nightAllowancePaid'] = 999;
        $this->assertEquals(999, $svc->normalizeDraftPayloadToDuty($typed, $rates, '2026-10-31')['payload']['governmentMonthly']['nightAllowancePaid']);
        $noSlab = $payload;
        $noSlab['govRecalc']['payLevel'] = 12;
        $this->assertFalse($svc->normalizeDraftPayloadToDuty($noSlab, $rates, '2026-10-31')['changed']);
    }
}
