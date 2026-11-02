<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Repairs records corrupted by earlier releases. Dry run unless --apply is given.
 *
 * Guarantees: never deletes a row; never touches a finalized/closed payroll month
 * (any month that has payslips), generated payroll (cirt_monthly_payroll,
 * cirt_payslips) or Payroll Master amounts; typed overrides are preserved.
 *
 *  1. Repeated open quarter assignments for the same employee + quarter are closed
 *     with a zero-length period (kept as history, never active).
 *  2. Open drafts: tariff-billed Electricity that was saved as the Master flat
 *     amount (e.g. 49) is re-derived from the units; the stored arrears total that
 *     counted gross arrear on top of DA + TR is corrected.
 */
class RepairPayrollData extends Command
{
    protected $signature = 'payroll:repair-data {--apply : Write the repairs (default is a dry run)}';

    protected $description = 'Repair duplicate quarter assignments and stale draft values (dry run unless --apply)';

    public function handle(PayrollDraftService $drafts): int
    {
        $apply = (bool) $this->option('apply');
        $this->line($apply ? 'APPLY mode: changes will be written.' : 'DRY RUN: nothing will be written. Re-run with --apply.');
        $summary = ['assignments' => 0, 'draft_rows' => 0];

        DB::transaction(function () use ($drafts, $apply, &$summary): void {
            // 1. Redundant open assignments (same company, employee, quarter).
            $groups = DB::select('SELECT company_id, employee_id, quarter_id FROM cirt_quarter_assignments WHERE assigned_to IS NULL GROUP BY company_id, employee_id, quarter_id HAVING count(*) > 1');
            foreach ($groups as $g) {
                $rows = DB::table('cirt_quarter_assignments')
                    ->where('company_id', $g->company_id)->where('employee_id', $g->employee_id)->where('quarter_id', $g->quarter_id)
                    ->whereNull('assigned_to')->orderBy('assigned_from')->orderBy('created_at')->orderBy('id')->get();
                $keep = $rows->first();
                foreach ($rows->slice(1) as $dup) {
                    $this->line("assignment {$dup->id}: employee {$g->employee_id} quarter {$g->quarter_id} duplicates {$keep->id} -> close");
                    $summary['assignments']++;
                    if ($apply) {
                        DB::table('cirt_quarter_assignments')->where('id', $dup->id)
                            ->update(['assigned_to' => $dup->assigned_from ?? now()->toDateString(), 'updated_at' => now()]);
                    }
                }
            }

            // 2. Open drafts only. A month with payslips is closed and is skipped.
            $openDrafts = HrmsPayrollDraft::query()->where('status', HrmsPayrollDraft::STATUS_DRAFT)->get();
            foreach ($openDrafts as $draft) {
                $year = (int) $draft->payroll_year;
                $month = (int) $draft->payroll_month;
                if ($drafts->isMonthFinalized((string) $draft->company_id, $year, $month)) {
                    $this->line("draft {$year}-{$month}: month is finalized, skipped");
                    continue;
                }
                $touched = false;
                HrmsPayrollDraftEmployee::query()->where('payroll_draft_id', $draft->id)->orderBy('employee_code')->each(
                    function (HrmsPayrollDraftEmployee $row) use ($drafts, $draft, $year, $month, $apply, &$summary, &$touched): void {
                        $result = $drafts->repairStoredDraftRow((string) $draft->company_id, $year, $month, $row, $apply);
                        if (! $result['changed']) return;
                        $touched = true;
                        $summary['draft_rows']++;
                        $detail = collect($result['changes'])->map(fn ($c, $k) => "{$k}: ".json_encode($c['from']).' -> '.json_encode($c['to']))->implode('; ');
                        $this->line("draft {$year}-{$month} employee {$row->employee_code}: {$detail}");
                    },
                );
                if ($apply && $touched) {
                    // Bump the header so a browser holding the old version reloads instead of overwriting.
                    $draft->update(['version' => (int) $draft->version + 1]);
                }
            }
        });

        $this->line(sprintf('%s: %d duplicate assignment(s), %d draft row(s).', $apply ? 'Repaired' : 'Would repair', $summary['assignments'], $summary['draft_rows']));

        return self::SUCCESS;
    }
}
