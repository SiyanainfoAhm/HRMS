<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollMasterService;
use Illuminate\Support\Facades\DB;

$companyId = 'a1dec60e-7a14-440a-a39b-88c02e9e0a93';
$userId = 'a1deb014-9b11-4556-b9f2-06e3a750fc72';

/** @var PayrollMasterService $service */
$service = app(PayrollMasterService::class);

echo "=== BEFORE ===\n";
$before = DB::table('cirt_payroll_master')->where('company_id', $companyId)->select('name', 'da_percent', 'status')->get();
echo json_encode($before, JSON_PRETTY_PRINT)."\n";

$result = $service->revisionizeForCompanyDaHraChange($companyId, 60.0, 30.0, now()->toDateString(), $userId);
echo "=== REVISION RESULT ===\n";
echo json_encode($result, JSON_PRETTY_PRINT)."\n";

echo "=== AFTER ===\n";
$after = DB::table('cirt_payroll_master')->where('company_id', $companyId)->select('name', 'da_percent', 'status')->get();
echo json_encode($after, JSON_PRETTY_PRINT)."\n";
