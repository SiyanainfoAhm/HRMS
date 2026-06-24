<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;
use Illuminate\Support\Facades\DB;

$companyId = 'a1dec60e-7a14-440a-a39b-88c02e9e0a93';
$calc = new PayrollCalculationService();
$service = new PayrollArrearService($calc, new PayrollMasterService($calc));

echo "=== UNPAID LINES (all) ===\n";
$unpaid = DB::table('cirt_payroll_arrear_lines')
    ->whereRaw("UPPER(COALESCE(status, 'UNPAID')) NOT IN ('PAID', 'INCLUDED')")
    ->select('employee_user_id', 'arrear_year', 'arrear_month', 'old_da_percent', 'new_da_percent', 'status', 'gross_arrear')
    ->orderBy('arrear_year')->orderBy('arrear_month')
    ->limit(15)
    ->get();
echo json_encode($unpaid, JSON_PRETTY_PRINT)."\n";

echo "\n=== JULY BATCH GENERATION ===\n";
$result = $service->generateOrUpdateDraftArrearBatch($companyId, 2026, 7, null);
foreach ($result['employeeTotals'] as $uid => $t) {
    foreach ($t['lines'] ?? [] as $line) {
        echo sprintf(
            "%s month=%d-%02d old=%.0f new=%.0f gross=%.0f\n",
            substr($uid, 0, 8),
            $line['arrear_year'] ?? 0,
            $line['arrear_month'] ?? 0,
            $line['old_da_percent'] ?? 0,
            $line['new_da_percent'] ?? 0,
            $line['gross_arrear'] ?? 0,
        );
    }
}
