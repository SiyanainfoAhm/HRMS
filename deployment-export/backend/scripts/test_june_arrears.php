<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;

$companyId = 'a1dec60e-7a14-440a-a39b-88c02e9e0a93';
$calc = new PayrollCalculationService();
$service = new PayrollArrearService($calc, new PayrollMasterService($calc));

$result = $service->generateOrUpdateDraftArrearBatch($companyId, 2026, 6, null);
$totals = $result['employeeTotals'];
$sample = array_slice($totals, 0, 2, true);
echo "warnings: ".count($result['warnings'])."\n";
echo "batches: ".count($result['batches'])."\n";
echo "employees with arrears: ".count($totals)."\n";
foreach ($totals as $uid => $t) {
    $lines = $t['lines'] ?? [];
    $months = array_map(fn ($l) => ($l['arrear_year'] ?? '?').'-'.($l['arrear_month'] ?? '?'), $lines);
    echo "$uid gross=".($t['grossArrear'] ?? 0)." months=".implode(',', $months)."\n";
}
