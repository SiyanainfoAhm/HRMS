<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsUser;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;

require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$request = Request::create('/api/v1/payroll/run?year=2026&month=9&runDay=30&all=1', 'GET');
$request->setUserResolver(static fn (): HrmsUser => $admin);

$response = $app->make(PayrollController::class)->runPreview($request);
if ($response->getStatusCode() !== 200) {
    fwrite(STDERR, $response->getContent().PHP_EOL);
    exit(1);
}

$payload = json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
$output = __DIR__.'/../data/imports/september-2026/.phase2-preview.json';
file_put_contents($output, json_encode($payload, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

fwrite(STDOUT, json_encode([
    'preview_file' => $output,
    'rows' => count($payload['preview']['rows'] ?? []),
    'already_run' => $payload['preview']['alreadyRun'] ?? null,
    'period' => $payload['preview']['periodName'] ?? null,
], JSON_PRETTY_PRINT).PHP_EOL);
