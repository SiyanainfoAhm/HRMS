<?php

namespace App\Support;

use App\Models\HrmsEmployee;
use App\Models\HrmsEmployeeBankAccount;
use App\Models\HrmsUser;

class BankDetailsService
{
    public static function applyToUser(HrmsUser $user, array $normalized, ?string $createdByUserId = null): void
    {
        $user->bank_name = $normalized['bank_name'];
        $user->bank_account_holder_name = $normalized['bank_account_holder_name'];
        $user->bank_account_number = $normalized['bank_account_number'];
        $user->bank_ifsc = $normalized['bank_ifsc'];
        $user->save();

        HrmsEmployee::where('user_id', $user->id)->update([
            'bank_account_number' => $normalized['bank_account_number'],
            'bank_ifsc' => $normalized['bank_ifsc'],
        ]);

        if ($user->company_id) {
            self::recordHistory($user, $normalized, $createdByUserId ?? $user->id);
        }
    }

    /** @param  array{bank_name: string, bank_account_holder_name: string|null, bank_account_number: string, bank_ifsc: string}  $bank */
    public static function recordHistory(HrmsUser $user, array $bank, ?string $createdBy = null): void
    {
        HrmsEmployeeBankAccount::where('user_id', $user->id)
            ->where('is_active', true)
            ->update(['is_active' => false, 'effective_to' => now()]);

        if ($bank['bank_name'] || $bank['bank_account_number'] || $bank['bank_ifsc']) {
            HrmsEmployeeBankAccount::create([
                'company_id' => $user->company_id,
                'user_id' => $user->id,
                'bank_name' => $bank['bank_name'] ?: null,
                'bank_account_number' => $bank['bank_account_number'] ?: null,
                'bank_ifsc' => $bank['bank_ifsc'] ?: null,
                'is_active' => true,
                'effective_from' => now(),
                'created_by' => $createdBy,
            ]);
        }
    }
}
