<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsUser;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-off: set one employee's company-defined earning (for example special_allowance) in an open draft to an amount,
 * through PayrollDraftService::saveDraft with the field token the Run Payroll screen sends for that edit
 * (govCustom_<field_key>), so totals are recalculated and the draft audit entry is the normal one.
 * The employee is identified by the employee code in the row. The dry run executes the real save in a transaction and
 * rolls it back, so the printed Gross / Net are what --apply stores.
 */
class SetDraftCustomEarning extends Command
{
    protected $signature = 'payroll:set-draft-custom-earning
        {code : Employee code (as on the payslip, e.g. 043)}
        {field : Earning field key (e.g. special_allowance)}
        {amount : New amount in whole rupees}
        {--year=2026} {--month=10}
        {--user= : Email or id of the audit user (required)}
        {--note= : Reason stored in the audit entry}
        {--apply : Save (default is a dry run)}';

    protected $description = 'Set one custom earning of one employee in the open draft (normal draft save path; dry run unless --apply)';

    public function handle(PayrollDraftService $drafts): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $apply = (bool) $this->option('apply');
        $amount = $this->argument('amount');
        if (! is_numeric($amount) || (float) $amount < 0) {
            $this->error('amount must be a non-negative number.');

            return self::FAILURE;
        }
        $amount = round((float) $amount);
        $key = (string) $this->argument('field');
        $draft = HrmsPayrollDraft::query()->where('payroll_year', $year)->where('payroll_month', $month)->where('status', HrmsPayrollDraft::STATUS_DRAFT)->first();
        if (! $draft) {
            $this->error('No open draft for that period.');

            return self::FAILURE;
        }
        $companyId = (string) $draft->company_id;
        $u = (string) $this->option('user');
        $user = $u === '' ? null : HrmsUser::query()->where('company_id', $companyId)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
        if (! $user) {
            $this->error('--user (email or id) is required.');

            return self::FAILURE;
        }
        $definition = DB::table('cirt_payroll_field_definitions')->where('company_id', $companyId)->where('field_key', $key)->where('field_group', 'earnings')->where('is_active', true)->first();
        if (! $definition) {
            $this->error("No active earning field '{$key}'.");

            return self::FAILURE;
        }

        $shown = collect($drafts->getDraft($companyId, $year, $month)['employees'])
            ->filter(fn ($e) => (string) ($e['rowPayload']['employeeCode'] ?? '') === (string) $this->argument('code'))->values();
        if ($shown->count() !== 1) {
            $this->error("Employee code '{$this->argument('code')}' matches {$shown->count()} rows in the {$year}-{$month} draft.");

            return self::FAILURE;
        }
        $e = $shown->first();
        $payload = (array) $e['rowPayload'];
        $gm = (array) ($payload['governmentMonthly'] ?? []);
        $gr = (array) ($payload['govRecalc'] ?? []);
        $old = (float) ($gm['customEarnings'][$key] ?? 0);
        $ce = (array) ($gm['customEarnings'] ?? []);
        $ce[$key] = $amount;
        $gm['customEarnings'] = $ce;
        $payload['governmentMonthly'] = $gm;
        $gce = (array) ($gr['customEarnings'] ?? []);
        $gce[$key] = $amount;
        $gr['customEarnings'] = $gce;
        $payload['govRecalc'] = $gr;
        $patch = [['employeeUserId' => (string) $e['employeeUserId'], 'employeeCode' => $e['employeeCode'], 'rowPayload' => $payload, 'changedFields' => ['govCustom_'.$key], 'reason' => (string) $this->option('note')]];

        $this->line(($apply ? 'SAVE' : 'DRY RUN')." {$year}-{$month}, draft v{$draft->version}, employee {$this->argument('code')}: {$key} {$old} -> {$amount}");
        try {
            DB::beginTransaction();
            $result = $drafts->saveDraft($companyId, $year, $month, (string) $user->id, $patch, (int) $draft->version, false);
            $after = collect($result['employees'])->firstWhere('employeeUserId', $e['employeeUserId']);
            $this->line(sprintf('  Gross %s -> %s | Total Ded. %s -> %s | Net %s -> %s', number_format((float) $e['grossPay']), number_format((float) $after['grossPay']),
                number_format((float) $e['totalDeductions']), number_format((float) $after['totalDeductions']), number_format((float) $e['netPay']), number_format((float) $after['netPay'])));
            if ($apply) {
                DB::commit();
                $this->info("Saved; draft is now v{$result['draft']['version']}.");
            } else {
                DB::rollBack();
                $this->info('Dry run: rolled back, nothing saved.');
            }
        } catch (\Throwable $ex) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$ex->getMessage());

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
