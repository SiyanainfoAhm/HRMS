<?php

declare(strict_types=1);

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollFieldService;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$fields = $app->make(PayrollFieldService::class);
$fields->ensureCompanyDefaults((string) $admin->company_id, (string) $admin->id);

$changes = [
    ['employee_code' => '069', 'cpf_no' => '205', 'field_key' => 'education_allowance', 'amount' => 33750.0, 'source' => 'FoxPro TUITION'],
    ['employee_code' => '037', 'cpf_no' => '554', 'field_key' => 'encashment', 'amount' => 869.0, 'source' => 'FoxPro ENCASH_DA'],
];
$audit = ['at' => now()->toIso8601String(), 'actor_id' => $admin->id, 'company_id' => $admin->company_id, 'changes' => []];
foreach ($changes as $change) {
    $master = HrmsPayrollMaster::query()
        ->where('company_id', $admin->company_id)
        ->where('employee_code', $change['employee_code'])
        ->whereNull('effective_to')
        ->firstOrFail();
    if (trim((string) $master->cpf_no) !== $change['cpf_no']) {
        throw new RuntimeException("CPF verification failed for employee {$change['employee_code']}.");
    }
    $before = $fields->getCustomFieldValuesForMaster((string) $admin->company_id, (string) $master->id);
    $fields->saveCustomFieldValuesForMaster((string) $admin->company_id, (string) $master->id, (string) $master->employee_user_id, [$change['field_key'] => $change['amount']]);
    $after = $fields->getCustomFieldValuesForMaster((string) $admin->company_id, (string) $master->id);
    $audit['changes'][] = $change + ['master_id' => $master->id, 'before' => $before[$change['field_key']] ?? null, 'after' => $after[$change['field_key']] ?? null];
}

$path = __DIR__.'/../outputs/cirt-september-2026-reconciliation/september-master-verified-component-audit.json';
file_put_contents($path, json_encode($audit, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode($audit, JSON_PRETTY_PRINT).PHP_EOL;
