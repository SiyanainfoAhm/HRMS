<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsUser;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;

require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$run = json_decode(file_get_contents(__DIR__.'/../data/imports/september-2026/.phase2-run-result.json'), true, 512, JSON_THROW_ON_ERROR);
$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$request = Request::create('/api/v1/payroll/export', 'GET', ['periodId' => $run['periodId']]);
$request->setUserResolver(static fn (): HrmsUser => $admin);

$response = $app->make(PayrollController::class)->export($request);
if ($response->getStatusCode() !== 200) {
    fwrite(STDERR, $response->getContent().PHP_EOL);
    exit(1);
}

$output = __DIR__.'/../data/imports/september-2026/.phase2-export.json';
file_put_contents($output, $response->getContent());
$data = json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
fwrite(STDOUT, json_encode([
    'export_file' => $output,
    'payslips' => count($data['payslips'] ?? []),
    'monthly_rows' => count($data['governmentMonthly'] ?? []),
], JSON_PRETTY_PRINT).PHP_EOL);
