<?php

namespace App\Support;

use Carbon\Carbon;
use InvalidArgumentException;

final class IncrementMonth
{
    public const JANUARY = 'January';

    public const JULY = 'July';

    public const DEFAULT = self::JULY;

    /** @return list<string> */
    public static function allowed(): array
    {
        return [self::JANUARY, self::JULY];
    }

    public static function normalize(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }

        $trimmed = trim((string) $raw);
        if ($trimmed === '') {
            return null;
        }

        $lower = mb_strtolower($trimmed);
        if (in_array($lower, ['jan', 'january'], true)) {
            return self::JANUARY;
        }
        if (in_array($lower, ['jul', 'july'], true)) {
            return self::JULY;
        }

        return null;
    }

    public static function defaultEffectiveDate(string $month, int $year): string
    {
        $normalized = self::normalize($month);
        if ($normalized === self::JANUARY) {
            return sprintf('%04d-01-01', $year);
        }
        if ($normalized === self::JULY) {
            return sprintf('%04d-07-01', $year);
        }

        throw new InvalidArgumentException('Increment month must be January or July.');
    }

    public static function effectiveDateMatchesMonth(string $month, string $date): bool
    {
        $normalized = self::normalize($month);
        if ($normalized === null) {
            return false;
        }

        $parsed = Carbon::parse($date);
        $expectedMonth = $normalized === self::JANUARY ? 1 : 7;

        return (int) $parsed->month === $expectedMonth && (int) $parsed->day >= 1;
    }

    public static function duplicateMessage(string $month, int $year): string
    {
        $label = self::normalize($month) ?? trim($month);

        return "Increment already applied for this employee for {$label} {$year}.";
    }

    public static function calculateNewGrossBasic(float $currentGrossBasic, float $incrementPercentage): float
    {
        $incrementAmount = $currentGrossBasic * ($incrementPercentage / 100);

        return round($currentGrossBasic + $incrementAmount);
    }
}
