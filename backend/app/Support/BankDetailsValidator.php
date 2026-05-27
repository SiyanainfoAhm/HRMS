<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

class BankDetailsValidator
{
    /**
     * @return array{bank_name: string, bank_account_holder_name: string|null, bank_account_number: string, bank_ifsc: string}
     */
    public static function normalizeAndValidate(array $input, ?string $legalName = null, bool $requireAll = true): array
    {
        $bankName = trim((string) ($input['bank_name'] ?? $input['bankName'] ?? ''));
        $holder = trim((string) ($input['bank_account_holder_name'] ?? $input['bankAccountHolderName'] ?? ''));
        $accountRaw = (string) ($input['bank_account_number'] ?? $input['bankAccountNumber'] ?? '');
        $account = preg_replace('/\D+/', '', $accountRaw) ?? '';
        $ifsc = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) ($input['bank_ifsc'] ?? $input['bankIfsc'] ?? '')) ?? '');

        $errors = [];

        if ($requireAll || $bankName !== '' || $holder !== '' || $account !== '' || $ifsc !== '') {
            if ($bankName === '') {
                $errors['bank_name'] = ['Bank name is required.'];
            } elseif (mb_strlen($bankName) < 2) {
                $errors['bank_name'] = ['Bank name is too short.'];
            }

            if ($holder === '') {
                $errors['bank_account_holder_name'] = ['Account holder name is required.'];
            } elseif (mb_strlen($holder) < 2) {
                $errors['bank_account_holder_name'] = ['Account holder name is too short.'];
            } elseif (! preg_match("/^[a-zA-Z\\s.'-]+$/u", $holder)) {
                $errors['bank_account_holder_name'] = ['Account holder name has invalid characters.'];
            } elseif ($legalName !== null && trim($legalName) !== '') {
                $norm = static fn (string $s): string => mb_strtolower(preg_replace('/\s+/', ' ', trim($s)) ?? '');
                if ($norm($holder) !== $norm($legalName)) {
                    $errors['bank_account_holder_name'] = ['Account holder name should match the employee full name.'];
                }
            }

            if ($account === '') {
                $errors['bank_account_number'] = ['Account number is required.'];
            } elseif (! preg_match('/^\d{9,18}$/', $account)) {
                $errors['bank_account_number'] = ['Account number must be 9–18 digits.'];
            }

            if ($ifsc === '') {
                $errors['bank_ifsc'] = ['IFSC is required.'];
            } elseif (! preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc)) {
                $errors['bank_ifsc'] = ['IFSC must be 11 characters (e.g. SBIN0001234).'];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [
            'bank_name' => $bankName,
            'bank_account_holder_name' => $holder !== '' ? $holder : null,
            'bank_account_number' => $account,
            'bank_ifsc' => $ifsc,
        ];
    }

    /** @param  array<string, mixed>  $bank */
    public static function snapshot(array $bank): array
    {
        return [
            'bank_name' => (string) ($bank['bank_name'] ?? ''),
            'bank_account_holder_name' => (string) ($bank['bank_account_holder_name'] ?? ''),
            'bank_account_number' => (string) ($bank['bank_account_number'] ?? ''),
            'bank_ifsc' => (string) ($bank['bank_ifsc'] ?? ''),
        ];
    }

    public static function snapshotFromUser(\App\Models\HrmsUser $user): array
    {
        return self::snapshot([
            'bank_name' => $user->bank_name ?? '',
            'bank_account_holder_name' => $user->bank_account_holder_name ?? '',
            'bank_account_number' => $user->bank_account_number ?? '',
            'bank_ifsc' => $user->bank_ifsc ?? '',
        ]);
    }
}
