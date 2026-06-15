<?php

namespace App\Enums;

enum UserRole: string
{
    case Admin = 'admin';
    case Employee = 'employee';

    public static function fromStored(?string $value): self
    {
        return $value === self::Employee->value ? self::Employee : self::Admin;
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
