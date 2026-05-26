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
}
