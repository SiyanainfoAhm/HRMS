<?php
declare(strict_types=1);
use App\Models\HrmsUser;use App\Services\EmployeePayrollExportService;use Illuminate\Contracts\Console\Kernel;
require __DIR__.'/../backend/vendor/autoload.php';$app=require __DIR__.'/../backend/bootstrap/app.php';$app->make(Kernel::class)->bootstrap();$u=HrmsUser::where('role','super_admin')->sole();$response=$app->make(EmployeePayrollExportService::class)->export((string)$u->company_id,['a30895ff-b1a4-4775-bd2b-cdf8d6e5004f']);ob_start();$response->sendContent();$bytes=ob_get_clean();$path=__DIR__.'/../outputs/cirt-september-2026-reconciliation/CIRT_September_2026_Persisted_Component_Export.xlsx';file_put_contents($path,$bytes);echo json_encode(['path'=>$path,'bytes'=>strlen($bytes)]),PHP_EOL;
