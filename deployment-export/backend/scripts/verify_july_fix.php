<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;

$companyId = 'a1dec60e-7a14-440a-a39b-88c02e9e0a93';
$service = new PayrollArrearService(new PayrollCalculationService(), new PayrollMasterService(new PayrollCalculationService()));

$service->generateOrUpdateDraftArrearBatch($companyId, 2026, 7, null);

$count = DB::table('cirt_payroll_arrear_lines')
    ->whereRaw("UPPER(COALESCE(status, 'UNPAID')) NOT IN ('PAID', 'INCLUDED', 'CANCELLED')")
    ->where('arrear_year', 2026)
    ->where('arrear_month', 6)
    ->where('old_da_percent', 58)
    ->where('new_da_percent', 60)
    ->count();

echo "Remaining UNPAID June 58->60 lines: $count\n";

$totals = $service->getEmployeeArrearTotalsForRun($companyId, 2026, 7);
foreach ($totals as $uid => $t) {
    if (($t['grossArrear'] ?? 0) > 0) {
        echo substr($uid, 0, 8)." gross=".$t['grossArrear']."\n";
        foreach ($t['lines'] ?? [] as $line) {
            echo "  month={$line['arrear_month']} old={$line['old_da_percent']} new={$line['new_da_percent']}\n";
        }
    }
}
