<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\HrmsPayrollMaster;
use App\Services\PayrollMasterService;
use Illuminate\Support\Facades\DB;

$rows = DB::table('cirt_payroll_master')
    ->select('id', 'name', 'employee_user_id', 'da_percent', 'hra_percent', 'gross_salary', 'gross_basic_pay', 'effective_to', 'updated_at')
    ->orderBy('name')
    ->get();

echo "=== BEFORE ===\n";
echo json_encode($rows, JSON_PRETTY_PRINT)."\n";

$master = HrmsPayrollMaster::query()->where('name', 'like', '%Punjabi%')->first();
if (! $master) {
    echo "Punjabi not found\n";
    exit(1);
}

/** @var PayrollMasterService $service */
$service = app(PayrollMasterService::class);

$payload = [
    'name' => $master->name,
    'email' => $master->email,
    'designation' => $master->designation ?? 'Pending',
    'payLevel' => (int) ($master->pay_level ?? 1),
    'grossBasicPay' => (float) ($master->gross_basic_pay ?? $master->gross_salary ?? 0),
    'daPercent' => 61.0,
    'hraPercent' => (float) ($master->hra_percent ?? 27),
    'medical' => (float) ($master->medical ?? $master->medical_fixed ?? 500),
    'reasonForChange' => 'Test DA update',
    'effectiveFrom' => ($master->effective_from ?? $master->effective_start_date)?->toDateString() ?? now()->toDateString(),
    'professionalTax' => (float) ($master->professional_tax ?? 0),
    'incomeTax' => (float) ($master->income_tax ?? 0),
    'lic' => (float) ($master->lic ?? 0),
    'mess' => (float) ($master->mess ?? 0),
    'welfare' => (float) ($master->welfare ?? 0),
    'vpf' => (float) ($master->vpf ?? 0),
    'pfLoan' => (float) ($master->pf_loan ?? 0),
    'postOffice' => (float) ($master->post_office ?? 0),
    'creditSociety' => (float) ($master->credit_society ?? 0),
    'standardLicenceFee' => (float) ($master->standard_licence_fee ?? 0),
    'electricity' => (float) ($master->electricity ?? 0),
    'water' => (float) ($master->water ?? 0),
    'horticulture' => (float) ($master->horticulture ?? 0),
    'vehicleCharge' => (float) ($master->vehicle_charge ?? 0),
    'otherDeduction' => (float) ($master->other_deduction ?? 0),
    'advance' => (float) ($master->advance ?? 0),
];

$updated = $service->update($master, $payload, (string) $master->company_id);
$formatted = $service->formatRow($updated->refresh());

echo "=== AFTER UPDATE ===\n";
echo "DB da_percent: ".$updated->da_percent."\n";
echo "formatRow daPercent: ".$formatted['daPercent']."\n";

$dupes = DB::select('SELECT company_id, employee_user_id, COUNT(*) AS total_rows FROM cirt_payroll_master GROUP BY company_id, employee_user_id HAVING COUNT(*) > 1');
echo "=== DUPLICATES ===\n";
echo json_encode($dupes, JSON_PRETTY_PRINT)."\n";
