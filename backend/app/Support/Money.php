<?php

namespace App\Support;

/**
 * The single money rule for calculated payroll amounts: every line is rounded ONCE, half up, to
 * 2 decimals (paise). Percentage and proration products are worked out in integer paise so floats
 * cannot drift. Mirror: src/lib/money.ts (same cases in both test suites).
 */
final class Money
{
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

    public static function round2(float|int|string|null $n): float
    {
        return self::fromPaise(self::toPaise($n));
    }

    /** Integer division rounded half up (away from zero for negatives). */
    public static function divRoundHalfUp(int $num, int $den): int
    {
        if ($den <= 0) return 0;
        if ($num < 0) return -self::divRoundHalfUp(-$num, $den);

        return intdiv(2 * $num + $den, 2 * $den);
    }

    /** amount x percent / 100, in integer paise (percent may carry 2 decimals). */
    public static function percentOf(float|int|string|null $amount, float|int|string|null $percent): float
    {
        $hundredths = (int) round((is_numeric($percent) ? (float) $percent : 0.0) * 100);

        return self::fromPaise(self::divRoundHalfUp(self::toPaise($amount) * $hundredths, 10000));
    }

    /** amount x numerator / denominator (pay days / days in month, leave days / calendar days), in integer paise. */
    public static function proportion(float|int|string|null $amount, float|int|string|null $numerator, float|int|string|null $denominator): float
    {
        $n = (int) round((is_numeric($numerator) ? (float) $numerator : 0.0) * 100);
        $d = (int) round((is_numeric($denominator) ? (float) $denominator : 0.0) * 100);

        return self::fromPaise(self::divRoundHalfUp(self::toPaise($amount) * $n, $d));
    }

    /** Sum of 2-decimal lines, exact. */
    public static function sum(float|int|string|null ...$values): float
    {
        return self::fromPaise(array_sum(array_map(fn ($v) => self::toPaise($v), $values)));
    }
}
