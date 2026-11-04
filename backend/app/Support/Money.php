<?php

namespace App\Support;

/**
 * The single money rule for payroll amounts: every line is a WHOLE RUPEE, rounded to the nearest rupee
 * (0.50 rounds up) ONCE per line (CIRT decision). Gross, Total Earnings, Total Deductions and Net are
 * the exact sums of the rounded lines. Percentage and proration products are worked out in integer
 * paise and rounded a single time, so floats cannot drift.
 *
 * To go back to paise, flip WHOLE_RUPEES here AND MONEY_WHOLE_RUPEES in src/lib/money.ts, and the
 * "rule" in tests/fixtures/money_cases.json (the shared fixture carries the expected value for both
 * rules; both test suites fail if the three disagree). Mirror: src/lib/money.ts.
 */
final class Money
{
    /** THE switch. true = whole rupees (current rule). false = 2-decimal paise (the previous rule). */
    public const WHOLE_RUPEES = true;

    /** Rounding step in paise: 100 = one rupee, 1 = one paisa. */
    public const STEP_PAISE = self::WHOLE_RUPEES ? 100 : 1;

    /** Integer paise nearest to $n (half up; the tiny bias makes 1.005 count as 1.01, not 1.00). */
    public static function toPaise(float|int|string|null $n): int
    {
        if (! is_numeric($n)) return 0;
        $v = (float) $n;

        return (int) round($v * 100 + ($v >= 0 ? 1e-7 : -1e-7));
    }

    public static function fromPaise(int $paise): float
    {
        return $paise / 100;
    }

    /** Any amount to the money rule: nearest whole rupee, 0.50 up (negatives away from zero). */
    public static function roundMoney(float|int|string|null $n): float
    {
        if (! is_numeric($n)) return 0.0;
        $v = (float) $n;
        $unit = self::STEP_PAISE / 100;
        $steps = (int) floor(abs($v) / $unit + 0.5 + 1e-7);
        $out = ($v < 0 ? -1 : 1) * $steps * $unit;

        return self::WHOLE_RUPEES ? $out + 0.0 : round($out, 2) + 0.0;
    }

    /** Integer division rounded half up (away from zero for negatives). */
    public static function divRoundHalfUp(int $num, int $den): int
    {
        if ($den <= 0) return 0;
        if ($num < 0) return -self::divRoundHalfUp(-$num, $den);

        return intdiv(2 * $num + $den, 2 * $den);
    }

    private static function stepResult(int $num, int $den): float
    {
        return self::fromPaise(self::divRoundHalfUp($num, $den * self::STEP_PAISE) * self::STEP_PAISE) + 0.0;
    }

    /** amount x percent / 100 rounded once (percent may carry 2 decimals). */
    public static function percentOf(float|int|string|null $amount, float|int|string|null $percent): float
    {
        $hundredths = (int) round((is_numeric($percent) ? (float) $percent : 0.0) * 100);

        return self::stepResult(self::toPaise($amount) * $hundredths, 10000);
    }

    /** amount x percent / 100 rounded UP to the next whole rupee (the CPF rule); exact integer arithmetic on paise. */
    public static function percentOfCeil(float|int|string|null $amount, float|int|string|null $percent): float
    {
        $hundredths = (int) round((is_numeric($percent) ? (float) $percent : 0.0) * 100);
        $numerator = self::toPaise($amount) * $hundredths;
        if ($numerator <= 0) return 0.0;

        return (float) intdiv($numerator + 999999, 1000000);
    }

    /** amount x numerator / denominator (pay days / days in month, leave days / calendar days, hours / 8) rounded once. */
    public static function proportion(float|int|string|null $amount, float|int|string|null $numerator, float|int|string|null $denominator): float
    {
        $n = (int) round((is_numeric($numerator) ? (float) $numerator : 0.0) * 100);
        $d = (int) round((is_numeric($denominator) ? (float) $denominator : 0.0) * 100);

        return self::stepResult(self::toPaise($amount) * $n, $d);
    }

    /** Sum of money lines: each line is put on the money grid first, so the total is the exact sum of the lines shown. */
    public static function sum(float|int|string|null ...$values): float
    {
        return self::fromPaise(array_sum(array_map(fn ($v) => self::toPaise(self::roundMoney($v)), $values)));
    }
}
