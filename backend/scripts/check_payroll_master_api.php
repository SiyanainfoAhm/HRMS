<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\PayrollMasterService;

$companyId = 'a1dec60e-7a14-440a-a39b-88c02e9e0a93';
$service = app(PayrollMasterService::class);
$rows = $service->listForCompany($companyId);
echo 'listForCompany count='.count($rows).PHP_EOL;
