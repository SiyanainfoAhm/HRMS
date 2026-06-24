<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollArrearService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;

$companyId = DB::table('cirt_companies')->orderBy('created_at')->value('id');
if (! $companyId) {
    echo "No company found\n";
    exit(1);
}

$service = new PayrollArrearService(new PayrollCalculationService(), new PayrollMasterService(new PayrollCalculationService()));

echo "=== BASELINE COUNTS ===\n";
echo 'arrear_lines: '.DB::table('cirt_payroll_arrear_lines')->count()."\n";
echo 'arrear_batches: '.DB::table('cirt_payroll_arrear_batches')->count()."\n";
echo 'revision_events: '.DB::table('cirt_da_revision_events')->where('company_id', $companyId)->count()."\n";
echo 'target_da: '.($service->getCurrentTargetDaPercent($companyId) ?? 'null')."\n\n";

foreach ([7, 8, 9, 10] as $month) {
    $preview = $service->previewArrearsForRun($companyId, 2026, $month);
    $gross = 0.0;
    foreach ($preview['employeeTotals'] as $t) {
        $gross += (float) ($t['grossArrear'] ?? 0);
    }
    echo sprintf(
        "Preview %04d-%02d: revisions=%d gross_arrear=%.2f\n",
        2026,
        $month,
        count($preview['batches']),
        $gross,
    );
}

echo "\n=== AFTER PREVIEW (should be unchanged) ===\n";
echo 'arrear_lines: '.DB::table('cirt_payroll_arrear_lines')->count()."\n";
echo 'arrear_batches: '.DB::table('cirt_payroll_arrear_batches')->count()."\n";
