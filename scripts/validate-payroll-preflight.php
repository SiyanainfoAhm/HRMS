<?php

declare(strict_types=1);

// Read-only diagnostic. Usage: php scripts/validate-payroll-preflight.php 2026 10
require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsUser;
use Illuminate\Http\Request;

$year = (int) ($argv[1] ?? 0);
$month = (int) ($argv[2] ?? 0);
if ($year < 2000 || $month < 1 || $month > 12) {
    fwrite(STDERR, "Usage: php scripts/validate-payroll-preflight.php YYYY MM\n");
    exit(2);
}

$user = HrmsUser::query()->whereNotNull('company_id')->whereIn('role', ['super_admin', 'admin'])->first();
if (! $user) {
    throw new RuntimeException('No managerial CIRT user is available for a read-only payroll preview.');
}

$request = Request::create('/api/v1/payroll/run/preview', 'GET', ['year' => $year, 'month' => $month, 'all' => '1']);
$request->setUserResolver(static fn () => $user);
$payload = app(PayrollController::class)->runPreview($request)->getData(true);
$preview = $payload['preview'] ?? [];
$validation = $preview['prePayrollValidation'] ?? [];

echo json_encode([
    'period' => $preview['periodName'] ?? sprintf('%04d-%02d', $year, $month),
    'alreadyRun' => $preview['alreadyRun'] ?? null,
    'employeesExamined' => count($preview['rows'] ?? []),
    'canCalculate' => $validation['canCalculate'] ?? false,
    'blockingErrorCount' => $validation['blockingErrorCount'] ?? null,
    'warningCount' => $validation['warningCount'] ?? null,
    'blockingErrors' => $validation['blockingErrors'] ?? [],
    'warnings' => $validation['warnings'] ?? [],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;
