<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Models\HrmsUser;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Re-derives CPF of an open draft from the lines actually paid (a quarter holder's HRA is 0, so no notional HRA in the
 * basis), the same rule the Run Payroll screen and Generate use. Dry run by default: the real save logic runs inside a
 * transaction that is rolled back, so the printed old -> new values are exactly what --apply would store.
 */
class RepairDraftCpf extends Command
{
    protected $signature = 'payroll:repair-draft-cpf
        {--year=2026} {--month=10}
        {--user= : Email or id of the audit user (required with --apply)}
        {--note=CPF re-derived from paid lines (no notional HRA for quarter holders) : Reason stored in each audit entry}
        {--apply : Write the changes (default is a dry run)}';

    protected $description = 'Re-derive CPF in an open draft from the paid lines (dry run unless --apply)';

    public function handle(PayrollDraftService $drafts): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $apply = (bool) $this->option('apply');
        $draft = HrmsPayrollDraft::query()->where('payroll_year', $year)->where('payroll_month', $month)->where('status', HrmsPayrollDraft::STATUS_DRAFT)->first();
        if (! $draft) { $this->error('No open draft for that period.'); return self::FAILURE; }
        if ($drafts->isMonthFinalized((string) $draft->company_id, $year, $month)) { $this->error('That month is finalized.'); return self::FAILURE; }

        $user = null;
        if ($apply) {
            $u = (string) $this->option('user');
            $user = $u === '' ? null : HrmsUser::query()->where('company_id', $draft->company_id)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
            if (! $user) { $this->error('--user (email or id) is required with --apply.'); return self::FAILURE; }
        }

        $this->line(($apply ? 'APPLY' : 'DRY RUN')." {$year}-{$month}, draft v{$draft->version}");
        $changed = 0;
        $fmt = static fn (float $n) => number_format($n, 0, '.', ',');
        DB::beginTransaction();
        try {
            HrmsPayrollDraftEmployee::query()->where('payroll_draft_id', $draft->id)->orderBy('employee_code')->each(function (HrmsPayrollDraftEmployee $row) use ($drafts, $draft, $apply, $user, &$changed, $fmt): void {
                $r = $drafts->repairStoredDraftCpf((string) $draft->company_id, $row, true, $user ? (string) $user->id : null, (string) $this->option('note'));
                if (! $r['changed']) return;
                $changed++;
                $name = (string) ((array) $row->row_payload)['employeeName'];
                $this->line(sprintf('%-5s %-32s CPF %s→%s | Total Deductions %s→%s | Net %s→%s', $row->employee_code, mb_substr($name, 0, 32),
                    $fmt($r['before']['cpf']), $fmt($r['after']['cpf']), $fmt($r['before']['totalDeductions']), $fmt($r['after']['totalDeductions']), $fmt($r['before']['net']), $fmt($r['after']['net'])));
            });
            if ($changed > 0) $draft->update(['version' => (int) $draft->version + 1, 'updated_by' => $user?->id ?? $draft->updated_by]);
            if ($apply) { DB::commit(); $this->info("Applied: {$changed} row(s); draft is now v".($draft->version).'.'); }
            else { DB::rollBack(); $this->info("Dry run: {$changed} row(s) would change; rolled back, nothing saved."); }
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$e->getMessage());
            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
