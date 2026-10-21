<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsUser;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;

require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$body = json_decode(file_get_contents(__DIR__.'/../data/imports/september-2026/.phase2-run-payload.json'), true, 512, JSON_THROW_ON_ERROR);
$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$request = Request::create('/api/v1/payroll/run', 'POST', $body);
$request->setUserResolver(static fn (): HrmsUser => $admin);

$response = $app->make(PayrollController::class)->run($request);
file_put_contents(__DIR__.'/../data/imports/september-2026/.phase2-run-result.json', $response->getContent());
fwrite(STDOUT, $response->getContent().PHP_EOL);
exit($response->getStatusCode() >= 400 ? 1 : 0);
