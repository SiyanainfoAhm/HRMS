<?php

namespace Tests\Unit;

use App\Support\PayrollTotals;
use PHPUnit\Framework\TestCase;

final class PayrollTotalsTest extends TestCase
{
    private function gm(): array
    {
        return [
            'basicPaid' => 34590, 'daPaid' => 18332.7, 'hraPaid' => 0, 'transportPaid' => 3600,
            'daArrearsPaid' => 1000, 'transportArrearsPaid' => 200, 'grossArrear' => 1200,
            'deductions' => ['pt' => 200, 'cpf' => 5000, 'electricity' => 98, 'water' => 314, 'mess' => 25, 'quarterRent' => 138],
            'cpfArrear' => 50,
            'totalEarnings' => 57722.7,
            'totalDeductions' => 5825,
            'netSalary' => 51897.7,
        ];
    }

    public function test_consistent_snapshot_has_no_issues(): void
    {
        $this->assertSame([], PayrollTotals::reconcile($this->gm()));
    }

    public function test_gross_arrear_is_not_double_counted_when_it_equals_da_plus_tr(): void
    {
        $this->assertSame(0.0, PayrollTotals::supplementalGrossArrear($this->gm()));
        $gm = $this->gm();
        $gm['grossArrear'] = 1500; // 300 recorded only as gross arrear
        $this->assertSame(300.0, PayrollTotals::supplementalGrossArrear($gm));
    }

    public function test_net_must_equal_gross_minus_deductions(): void
    {
        $gm = $this->gm();
        $gm['netSalary'] = 52000;
        $this->assertArrayHasKey('netSalary', PayrollTotals::reconcile($gm));
    }

    public function test_stale_electricity_in_total_is_detected(): void
    {
        $gm = $this->gm();
        $gm['deductions']['electricity'] = 49; // component edited, aggregate not
        $this->assertArrayHasKey('totalDeductions', PayrollTotals::reconcile($gm));
    }

    public function test_zero_negative_and_non_numeric_totals(): void
    {
        $this->assertSame([], PayrollTotals::reconcile(['totalEarnings' => 0, 'totalDeductions' => 0, 'netSalary' => 0]));
        $this->assertArrayHasKey('totals', PayrollTotals::reconcile(['totalEarnings' => 'x', 'totalDeductions' => 0, 'netSalary' => 0]));
        $this->assertArrayHasKey('totals', PayrollTotals::reconcile([]));
        $this->assertSame(0.0, PayrollTotals::amount(-5));
        $this->assertSame(1.01, PayrollTotals::amount('1.005')); // 2-dp half-up
    }

    public function test_custom_fields_are_bounded_by_their_values(): void
    {
        $gm = ['basicPaid' => 1000, 'customEarnings' => ['x' => 200], 'deductions' => ['pt' => 100],
            'totalEarnings' => 1200, 'totalDeductions' => 100, 'netSalary' => 1100];
        $this->assertSame([], PayrollTotals::reconcile($gm));
        $gm['totalEarnings'] = 1300;
        $gm['netSalary'] = 1200;
        $this->assertArrayHasKey('totalEarnings', PayrollTotals::reconcile($gm));
    }
}
