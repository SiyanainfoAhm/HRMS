<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use PHPUnit\Framework\TestCase;

/** CIRT-08 PHP half of src/lib/nightAllowanceDuty.test.ts: same cases, same figures. */
final class NightAllowanceDutyTest extends TestCase
{
    private const RATE = 403.2;

    public function test_allowance_is_hours_over_eight_times_rate(): void
    {
        $d = NightAllowanceRateService::BASIS_DUTY;
        $this->assertSame(1210.0, NightAllowanceRateService::allowanceAmount(24, self::RATE, $d), '24h = 3 duties = 1209.60 -> 1210');
        $this->assertSame(403.0, NightAllowanceRateService::allowanceAmount(8, self::RATE, $d));
        $this->assertSame(202.0, NightAllowanceRateService::allowanceAmount(4, self::RATE, $d));
        $this->assertSame(504.0, NightAllowanceRateService::allowanceAmount(10, self::RATE, $d));
        $this->assertSame(250.0, NightAllowanceRateService::allowanceAmount(5, 400, $d), '5h x 400 / 8 = 250');
        $this->assertSame(378.0, NightAllowanceRateService::allowanceAmount(7.5, self::RATE, $d));
        $this->assertSame(25.0, NightAllowanceRateService::allowanceAmount(0.5, self::RATE, $d));
        $this->assertSame(0.0, NightAllowanceRateService::allowanceAmount(0, self::RATE, $d));
        $this->assertSame(0.0, NightAllowanceRateService::allowanceAmount(-3, self::RATE, $d));
        $this->assertSame(0.0, NightAllowanceRateService::allowanceAmount(24, -5, $d));
    }

    public function test_legacy_rows_keep_hours_times_rate(): void
    {
        $this->assertSame(63.0, NightAllowanceRateService::allowanceAmount(10, 50.4), 'default basis is per duty');
        $this->assertSame(504.0, NightAllowanceRateService::allowanceAmount(10, 50.4, NightAllowanceRateService::BASIS_HOUR));
        $this->assertTrue(
            abs(NightAllowanceRateService::allowanceAmount(16, 50.4, 'hour') - NightAllowanceRateService::allowanceAmount(16, 50.4 * 8, 'duty')) < 0.5,
            'legacy hour basis stays whole-rupee; both bases are whole rupees',
        );
    }

    public function test_server_recomputes_with_the_basis_stored_on_the_row(): void
    {
        $svc = new NightAllowanceRateService;
        $gm = ['basicPaid' => 30000, 'nightHours' => 24, 'nightAllowanceRate' => self::RATE, 'nightAllowanceRateBasis' => 'duty', 'totalEarnings' => 50000, 'netSalary' => 40000];
        $svc->enforceCeilingOnGovernmentMonthly($gm, 43600);
        $this->assertSame(1210.0, $gm['nightAllowancePaid']);
        $this->assertEqualsWithDelta(51210.0, (float) $gm['totalEarnings'], 0.001);

        $legacy = ['basicPaid' => 30000, 'nightHours' => 10, 'nightAllowanceRate' => 50.4, 'totalEarnings' => 50000, 'netSalary' => 40000];
        $svc->enforceCeilingOnGovernmentMonthly($legacy, 43600);
        $this->assertSame(504.0, $legacy['nightAllowancePaid'], 'row without basis stays hours x rate');
    }

    public function test_rate_per_duty_resolution_from_the_rate_table(): void
    {
        $svc = new NightAllowanceRateService;
        $rates = [
            ['slabNo' => 1, 'payLevel' => 7, 'ratePerHour' => 50.4, 'ratePerDuty' => 403.2, 'effectiveFrom' => '2026-01-01', 'isActive' => true],
            ['slabNo' => 2, 'payLevel' => 8, 'ratePerHour' => 55.45, 'ratePerDuty' => null, 'effectiveFrom' => '2026-01-01', 'isActive' => true],
        ];
        $l7 = $svc->resolveFromPreloadedRates($rates, 7, '2026-09-30');
        $this->assertSame(403.2, $l7['rate']);
        $this->assertSame('duty', $l7['basis']);
        $this->assertSame(55.45, $svc->resolveFromPreloadedRates($rates, 8, '2026-09-30')['rate'], 'no per-duty column: legacy column holds the table amount, no x8');
        $this->assertSame(0.0, $svc->resolveFromPreloadedRates($rates, 3, '2026-09-30')['rate']);
    }
}
