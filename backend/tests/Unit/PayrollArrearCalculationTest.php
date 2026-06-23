<?php

namespace Tests\Unit;

use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;
use Carbon\Carbon;
use PHPUnit\Framework\TestCase;

final class PayrollArrearCalculationTest extends TestCase
{
    private PayrollArrearService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $calculator = new PayrollCalculationService();
        $this->service = new PayrollArrearService($calculator, new PayrollMasterService($calculator));
    }

    public function test_excel_example_arrear_calculation(): void
    {
        $result = $this->service->calculateMonthArrear(83600, 3600, 58, 60, 0.12);

        $this->assertSame(48488.0, $result['old_da_amount']);
        $this->assertSame(50160.0, $result['new_da_amount']);
        $this->assertSame(1672.0, $result['da_arrear']);
        $this->assertSame(5688.0, $result['old_transport_amount']);
        $this->assertSame(5760.0, $result['new_transport_amount']);
        $this->assertSame(72.0, $result['transport_arrear']);
        $this->assertSame(1744.0, $result['gross_arrear']);
        $this->assertEqualsWithDelta(209.28, $result['cpf_arrear'], 0.01);
        $this->assertEqualsWithDelta(1534.72, $result['net_arrear'], 0.01);
    }

    public function test_arrear_period_jan_to_mar_for_april_run(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-01-01', 2026, 4);
        $this->assertNotNull($period);
        $this->assertSame('2026-01-01', $period['from']->format('Y-m-d'));
        $this->assertSame('2026-03-31', $period['to']->format('Y-m-d'));

        $months = $this->service->monthsInArrearPeriod($period['from'], $period['to']);
        $this->assertCount(3, $months);
        $this->assertSame('2026-01', $months[0]->format('Y-m'));
        $this->assertSame('2026-02', $months[1]->format('Y-m'));
        $this->assertSame('2026-03', $months[2]->format('Y-m'));
        $this->assertSame(3, $this->service->countEligibleArrearMonths($period['from'], $period['to']));
    }

    public function test_three_month_arrear_total_for_april_run(): void
    {
        $oneMonth = $this->service->calculateMonthArrear(83600, 3600, 58, 60, 0.12);
        $this->assertSame(1672.0, $oneMonth['da_arrear']);
        $this->assertSame(72.0, $oneMonth['transport_arrear']);
        $this->assertSame(1744.0, $oneMonth['gross_arrear']);
        $this->assertEqualsWithDelta(209.28, $oneMonth['cpf_arrear'], 0.01);
        $this->assertEqualsWithDelta(1534.72, $oneMonth['net_arrear'], 0.01);

        $this->assertSame(5016.0, $oneMonth['da_arrear'] * 3);
        $this->assertSame(216.0, $oneMonth['transport_arrear'] * 3);
        $this->assertSame(5232.0, $oneMonth['gross_arrear'] * 3);
        $this->assertEqualsWithDelta(627.84, $oneMonth['cpf_arrear'] * 3, 0.01);
        $this->assertEqualsWithDelta(4604.16, $oneMonth['net_arrear'] * 3, 0.01);
    }

    public function test_arrear_period_march_only_for_april_run(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-03-01', 2026, 4);
        $this->assertNotNull($period);
        $this->assertSame('2026-03-01', $period['from']->format('Y-m-d'));
        $this->assertSame('2026-03-31', $period['to']->format('Y-m-d'));

        $months = $this->service->monthsInArrearPeriod($period['from'], $period['to']);
        $this->assertCount(1, $months);
        $this->assertSame('2026-03', $months[0]->format('Y-m'));
    }

    public function test_no_arrears_when_selected_payroll_month_equals_effective_month(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-03-01', 2026, 3);
        $this->assertNull($period);
    }

    public function test_arrear_period_march_to_april_for_may_run(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-03-01', 2026, 5);
        $this->assertNotNull($period);
        $this->assertSame('2026-03-01', $period['from']->format('Y-m-d'));
        $this->assertSame('2026-04-30', $period['to']->format('Y-m-d'));

        $months = $this->service->monthsInArrearPeriod($period['from'], $period['to']);
        $this->assertCount(2, $months);
        $this->assertSame('2026-03', $months[0]->format('Y-m'));
        $this->assertSame('2026-04', $months[1]->format('Y-m'));
    }

    public function test_arrear_period_march_to_may_for_june_run(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-03-01', 2026, 6);
        $this->assertNotNull($period);
        $this->assertSame('2026-03-01', $period['from']->format('Y-m-d'));
        $this->assertSame('2026-05-31', $period['to']->format('Y-m-d'));

        $months = $this->service->monthsInArrearPeriod($period['from'], $period['to']);
        $this->assertCount(3, $months);
        $this->assertSame('2026-03', $months[0]->format('Y-m'));
        $this->assertSame('2026-05', $months[2]->format('Y-m'));
    }

    public function test_no_arrears_when_effective_in_same_run_month(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-06-01', 2026, 6);
        $this->assertNull($period);
    }

    public function test_is_arrear_month_eligible_respects_selected_payroll_month(): void
    {
        $effective = Carbon::parse('2026-03-01')->startOfMonth();
        $this->assertTrue($this->service->isArrearMonthEligible(2026, 3, $effective, 2026, 4));
        $this->assertFalse($this->service->isArrearMonthEligible(2026, 4, $effective, 2026, 4));
        $this->assertFalse($this->service->isArrearMonthEligible(2026, 5, $effective, 2026, 4));
        $this->assertFalse($this->service->isArrearMonthEligible(2026, 2, $effective, 2026, 4));
    }

    public function test_admin_example_arrear_for_april_run(): void
    {
        $result = $this->service->calculateMonthArrear(130000, 3600, 60, 62, 0.12);
        $this->assertSame(2600.0, $result['da_arrear']);
        $this->assertSame(72.0, $result['transport_arrear']);
        $this->assertSame(2672.0, $result['gross_arrear']);
    }

    public function test_transport_arrear_uses_da_percent_not_transport_da_percent(): void
    {
        $result = $this->service->calculateMonthArrear(10000, 3600, 50, 55, 0.12);
        $this->assertSame(round(3600 + 3600 * 50 / 100, 0), $result['old_transport_amount']);
        $this->assertSame(round(3600 + 3600 * 55 / 100, 0), $result['new_transport_amount']);
    }

    public function test_cpf_arrear_uses_custom_rate(): void
    {
        $result = $this->service->calculateMonthArrear(83600, 3600, 58, 60, 0.10);
        $this->assertEqualsWithDelta(174.4, $result['cpf_arrear'], 0.01);
    }

    public function test_dedupe_revision_events_keeps_latest_per_transition(): void
    {
        $make = static function (string $id, float $old, float $new, string $createdAt): object {
            return (object) [
                'id' => $id,
                'effective_from' => Carbon::parse('2026-03-01'),
                'old_da_percent' => $old,
                'new_da_percent' => $new,
                'created_at' => $createdAt,
            ];
        };

        $deduped = $this->service->dedupeRevisionEventsByTransition([
            $make('older-id', 58, 60, '2026-06-01'),
            $make('newer-id', 58, 60, '2026-06-10'),
            $make('other-id', 60, 62, '2026-06-11'),
        ]);

        $this->assertCount(2, $deduped);
        $ids = array_map(static fn ($e) => $e->id, $deduped);
        $this->assertContains('newer-id', $ids);
        $this->assertContains('other-id', $ids);
        $this->assertNotContains('older-id', $ids);
    }

    public function test_may_run_arrear_window_extends_through_april_for_jan_effective(): void
    {
        $period = $this->service->arrearPeriodForRevision('2026-01-01', 2026, 5);
        $this->assertNotNull($period);
        $this->assertSame('2026-01-01', $period['from']->format('Y-m-d'));
        $this->assertSame('2026-04-30', $period['to']->format('Y-m-d'));

        $months = $this->service->monthsInArrearPeriod($period['from'], $period['to']);
        $labels = array_map(static fn (Carbon $m) => $m->format('Y-m'), $months);
        $this->assertContains('2026-01', $labels);
        $this->assertContains('2026-03', $labels);
        $this->assertContains('2026-04', $labels);
        $this->assertNotContains('2026-05', $labels);
    }

    public function test_delta_arrear_amount_is_less_than_full_revision(): void
    {
        $fullRevision = $this->service->calculateMonthArrear(83600, 3600, 58, 62, 0.12);
        $deltaRevision = $this->service->calculateMonthArrear(83600, 3600, 60, 62, 0.12);
        $this->assertGreaterThan($deltaRevision['gross_arrear'], $fullRevision['gross_arrear']);
        $this->assertSame(3344.0, $fullRevision['da_arrear']);
        $this->assertSame(1672.0, $deltaRevision['da_arrear']);
    }
}
