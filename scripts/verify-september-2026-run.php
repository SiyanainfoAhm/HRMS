<?php

declare(strict_types=1);

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$periodId = 'a30895ff-b1a4-4775-bd2b-cdf8d6e5004f';
$period = HrmsPayrollPeriod::query()->findOrFail($periodId);
$columns = Schema::getColumnListing('cirt_payroll_periods');
$flags = [];
foreach (['is_locked', 'is_approved', 'approved_at', 'finalized_at', 'posted_at', 'paid_at', 'status'] as $column) {
    if (in_array($column, $columns, true)) $flags[$column] = $period->getAttribute($column);
}
echo json_encode([
    'database' => DB::selectOne('select current_database() as database, inet_server_addr()::text as host, inet_server_port() as port'),
    'period' => ['id' => $period->id, 'name' => $period->period_name, 'start' => $period->period_start?->toDateString(), 'end' => $period->period_end?->toDateString(), 'flags' => $flags],
    'monthly_snapshots' => HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id', $periodId)->count(),
    'payslips' => HrmsPayslip::query()->where('payroll_period_id', $periodId)->count(),
    'super_admins' => HrmsUser::query()->where('role', 'super_admin')->count(),
], JSON_PRETTY_PRINT).PHP_EOL;
