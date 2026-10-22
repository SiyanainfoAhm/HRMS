<?php

declare(strict_types=1);

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollAmendmentService;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$periodId = 'a30895ff-b1a4-4775-bd2b-cdf8d6e5004f';
$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$service = $app->make(PayrollAmendmentService::class);
$changes = [['069', 'educationAllowancePaid', 'educationAllowanceActual', 33750.0], ['037', 'encashmentPaid', 'encashmentActual', 869.0]];
$earningKeys = ['basicPaid', 'daPaid', 'hraPaid', 'transportPaid', 'medicalPaid', 'nightAllowancePaid', 'spPayPaid', 'educationAllowancePaid', 'encashmentPaid', 'encashmentDaPaid', 'daArrearsPaid', 'transportArrearsPaid', 'grossArrearsPaid', 'netArrearsPaid'];
$rows = [];
foreach ($changes as [$code, $paidKey, $actualKey, $amount]) {
    $master = HrmsPayrollMaster::query()->where('company_id', $admin->company_id)->where('employee_code', $code)->whereNull('effective_to')->firstOrFail();
    $monthly = HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id', $periodId)->where('employee_user_id', $master->employee_user_id)->firstOrFail();
    $before = $service->snapshotFromMonthly($monthly);
    $row = $before;
    $row['monthlyPayrollId'] = $monthly->id;
    $row[$paidKey] = $amount;
    $row[$actualKey] = $amount;
    // Rebuild the aggregate from the saved components.  Adding the source amount
    // to an existing aggregate would double-count an already persisted value on a
    // safe re-run of this corrective script.
    $row['totalEarnings'] = array_sum(array_map(fn (string $key): float => (float) ($row[$key] ?? 0), $earningKeys))
        + array_sum($row['customEarnings'] ?? []);
    $row['netSalary'] = $row['totalEarnings'] - $before['totalDeductions'];
    $row['governmentMonthly'] = [
        ...$before,
        $paidKey => $amount,
        $actualKey => $amount,
        'totalEarnings' => $row['totalEarnings'],
        'totalDeductions' => $before['totalDeductions'],
        'netSalary' => $row['netSalary'],
    ];
    if ($service->changedFields($before, $row) !== []) {
        $rows[] = $row;
    }
}
$result = $rows === []
    ? ['updated' => 0, 'status' => 'already_reconciled', 'audits' => []]
    : $service->amendGeneratedRows($admin, 'September 2026: CPF-verified FoxPro component correction (TUITION / ENCASH_DA)', $rows);
file_put_contents(__DIR__.'/../outputs/cirt-september-2026-reconciliation/september-verified-amendment-audit.json', json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode($result, JSON_PRETTY_PRINT).PHP_EOL;
