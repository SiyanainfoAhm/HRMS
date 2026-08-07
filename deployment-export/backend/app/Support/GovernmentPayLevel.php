<?php

namespace App\Support;

final class GovernmentPayLevel
{
    public const MIN = 1;

    public const MAX = 18;

    /** @return list<int> */
    public static function allowed(): array
    {
        return range(self::MIN, self::MAX);
    }

    public static function isValid(int $level): bool
    {
        return $level >= self::MIN && $level <= self::MAX;
    }

    /**
     * Accepts 1–18 or "Level 1" … "Level 18". Returns null when invalid.
     */
    public static function normalize(mixed $raw): ?int
    {
        if ($raw === null) {
            return null;
        }

        $trimmed = trim((string) $raw);
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('/^level\s*(\d+)$/i', $trimmed, $matches)) {
            $trimmed = $matches[1];
        }

        if (! preg_match('/^\d+$/', $trimmed)) {
            return null;
        }

        $level = (int) $trimmed;

        return self::isValid($level) ? $level : null;
    }

    public static function requiredMessage(): string
    {
        return 'Please select a valid Pay Level.';
    }

    public static function invalidMessage(): string
    {
        return 'Invalid Pay Level. Please update.';
    }

    public static function importInvalidMessage(): string
    {
        return 'Invalid Pay Level. Allowed values are Level 1 to Level 18.';
    }

    public static function label(int $level): string
    {
        return 'Level '.$level;
    }
}
