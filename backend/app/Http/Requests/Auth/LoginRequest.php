<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'max:255', function (string $attribute, mixed $value, \Closure $fail): void {
                $identifier = mb_strtolower(trim((string) $value));
                if ($identifier !== 'admin@cirt' && filter_var($identifier, FILTER_VALIDATE_EMAIL) === false) {
                    $fail('Enter a valid email or login identifier.');
                }
            }],
            'password' => ['required', 'string', 'min:1', 'max:255'],
        ];
    }
}
