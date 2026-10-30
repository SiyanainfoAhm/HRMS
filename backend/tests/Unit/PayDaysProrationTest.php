<?php

namespace Tests\Unit;

use App\Http\Controllers\Api\V1\PayrollController;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/** Pay days for 28/29/30/31-day months, joiners, leavers and partial runs. */
final class PayDaysProrationTest extends TestCase
{
    private function payDays(?string $join, ?string $leave, int $y, int $m, int $runDay, int $dim): array
    {
        $controller = (new \ReflectionClass(PayrollController::class))->newInstanceWithoutConstructor();
        $method = new ReflectionMethod($controller, 'computePayDaysForPeriod');

        return $method->invoke($controller, $join, $leave, $y, $m, $runDay, $dim);
    }

    public function test_full_month_for_every_month_length(): void
    {
        foreach ([[2026, 2, 28], [2028, 2, 29], [2026, 4, 30], [2026, 12, 31]] as [$y, $m, $dim]) {
            $r = $this->payDays(null, null, $y, $m, $dim, $dim);
            $this->assertSame($dim, $r['payDays'], "{$y}-{$m}");
            $this->assertSame(0, $r['unpaidLeaveDays']);
            $this->assertFalse($r['exclude']);
        }
    }

    public function test_run_day_beyond_month_end_is_capped(): void
    {
        $this->assertSame(28, $this->payDays(null, null, 2026, 2, 31, 28)['payDays']);
    }

    public function test_joiner_mid_month_is_paid_from_joining_day(): void
    {
        $r = $this->payDays('2026-09-11', null, 2026, 9, 30, 30);
        $this->assertSame(20, $r['payDays']);
        $this->assertSame(10, $r['unpaidLeaveDays']);
        $this->assertSame(31, $this->payDays('2026-01-01', null, 2026, 1, 31, 31)['payDays'], 'joined on day 1');
    }

    public function test_leaver_is_paid_to_leaving_day_and_excluded_afterwards(): void
    {
        $this->assertSame(10, $this->payDays(null, '2026-09-10', 2026, 9, 30, 30)['payDays']);
        $this->assertTrue($this->payDays(null, '2026-08-31', 2026, 9, 30, 30)['exclude'], 'left in an earlier month');
        $this->assertSame(30, $this->payDays(null, '2026-10-01', 2026, 9, 30, 30)['payDays'], 'leaves next month');
    }

    public function test_join_and_leave_in_the_same_month_and_future_joiner(): void
    {
        $this->assertSame(6, $this->payDays('2026-09-05', '2026-09-10', 2026, 9, 30, 30)['payDays']);
        $this->assertSame(0, $this->payDays('2026-09-20', '2026-09-10', 2026, 9, 30, 30)['payDays'], 'leaves before joining: no pay, no negative');
        $this->assertTrue($this->payDays('2026-10-01', null, 2026, 9, 30, 30)['exclude'], 'joins next month');
    }

    public function test_partial_run_day_limits_paid_days(): void
    {
        $this->assertSame(15, $this->payDays(null, null, 2026, 9, 15, 30)['payDays']);
        $this->assertSame(1, $this->payDays(null, null, 2026, 9, 0, 30)['payDays'], 'run day below 1 is treated as day 1');
    }
}
