<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use App\Services\PayrollCalculationService;
use App\Support\Money;
use PHPUnit\Framework\TestCase;

/**
 * PHP half of src/lib/exactMoney.test.ts: the same fixture (an independent BigInt oracle), zero tolerance.
 * Every calculated line is rounded ONCE, half up, to 2 decimals using integer-paise steps.
 */
final class MoneyTest extends TestCase
{
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../fixtures/money_cases.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function test_percent_and_proportion_match_the_shared_cases_exactly(): void
    {
        $f = $this->fixture();
        foreach ($f['percent'] as $c) {
            $this->assertSame((float) $c['expected'], Money::percentOf($c['amount'], $c['percent']), "{$c['amount']} x {$c['percent']}%");
        }
        foreach ($f['proportion'] as $c) {
            $this->assertSame((float) $c['expected'], Money::proportion($c['amount'], $c['numerator'], $c['denominator']), "{$c['amount']} x {$c['numerator']}/{$c['denominator']}");
        }
    }

    public function test_rounding_is_half_up_without_float_drift(): void
    {
        $this->assertSame(1.01, Money::round2(1.005));
        $this->assertSame(2.68, Money::round2(2.675));
        $this->assertSame(-1.01, Money::round2(-1.005));
        $this->assertSame(0.3, Money::sum(0.1, 0.2));
        $this->assertSame(0.0, Money::round2(null));
        $this->assertSame(0.0, Money::proportion(100, 1, 0), 'zero denominator is guarded');
    }

    public function test_the_examples_from_the_brief(): void
    {
        $f = $this->fixture()['named'];
        $this->assertSame(24.65, NightAllowanceRateService::allowanceAmount(8.5, 23.2, 'duty'), 'NDA 8.5h at 23.20/duty');
        $this->assertSame($f['nda_8_5h_at_23_20'], 24.65);
        $this->assertSame(348.0, NightAllowanceRateService::allowanceAmount(120, 23.2, 'duty'));
        $this->assertSame(9999.9, Money::percentOf(33333, 30), 'HRA 30% of 33,333');
        $this->assertSame($f['hra_33333_at_30'], 9999.9);
        $this->assertSame(14516.13, Money::proportion(15000, 30, 31), 'HRA prorated 30 of 31 days');
        $this->assertSame(1960.71, Money::proportion(54900, 1, 28), 'EOL 54,900 / 28 days x 1');
        $this->assertSame($f['eol_54900_1_of_28'], 1960.71);
    }

    public function test_master_calculation_uses_the_paise_rule_and_totals_are_exact_sums(): void
    {
        $out = (new PayrollCalculationService)->calculateMaster([
            'gross_basic_pay' => 33333, 'da_percent' => 53, 'hra_percent' => 30, 'medical' => 0,
        ]);
        $this->assertSame(17666.49, $out['da_amount']);
        $this->assertSame(9999.9, $out['hra_amount']);
        $lines = [33333, $out['da_amount'], $out['hra_amount'], $out['medical'] ?? 0, $out['transport_total']];
        $this->assertSame(Money::sum(...$lines), $out['total_earnings'], 'gross is the exact sum of the lines');
    }
}
