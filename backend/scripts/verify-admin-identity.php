<?php

use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$admin = App\Models\HrmsUser::query()->where('email', 'admin@cirt')->first();
$adminAccount = app(App\Services\AuthService::class)->findUserForLogin('admin@cirt');
$result = [
    'database' => Illuminate\Support\Facades\DB::selectOne('select current_database() as database, inet_server_addr()::text as host'),
    'admin_login_exists' => (bool) $admin,
    'admin_role' => $adminAccount?->role?->value,
    'short_login_resolves_to' => $adminAccount?->email,
    'admin_has_employee_record' => $adminAccount ? App\Models\HrmsEmployee::query()->where('user_id', $adminAccount->id)->exists() : null,
    'admin_has_payroll_master' => $adminAccount ? App\Models\HrmsPayrollMaster::query()->where('employee_user_id', $adminAccount->id)->exists() : null,
    'admin_has_monthly_payroll' => $adminAccount ? App\Models\HrmsGovernmentMonthlyPayroll::query()->where('employee_user_id', $adminAccount->id)->exists() : null,
    'managerial_accounts' => App\Models\HrmsUser::query()->whereIn('role', ['admin', 'super_admin', 'payroll_admin', 'hr', 'manager'])
        ->get(['email', 'role'])->map(fn ($user) => ['email' => $user->email, 'role' => $user->role?->value])->all(),
];
echo json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
