<?php

namespace App\Support;

final class SensitiveFieldMask
{
    public static function pan(?string $value): string
    {
        $v = preg_replace('/\s+/', '', (string) $value) ?? '';
        if (strlen($v) < 4) {
            return '';
        }

        return str_repeat('X', max(0, strlen($v) - 4)).substr($v, -4);
    }

    public static function aadhaar(?string $value): string
    {
        $digits = preg_replace('/\D+/', '', (string) $value) ?? '';
        if (strlen($digits) < 4) {
            return '';
        }

        return str_repeat('X', max(0, strlen($digits) - 4)).substr($digits, -4);
    }

    public static function bankAccount(?string $value): string
    {
        $digits = preg_replace('/\D+/', '', (string) $value) ?? '';
        if (strlen($digits) < 4) {
            return '';
        }

        return str_repeat('X', max(0, strlen($digits) - 4)).substr($digits, -4);
    }
}
