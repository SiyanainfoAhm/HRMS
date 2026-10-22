<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsPayrollMaster;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('cirt:reconcile-september-2026 {--dry-run : Read and validate only} {--apply : Apply only verified idempotent corrections}', function (): int {
    $periodId = 'a30895ff-b1a4-4775-bd2b-cdf8d6e5004f';
    $backup = storage_path('app/backups/cirt_hrms_pre_sep2026_final_reconciliation_20261022.dump');
    if (! is_file($backup) || filesize($backup) < 1024) {
        $this->error('Verified backup is missing or invalid. No action taken.');
        return 2;
    }
    $period = HrmsPayrollPeriod::query()->find($periodId);
    if (! $period || (bool) $period->is_locked) {
        $this->error('September run is missing or locked. No action taken.');
        return 2;
    }
    $snapshotCount = HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id', $periodId)->count();
    $payslipCount = HrmsPayslip::query()->where('payroll_period_id', $periodId)->count();
    if ($snapshotCount !== 83 || $payslipCount !== 83) {
        $this->error("Expected 83 snapshots/payslips; found {$snapshotCount}/{$payslipCount}. No action taken.");
        return 2;
    }
    $targets = [
        ['code' => '069', 'field' => 'education_allowance_paid', 'amount' => 33750.0, 'source' => 'FoxPro TUITION / CPF 205'],
        ['code' => '037', 'field' => 'encashment_paid', 'amount' => 869.0, 'source' => 'FoxPro ENCASH_DA / CPF 554'],
    ];
    $report = [];
    foreach ($targets as $target) {
        $master = HrmsPayrollMaster::query()->where('company_id', $period->company_id)->where('employee_code', $target['code'])->whereNull('effective_to')->first();
        $monthly = $master ? HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id', $periodId)->where('employee_user_id', $master->employee_user_id)->first() : null;
        if (! $monthly) {
            $this->error("Verified employee {$target['code']} has no September snapshot. No action taken.");
            return 2;
        }
        $actual = (float) ($monthly->{$target['field']} ?? 0);
        $report[] = ['employee_code' => $target['code'], 'component' => $target['field'], 'saved' => $actual, 'expected' => $target['amount'], 'source' => $target['source'], 'status' => abs($actual - $target['amount']) < 0.01 ? 'already_persisted' : 'requires_verified_amendment'];
    }
    if ($this->option('apply') && ! $this->option('dry-run')) {
        $pending = array_filter($report, fn (array $row) => $row['status'] !== 'already_persisted');
        if ($pending !== []) {
            $this->error('Verified corrections differ from saved values. Use the audited amendment workflow; no direct totals are written by this command.');
            return 3;
        }
        $this->info('No write required: both verified corrections are already persisted.');
    }
    $totals = DB::table('cirt_monthly_payroll')->where('payroll_period_id', $periodId)->selectRaw('sum(total_earnings) gross, sum(total_deductions) deductions, sum(net_salary) net')->first();
    $this->line(json_encode(['mode' => $this->option('apply') ? 'apply' : 'dry_run', 'run_id' => $periodId, 'backup_bytes' => filesize($backup), 'snapshots' => $snapshotCount, 'payslips' => $payslipCount, 'verified_components' => $report, 'totals' => $totals, 'unresolved' => ['CPF policy', 'Transport policy', 'Electricity tariff/meter evidence', 'GPF identity', 'Arrears classification', 'Special Pay/Telephone split', '082/083/084 identity review']], JSON_PRETTY_PRINT));
    return 0;
})->purpose('Validate and idempotently reconcile only source-verified September 2026 CIRT corrections');
