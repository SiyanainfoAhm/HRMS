<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Quarter assignment data fix (confirmed by CIRT):
 *  1. Employee 042 (Vijay Pathare): "Quarter 2" was a placeholder for B2/7. Keep ONE B2/7
 *     assignment starting on the earliest Quarter 2 start date, open-ended; drop the
 *     Quarter 2 rows and the separate 2026-11-03 start.
 *  2. Collapse repeated rows of the same employee + quarter into one assignment
 *     (earliest start; open end if any row is open, else latest end).
 *  3. Delete the inactive dummy quarters "Quarter 2" / "Q1- 400" ONLY if nothing references
 *     them any more; otherwise keep them and log what remains.
 * Every changed row is logged (before/after) to the Laravel log under "quarter-data-fix".
 */
return new class extends Migration
{
    private const PATHARE_CODE = '042';

    public function up(): void
    {
        if (! Schema::hasTable('cirt_quarters') || ! Schema::hasTable('cirt_quarter_assignments')) {
            return;
        }

        $this->mergePathare();
        $this->collapseDuplicates();
        $this->deleteDummyQuarters();
    }

    private function mergePathare(): void
    {
        $employeeId = DB::table('cirt_payroll_master')->where('employee_code', self::PATHARE_CODE)->whereNull('effective_to')->value('employee_user_id');
        if (! $employeeId) {
            return;
        }
        $rows = DB::table('cirt_quarter_assignments as a')->join('cirt_quarters as q', 'q.id', '=', 'a.quarter_id')
            ->where('a.employee_id', $employeeId)
            ->get(['a.id', 'a.company_id', 'a.quarter_id', 'q.quarter_name', 'q.status', 'a.assigned_from', 'a.assigned_to', 'a.rent_at_assignment']);
        $placeholder = $rows->where('quarter_name', 'Quarter 2')->where('status', 'inactive');
        $real = $rows->where('quarter_name', 'B2/7')->whereNull('assigned_to');
        if ($placeholder->isEmpty() || $real->count() !== 1) {
            Log::warning('quarter-data-fix: Pathare merge skipped (expected Quarter 2 placeholder rows and exactly one open B2/7 row).', ['rows' => $rows->all()]);

            return;
        }

        $keep = $real->first();
        $start = (string) $placeholder->min('assigned_from');
        Log::info('quarter-data-fix: Pathare BEFORE', ['rows' => $rows->all()]);
        DB::table('cirt_quarter_assignments')->whereIn('id', $placeholder->pluck('id')->all())->delete();
        DB::table('cirt_quarter_assignments')->where('id', $keep->id)->update(['assigned_from' => $start, 'assigned_to' => null, 'updated_at' => now()]);
        Log::info('quarter-data-fix: Pathare AFTER', ['rows' => DB::table('cirt_quarter_assignments')->where('employee_id', $employeeId)->get()->all()]);
    }

    private function collapseDuplicates(): void
    {
        $pairs = DB::table('cirt_quarter_assignments')->select('employee_id', 'quarter_id')
            ->groupBy('employee_id', 'quarter_id')->havingRaw('count(*) > 1')->get();

        foreach ($pairs as $pair) {
            $rows = DB::table('cirt_quarter_assignments')->where('employee_id', $pair->employee_id)->where('quarter_id', $pair->quarter_id)
                ->orderByRaw('assigned_to is null desc')->orderBy('assigned_from')->orderBy('created_at')->get();
            $open = $rows->whereNull('assigned_to');
            // Prefer a row that is already open (it carries the live state); otherwise the latest-ending one.
            $keep = $open->first() ?? $rows->sortByDesc('assigned_to')->first();
            $from = (string) $rows->min('assigned_from');
            $to = $open->isNotEmpty() ? null : (string) $rows->max('assigned_to');

            Log::info('quarter-data-fix: duplicates BEFORE', ['employee_id' => $pair->employee_id, 'quarter_id' => $pair->quarter_id, 'count' => $rows->count(), 'rows' => $rows->all()]);
            DB::table('cirt_quarter_assignments')->whereIn('id', $rows->where('id', '!=', $keep->id)->pluck('id')->all())->delete();
            DB::table('cirt_quarter_assignments')->where('id', $keep->id)->update(['assigned_from' => $from, 'assigned_to' => $to, 'updated_at' => now()]);
            Log::info('quarter-data-fix: duplicates AFTER', ['row' => DB::table('cirt_quarter_assignments')->where('id', $keep->id)->first()]);
        }
    }

    private function deleteDummyQuarters(): void
    {
        foreach (['Quarter 2', 'Q1- 400'] as $name) {
            foreach (DB::table('cirt_quarters')->where('quarter_name', $name)->where('status', 'inactive')->get() as $quarter) {
                $links = [];
                foreach (['cirt_quarter_assignments', 'cirt_payroll_master', 'cirt_monthly_payroll'] as $table) {
                    if (Schema::hasTable($table) && DB::table($table)->where('quarter_id', $quarter->id)->exists()) {
                        $links[$table] = DB::table($table)->where('quarter_id', $quarter->id)->count();
                    }
                }
                if (Schema::hasTable('cirt_payroll_draft_employees')
                    && DB::table('cirt_payroll_draft_employees')->whereRaw('row_payload::text like ?', ['%'.$quarter->id.'%'])->exists()) {
                    $links['cirt_payroll_draft_employees'] = 1;
                }
                if ($quarter->assigned_employee_id) {
                    $links['assigned_employee_id'] = 1;
                }

                if ($links !== []) {
                    Log::warning("quarter-data-fix: '{$name}' KEPT (inactive); still linked.", ['quarter' => $quarter, 'links' => $links]);

                    continue;
                }
                DB::table('cirt_quarters')->where('id', $quarter->id)->delete();
                Log::info("quarter-data-fix: '{$name}' DELETED.", ['quarter' => $quarter]);
            }
        }
    }

    public function down(): void
    {
        // Data correction; the previous rows are preserved in the log.
    }
};
