<?php

namespace App\Enums;

enum UserRole: string
{
    case Admin = 'admin';
    case Employee = 'employee';

    public static function fromStored(?string $value): self
    {
        return in_array(strtolower(trim((string) $value)), ['admin', 'super_admin', 'payroll_admin', 'hr', 'manager'], true)
            ? self::Admin
            : self::Employee;
    }

    public function isAdmin(): bool
    {
        return $this === self::Admin;
    }

    public function isManagerial(): bool
    {
        return $this === self::Admin;
    }

    public static function isManagerialValue(?string $role): bool
    {
        return self::fromStored($role) === self::Admin;
    }
}
