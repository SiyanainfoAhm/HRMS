<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Deletes one placeholder quarter (for example "Q1- 400") together with its orphan assignment rows, and nothing else.
 *
 * The quarter is identified by NAME. It is removed only when ALL of this holds, otherwise the command changes nothing:
 *   - exactly one quarter has that name, it is inactive and has no assigned employee;
 *   - nothing in Payroll Master or generated payroll references it;
 *   - every assignment row of it is CLOSED (assigned_to set) and its employee id no longer exists in cirt_users (an orphan).
 * Dry run unless --apply: the real deletes run inside a transaction that is rolled back. Every deleted row is printed and
 * written to the Laravel log under "quarter-data-fix".
 */
class RemoveOrphanQuarter extends Command
{
    protected $signature = 'payroll:remove-orphan-quarter
        {name : Quarter name, for example "Q1- 400"}
        {--apply : Delete (default is a dry run)}';

    protected $description = 'Delete an inactive placeholder quarter and its orphan closed assignments (dry run unless --apply)';

    public function handle(): int
    {
        $name = (string) $this->argument('name');
        $apply = (bool) $this->option('apply');
        $quarters = DB::table('cirt_quarters')->where('quarter_name', $name)->get();
        if ($quarters->count() === 0) {
            $this->info("No quarter named '{$name}': nothing to do.");

            return self::SUCCESS;
        }
        if ($quarters->count() !== 1) {
            $this->error("{$quarters->count()} quarters are named '{$name}'; expected exactly one. Nothing changed.");

            return self::FAILURE;
        }
        $q = $quarters->first();
        $problems = [];
        if ($q->status !== 'inactive') $problems[] = "status is '{$q->status}', not 'inactive'";
        if ($q->assigned_employee_id) $problems[] = 'it still has an assigned employee';
        foreach (['cirt_payroll_master', 'cirt_monthly_payroll'] as $table) {
            $n = DB::table($table)->where('quarter_id', $q->id)->count();
            if ($n > 0) $problems[] = "{$n} row(s) in {$table} reference it";
        }
        $assignments = DB::table('cirt_quarter_assignments')->where('quarter_id', $q->id)->get();
        foreach ($assignments as $a) {
            if ($a->assigned_to === null) $problems[] = "an OPEN assignment exists (from {$a->assigned_from})";
            if (DB::table('cirt_users')->where('id', $a->employee_id)->exists()) $problems[] = "assignment from {$a->assigned_from} belongs to an existing employee";
        }
        if ($problems !== []) {
            $this->error("Refusing to delete '{$name}', nothing changed:");
            foreach (array_unique($problems) as $p) $this->line(' - '.$p);

            return self::FAILURE;
        }

        $this->line(($apply ? 'DELETE' : 'DRY RUN')." quarter '{$name}' ({$q->quarter_type}, rent {$q->monthly_rent}, {$q->status}) and {$assignments->count()} orphan closed assignment(s):");
        foreach ($assignments as $a) $this->line("  assignment {$a->assigned_from} -> {$a->assigned_to}, rent_at_assignment {$a->rent_at_assignment}, employee id no longer in cirt_users");
        DB::beginTransaction();
        try {
            Log::info('quarter-data-fix: orphan quarter BEFORE', ['quarter' => $q, 'assignments' => $assignments->all()]);
            DB::table('cirt_quarter_assignments')->where('quarter_id', $q->id)->delete();
            DB::table('cirt_quarters')->where('id', $q->id)->delete();
            if (DB::table('cirt_quarters')->where('quarter_name', $name)->exists()) throw new \RuntimeException('quarter still present after delete');
            if ($apply) {
                DB::commit();
                $this->info("Deleted '{$name}'.");
            } else {
                DB::rollBack();
                $this->info('Dry run: rolled back, nothing deleted.');
            }
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$e->getMessage());

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
