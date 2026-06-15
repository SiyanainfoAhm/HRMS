<?php

namespace App\Enums;

enum UserRole: string
{
    case SuperAdmin = 'super_admin';
    case Admin = 'admin';
    case Hr = 'hr';
    case Manager = 'manager';
    case Employee = 'employee';

    public function isManagerial(): bool
    {
        return in_array($this, [self::SuperAdmin, self::Admin, self::Hr], true);
    }

    public static function isManagerialValue(?string $role): bool
    {
        return in_array($role, [self::SuperAdmin->value, self::Admin->value, self::Hr->value], true);
    }
}
