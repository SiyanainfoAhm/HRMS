<?php

namespace App\Support;

use App\Models\HrmsEmployee;
use App\Models\HrmsUser;

class EmployeeRecordService
{
    /**
     * Return the HRMS_employees row for a user, creating a minimal one when missing.
     * Required for tables that reference employee_id (reimbursements, payslips, etc.).
     */
    public static function forUser(HrmsUser $user): HrmsEmployee
    {
        $existing = HrmsEmployee::where('user_id', $user->id)
            ->where('company_id', $user->company_id)
            ->first();

        if ($existing) {
            return $existing;
        }

        [$firstName, $lastName] = self::splitName($user->name ?: $user->email);

        return HrmsEmployee::create([
            'user_id' => $user->id,
            'company_id' => $user->company_id,
            'employee_code' => $user->employee_code ?: self::generateEmployeeCode(),
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $user->email,
            'phone' => $user->phone,
            'date_of_birth' => $user->date_of_birth,
            'date_of_joining' => $user->date_of_joining,
            'department_id' => $user->department_id,
            'division_id' => $user->division_id,
            'designation_id' => $user->designation_id,
            'shift_id' => $user->shift_id,
            'is_active' => true,
        ]);
    }

    /** @return array{0: string, 1: ?string} */
    private static function splitName(string $name): array
    {
        $name = trim($name);
        if ($name === '') {
            return ['Employee', null];
        }

        $parts = preg_split('/\s+/', $name, 2);

        return [$parts[0], $parts[1] ?? null];
    }

    private static function generateEmployeeCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = 'EMP-';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            if (! HrmsUser::where('employee_code', $code)->exists()
                && ! HrmsEmployee::where('employee_code', $code)->exists()) {
                return $code;
            }
        }

        return 'EMP-'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    }
}
