<?php

namespace Tests\Unit;

use App\Services\NightAllowanceRateService;
use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Support\Money;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * PHP half of src/lib/exactMoney.test.ts: the same fixture (an independent BigInt oracle), zero tolerance.
 * Every payroll line is rounded ONCE, to the nearest rupee (0.50 up), using integer-paise steps. The fixture
 * carries the expected value for both rules; its "rule" must match Money::WHOLE_RUPEES.
 */
final class MoneyTest extends TestCase
{
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../fixtures/money_cases.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private function expected(array $case): float
    {
        return (float) ($this->fixture()['rule'] === 'rupee' ? $case['expectedRupee'] : $case['expectedPaise']);
    }

    private function named(string $key): float
    {
        $f = $this->fixture();

        return (float) ($f['rule'] === 'rupee' ? $f['named'][$key]['rupee'] : $f['named'][$key]['paise']);
    }

    public function test_the_fixture_rule_matches_the_switch(): void
    {
        $this->assertSame(Money::WHOLE_RUPEES ? 'rupee' : 'paise', $this->fixture()['rule']);
    }

    public function test_percent_proportion_and_round_match_the_shared_cases_exactly(): void
    {
        $f = $this->fixture();
        foreach ($f['percent'] as $c) {
            $this->assertSame($this->expected($c), Money::percentOf($c['amount'], $c['percent']), "{$c['amount']} x {$c['percent']}%");
        }
        foreach ($f['proportion'] as $c) {
            $this->assertSame($this->expected($c), Money::proportion($c['amount'], $c['numerator'], $c['denominator']), "{$c['amount']} x {$c['numerator']}/{$c['denominator']}");
        }
        foreach ($f['round'] as $c) {
            $this->assertSame($this->expected($c), Money::roundMoney($c['value']), "roundMoney({$c['value']})");
        }
    }

    public function test_rounding_is_half_up_and_the_total_is_the_sum_of_rounded_lines(): void
    {
        $this->assertSame(1.0, Money::roundMoney(0.5));
        $this->assertSame(0.0, Money::roundMoney(0.49));
        $this->assertSame(54.0, Money::roundMoney(54.09), 'a typed 54.09 becomes 54');
        $this->assertSame(0.0, Money::sum(0.4, 0.4, 0.4), 'each line is rounded first');
        $this->assertSame(30.0, Money::sum(10.4, 10.4, 10.4));
        $this->assertSame(0.0, Money::roundMoney(null));
        $this->assertSame(0.0, Money::proportion(100, 1, 0), 'zero denominator is guarded');
    }

    public function test_the_examples_from_the_brief(): void
    {
        $this->assertSame(25.0, NightAllowanceRateService::allowanceAmount(8.5, 23.2, 'duty'), 'NDA 8.5h at 23.20/duty = 24.65 -> 25');
        $this->assertSame($this->named('nda_8_5h_at_23_20'), 25.0);
        $this->assertSame(348.0, NightAllowanceRateService::allowanceAmount(120, 23.2, 'duty'));
        $this->assertSame(10000.0, Money::percentOf(33333, 30), 'HRA 30% of 33,333 = 9,999.90 -> 10,000');
        $this->assertSame($this->named('hra_33333_at_30'), 10000.0);
        $this->assertSame(14516.0, Money::proportion(15000, 30, 31), 'HRA prorated 30 of 31 days');
        $this->assertSame(1961.0, Money::proportion(54900, 1, 28), 'EOL 54,900 / 28 days x 1 = 1,960.71 -> 1,961');
        $this->assertSame($this->named('eol_54900_1_of_28'), 1961.0);
        $this->assertSame(2295.0, Money::proportion(45900, 1.5, 30), 'HPL (basic + DA) 45,900 x 3 days x 0.5 / 30');
        $this->assertSame(6120.0, Money::percentOf(50999, 12), 'CPF 12% of 50,999 = 6,119.88 -> 6,120');
    }

    public function test_arrear_lines_are_whole_rupees(): void
    {
        $calc = (new ReflectionClass(PayrollArrearService::class))->newInstanceWithoutConstructor()->calculateMonthArrear(33333, 3600, 50, 53);
        $this->assertSame(999.0, $calc['da_arrear'], '17,666 - 16,667 (16,666.50 rounds up)');
        $this->assertSame(108.0, $calc['transport_arrear']);
        $this->assertSame($calc['da_arrear'] + $calc['transport_arrear'], $calc['gross_arrear']);
        $this->assertSame((float) (int) $calc['cpf_arrear'], $calc['cpf_arrear'], 'CPF arrear is a whole rupee');
        $this->assertSame($calc['gross_arrear'] - $calc['cpf_arrear'], $calc['net_arrear'], 'net arrear = gross - CPF arrear');
    }

    public function test_master_calculation_uses_the_rupee_rule_and_totals_are_exact_sums(): void
    {
        $out = (new PayrollCalculationService)->calculateMaster([
            'gross_basic_pay' => 33333, 'da_percent' => 53, 'hra_percent' => 30, 'medical' => 0,
        ]);
        $this->assertSame(17666.0, $out['da_amount']);
        $this->assertSame(10000.0, $out['hra_amount']);
        $lines = [33333, $out['da_amount'], $out['hra_amount'], $out['medical'] ?? 0, $out['transport_total']];
        $this->assertSame(Money::sum(...$lines), $out['total_earnings'], 'gross is the exact sum of the lines');
        $this->assertSame($out['total_earnings'] - $out['total_deductions'], $out['take_home'], 'gross - deductions = net');
    }

    public function test_typed_paise_are_rounded_in_the_master_calculation(): void
    {
        $out = (new PayrollCalculationService)->calculateMaster([
            'gross_basic_pay' => 33333.4, 'da_percent' => 53, 'hra_percent' => 30, 'medical' => 3000.6, 'mess' => 12.34,
        ]);
        $this->assertSame(33333.0, $out['gross_basic_pay']);
        $this->assertSame(3001.0, $out['medical']);
    }
}
