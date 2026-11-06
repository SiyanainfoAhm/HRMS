<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Sets monthly_rent of every quarter, by quarter NAME, from database/data/quarter_rents.json (the Quarters master as on the
 * local database), and keeps the dependent copies in step:
 *   - rent_at_assignment of the OPEN assignments of that quarter = the quarter's new rent;
 *   - quarter_rent of the CURRENT Payroll Master rows that hold that quarter.
 * Closed assignments, Payroll Master history and generated / finalized payroll are history and are never touched.
 *
 * Refuses (changes nothing) when a quarter of the file does not exist exactly once, when the database has an active quarter that
 * is not in the file (remove or add it first), or when the result does not match the expected open assignments / rent total
 * (default from the file: 21 open assignments, total 15,690). Dry run unless --apply: the real updates run in a transaction
 * that is rolled back.
 */
class SetQuarterRents extends Command
{
    protected $signature = 'payroll:set-quarter-rents
        {--file= : JSON file (default database/data/quarter_rents.json)}
        {--apply : Save (default is a dry run)}';

    protected $description = 'Set every quarter\'s monthly rent by name and sync rent_at_assignment of open assignments (dry run unless --apply)';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $file = (string) ($this->option('file') ?: database_path('data/quarter_rents.json'));
        $spec = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (! is_array($spec) || ! is_array($spec['rents'] ?? null) || $spec['rents'] === []) {
            $this->error("Cannot read quarter rents from {$file}.");

            return self::FAILURE;
        }
        $rents = $spec['rents'];
        $expectOpen = (int) ($spec['expect']['openAssignments'] ?? -1);
        $expectTotal = (float) ($spec['expect']['rentTotal'] ?? -1);

        $problems = [];
        $quarters = [];
        foreach ($rents as $name => $rent) {
            $rows = DB::table('cirt_quarters')->where('quarter_name', (string) $name)->get();
            if ($rows->count() !== 1) {
                $problems[] = "quarter '{$name}' exists {$rows->count()} time(s); expected exactly once";
                continue;
            }
            $quarters[(string) $name] = $rows->first();
        }
        $extra = DB::table('cirt_quarters')->where('status', '<>', 'inactive')->whereNotIn('quarter_name', array_map('strval', array_keys($rents)))->pluck('quarter_name')->all();
        foreach ($extra as $name) $problems[] = "active quarter '{$name}' is not in the file";
        if ($problems !== []) {
            $this->error('Refusing, nothing changed:');
            foreach ($problems as $p) $this->line(' - '.$p);

            return self::FAILURE;
        }

        $this->line(($apply ? 'APPLY' : 'DRY RUN').' '.count($quarters).' quarters from '.basename($file));
        DB::beginTransaction();
        try {
            $changedQuarters = 0;
            $changedAssignments = 0;
            $changedMasters = 0;
            foreach ($quarters as $name => $q) {
                $rent = (float) $rents[$name];
                $qChanged = abs((float) $q->monthly_rent - $rent) > 0.004;
                if ($qChanged) {
                    DB::table('cirt_quarters')->where('id', $q->id)->update(['monthly_rent' => $rent, 'updated_at' => now()]);
                    $changedQuarters++;
                    $this->line(sprintf('  %-8s rent %s -> %s', $name, number_format((float) $q->monthly_rent, 2), number_format($rent, 2)));
                    Log::info('quarter-data-fix: quarter rent', ['quarter' => $name, 'from' => $q->monthly_rent, 'to' => $rent]);
                }
                foreach (DB::table('cirt_quarter_assignments')->where('quarter_id', $q->id)->whereNull('assigned_to')->get() as $a) {
                    if (abs((float) $a->rent_at_assignment - $rent) > 0.004) {
                        DB::table('cirt_quarter_assignments')->where('id', $a->id)->update(['rent_at_assignment' => $rent, 'updated_at' => now()]);
                        $changedAssignments++;
                        $code = DB::table('cirt_users')->where('id', $a->employee_id)->value('employee_code');
                        $this->line(sprintf('  %-8s open assignment of %s: rent_at_assignment %s -> %s', $name, $code ?? '?', number_format((float) $a->rent_at_assignment, 2), number_format($rent, 2)));
                        Log::info('quarter-data-fix: rent_at_assignment', ['quarter' => $name, 'employee_code' => $code, 'from' => $a->rent_at_assignment, 'to' => $rent]);
                    }
                }
                $changedMasters += DB::table('cirt_payroll_master')->where('quarter_id', $q->id)->whereNull('effective_to')->where('quarter_rent', '<>', $rent)->update(['quarter_rent' => $rent]);
            }

            $open = DB::table('cirt_quarter_assignments as a')->join('cirt_quarters as q', 'q.id', '=', 'a.quarter_id')->whereNull('a.assigned_to')->where('q.status', '<>', 'inactive');
            $openCount = (int) (clone $open)->count();
            $total = (float) (clone $open)->sum('q.monthly_rent');
            $assignmentTotal = (float) (clone $open)->sum('a.rent_at_assignment');
            $this->line(sprintf('Changed: %d quarter rent(s), %d open assignment rent_at_assignment, %d current Payroll Master quarter_rent.', $changedQuarters, $changedAssignments, $changedMasters));
            $this->line(sprintf('Result: %d open assignments, quarter rent total %s, rent_at_assignment total %s.', $openCount, number_format($total, 2), number_format($assignmentTotal, 2)));
            if (($expectOpen >= 0 && $openCount !== $expectOpen) || ($expectTotal >= 0 && abs($total - $expectTotal) > 0.004) || abs($assignmentTotal - $total) > 0.004) {
                throw new \RuntimeException(sprintf('Result does not match the expected %d open assignments / %s total (or rent_at_assignment differs from the rent).', $expectOpen, number_format($expectTotal, 2)));
            }
            if ($apply) {
                DB::commit();
                $this->info('Saved.');
            } else {
                DB::rollBack();
                $this->info('Dry run: rolled back, nothing saved.');
            }
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$e->getMessage());

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
