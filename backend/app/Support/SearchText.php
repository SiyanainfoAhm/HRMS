<?php

namespace App\Support;

/**
 * Text normalisation for name searches: case-insensitive, and any run of whitespace (spaces, tabs, non-breaking
 * spaces) counts as one space, with leading / trailing space ignored. "Prakashchandra Sukanraj" therefore finds a
 * master record stored as "Prakashchandra  Sukanraj Dahiya" (two spaces).
 */
final class SearchText
{
    public static function normalize(?string $text): string
    {
        $collapsed = preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}\x{202F}\x{205F}\x{3000}]+/u', ' ', (string) $text);

        return trim(mb_strtolower((string) $collapsed));
    }

    /** True when the normalised search term occurs in the normalised, space-joined parts. An empty term matches. */
    public static function matches(string $term, string ...$parts): bool
    {
        $needle = self::normalize($term);
        if ($needle === '') {
            return true;
        }

        return str_contains(self::normalize(implode(' ', array_filter($parts, static fn (string $p): bool => $p !== ''))), $needle);
    }
}
