<?php

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Services\AuthService;
use App\Services\PayrollRunRevisionService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$actor = app(AuthService::class)->findUserForLogin('admin@cirt');
if (! $actor || ! $actor->hasManagerialRole()) throw new RuntimeException('The CIRT admin alias did not resolve to a managerial user.');

final class RollbackRevisionVerification extends RuntimeException
{
    public function __construct(public readonly array $result) { parent::__construct('Rollback verification transaction.'); }
}

try {
    DB::transaction(function () use ($actor): never {
        $period = HrmsPayrollPeriod::query()->where('company_id', $actor->company_id)
            ->whereDate('period_start', '!=', '2026-09-01')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('cirt_monthly_payroll as m')->whereColumn('m.payroll_period_id', 'cirt_payroll_periods.id'))
            ->orderBy('period_start')->firstOrFail();
        $monthly = HrmsGovernmentMonthlyPayroll::query()->where('company_id', $actor->company_id)
            ->where('payroll_period_id', $period->id)->orderBy('id')->firstOrFail();
        $slip = $monthly->payslip_id ? HrmsPayslip::query()->find($monthly->payslip_id) : null;
        $previousRevision = DB::table('cirt_payroll_run_revisions')->where('payroll_period_id', $period->id)->max('revision_no') ?? 0;
        $oldEarnings = (float) $monthly->total_earnings;
        $oldNet = (float) $monthly->net_salary;
        $monthly->forceFill(['total_earnings' => $oldEarnings + 1, 'net_salary' => $oldNet + 1])->save();
        if ($slip) $slip->forceFill(['gross_pay' => (float) $slip->gross_pay + 1, 'net_pay' => (float) $slip->net_pay + 1])->save();

        $service = app(PayrollRunRevisionService::class);
        $first = $service->capture($period, (string) $actor->id, 'regenerated', 'Isolated rollback verification.');
        $retry = $service->capture($period, (string) $actor->id, 'regenerated', 'Isolated rollback verification.');
        $readBack = $service->get((string) $actor->company_id, (string) $first['id']);
        throw new RollbackRevisionVerification([
            'period' => $period->period_name,
            'is_september' => $period->period_start?->format('Y-m-d') === '2026-09-01',
            'revision_number_incremented_once' => (int) $first['revision_no'] === (int) $previousRevision + 1,
            'retry_reused_revision' => $first['id'] === $retry['id'],
            'actor_and_time_recorded' => $first['created_by'] === $actor->id && ! empty($first['created_at']),
            'historical_snapshot_contains_changed_row' => (float) ($readBack['monthly_rows'][0]['total_earnings'] ?? 0) === $oldEarnings + 1,
            'payslip_count_captured' => count($readBack['payslip_rows'] ?? []),
            'persisted' => false,
        ]);
    });
} catch (RollbackRevisionVerification $e) {
    echo json_encode($e->result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
    if (! $e->result['revision_number_incremented_once'] || ! $e->result['retry_reused_revision'] || ! $e->result['actor_and_time_recorded'] || ! $e->result['historical_snapshot_contains_changed_row'] || $e->result['is_september']) exit(1);
}
