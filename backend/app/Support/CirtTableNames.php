<?php

namespace App\Support;

/**
 * Canonical CIRT Payroll table names.
 */
final class CirtTableNames
{
    public static function users(): string
    {
        return 'cirt_users';
    }

    public static function employees(): string
    {
        return 'cirt_employees';
    }
}
