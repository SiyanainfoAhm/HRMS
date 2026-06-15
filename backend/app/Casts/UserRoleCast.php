<?php

namespace App\Casts;

use App\Enums\UserRole;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/** Maps legacy stored roles (super_admin, hr, manager) to admin. */
class UserRoleCast implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?UserRole
    {
        if ($value instanceof UserRole) {
            return $value;
        }

        return UserRole::fromStored(is_string($value) ? $value : null);
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value instanceof UserRole) {
            return $value->value;
        }

        if (is_string($value) && $value !== '') {
            return UserRole::fromStored($value)->value;
        }

        return null;
    }
}
