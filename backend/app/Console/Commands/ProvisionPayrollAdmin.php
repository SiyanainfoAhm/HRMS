<?php

namespace App\Console\Commands;

use App\Enums\UserRole;
use App\Models\HrmsUser;
use App\Services\DefaultCompanyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

/** Explicit, interactive provisioning for the separate payroll administrator account. */
final class ProvisionPayrollAdmin extends Command
{
    protected $signature = 'cirt:provision-payroll-admin {--login= : Login identifier (defaults to PAYROLL_ADMIN_LOGIN or admin@cirt)}';

    protected $description = 'Securely provision a payroll administrator without creating an employee payroll record';

    public function handle(DefaultCompanyService $companies): int
    {
        $login = mb_strtolower(trim((string) ($this->option('login') ?: config('app.payroll_admin_login', 'admin@cirt'))));
        if ($login === '' || mb_strlen($login) > 255 || preg_match('/\s/', $login)) {
            $this->error('The administrator login identifier is invalid.');

            return self::FAILURE;
        }

        $existing = HrmsUser::query()->whereRaw('LOWER(email) = ?', [$login])->first();
        if ($existing) {
            if ($existing->role?->isManagerial()) {
                $this->info('The configured login already has an administrator role. No account data was changed.');

                return self::SUCCESS;
            }

            $this->error('This login already belongs to a non-administrator account. It was left unchanged.');

            return self::FAILURE;
        }

        $password = (string) $this->secret('Create a strong administrator password');
        $confirmation = (string) $this->secret('Confirm the administrator password');
        if ($password === '' || mb_strlen($password) < 12 || ! hash_equals($password, $confirmation)) {
            $this->error('Use a password with at least 12 characters and enter it identically twice.');

            return self::FAILURE;
        }

        HrmsUser::query()->create([
            'email' => $login,
            'password_hash' => Hash::make($password),
            'name' => 'CIRT Payroll Administrator',
            'role' => UserRole::Admin,
            'auth_provider' => 'password',
            'auth_session_version' => 0,
            'company_id' => $companies->getDefaultCompanyId(),
            'employee_code' => null,
        ]);

        $this->info('Payroll administrator provisioned. No employee payroll master or payslip record was created.');

        return self::SUCCESS;
    }
}
