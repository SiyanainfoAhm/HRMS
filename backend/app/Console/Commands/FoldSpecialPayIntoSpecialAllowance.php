<?php

namespace App\Console\Commands;

use App\Models\HrmsUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * One-off, before migration 2026_11_06_100000 (which refuses to run while Special Pay holds a value):
 * moves every non-zero Special Pay (spPayPaid / spPayActual / earningPaidOverrides.spPayPaid) of an OPEN draft into
 * Special Allowance (customEarnings.special_allowance, added to any amount already there), then sets Special Pay to 0.
 *
 * A direct, minimal JSON edit: nothing is recalculated, so the stored gross / earnings / deductions / net columns of every row
 * stay exactly as they are (checked for ALL rows of the draft; any difference rolls everything back). One audit entry per
 * employee (reason = --note, user = --user). Employees are identified by the employee code in the row (employeeCode).
 * Dry run unless --apply. Generated / finalized payroll is never touched.
 */
class FoldSpecialPayIntoSpecialAllowance extends Command
{
    protected $signature = 'payroll:fold-special-pay
        {--year= : Payroll year (required)}
        {--month= : Payroll month (required)}
        {--user= : Email or id of the audit user (required)}
        {--note=Special Pay moved to Special Allowance (field removed) : Reason stored in each audit entry}
        {--apply : Save (default is a dry run)}';

    protected $description = 'Move Special Pay into Special Allowance in an open draft (direct JSON edit, totals unchanged; dry run unless --apply)';

    public function handle(): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $apply = (bool) $this->option('apply');
        $draft = DB::table('cirt_payroll_drafts')->where('payroll_year', $year)->where('payroll_month', $month)->where('status', 'draft')->first();
        if (! $draft) {
            $this->error('No open draft for that period.');

            return self::FAILURE;
        }
        $u = (string) $this->option('user');
        $user = $u === '' ? null : HrmsUser::query()->where('company_id', $draft->company_id)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
        if (! $user) {
            $this->error('--user (email or id) is required.');

            return self::FAILURE;
        }
        $note = (string) $this->option('note');

        $snapshot = fn () => DB::table('cirt_payroll_draft_employees')->where('payroll_draft_id', $draft->id)->orderBy('id')
            ->get(['id', 'employee_code', 'gross_pay', 'total_earnings', 'total_deductions', 'total_arrears', 'net_pay', 'pay_days', 'remarks'])->map(fn ($r) => (array) $r)->all();
        $lineSum = static function (array $gm): float {
            $t = 0.0;
            foreach (['basicPaid', 'spPayPaid', 'daPaid', 'transportPaid', 'hraPaid', 'medicalPaid', 'extraWorkAllowancePaid', 'nightAllowancePaid', 'uniformAllowancePaid', 'educationAllowancePaid', 'daArrearsPaid', 'transportArrearsPaid', 'encashmentPaid', 'encashmentDaPaid'] as $k) {
                $t += (float) ($gm[$k] ?? 0);
            }
            foreach ((array) ($gm['customEarnings'] ?? []) as $v) {
                $t += (float) $v;
            }

            return $t;
        };
        $flat = function (array $a, string $p = '') use (&$flat): array {
            $o = [];
            foreach ($a as $k => $v) {
                if (is_array($v) && $v !== []) {
                    $o += $flat($v, $p.$k.'.');
                } else {
                    $o[$p.$k] = $v;
                }
            }

            return $o;
        };

        $this->line(($apply ? 'APPLY' : 'DRY RUN')." {$year}-{$month}, open draft v{$draft->version}, audit user {$user->email}");
        $before = $snapshot();
        DB::beginTransaction();
        try {
            $moved = 0;
            $sum = 0.0;
            foreach (DB::table('cirt_payroll_draft_employees')->where('payroll_draft_id', $draft->id)->orderBy('employee_code')->get() as $r) {
                $p = json_decode($r->row_payload, true);
                $gm = (array) ($p['governmentMonthly'] ?? []);
                $gr = (array) ($p['govRecalc'] ?? []);
                $sp = (float) ($gm['spPayPaid'] ?? 0);
                $spActual = (float) ($gm['spPayActual'] ?? 0);
                $spOverride = (float) ($gr['earningPaidOverrides']['spPayPaid'] ?? 0);
                if ($sp == 0.0 && $spActual == 0.0 && $spOverride == 0.0) {
                    continue;
                }
                $code = (string) ($p['employeeCode'] ?? $r->employee_code);
                if (abs($sp - $spActual) > 0.004 || ($spOverride != 0.0 && abs($spOverride - $sp) > 0.004)) {
                    throw new \RuntimeException("Employee {$code}: spPayPaid {$sp}, spPayActual {$spActual}, override {$spOverride} disagree; resolve by hand.");
                }
                $old = $p;
                $sumBefore = $lineSum($gm);
                $ce = (array) ($gm['customEarnings'] ?? []);
                $ce['special_allowance'] = (float) ($ce['special_allowance'] ?? 0) + $sp;
                $gm['customEarnings'] = $ce;
                $gm['spPayPaid'] = 0;
                $gm['spPayActual'] = 0;
                $p['governmentMonthly'] = $gm;
                $gce = (array) ($gr['customEarnings'] ?? []);
                $gce['special_allowance'] = $ce['special_allowance'];
                $gr['customEarnings'] = $gce;
                $ov = (array) ($gr['earningPaidOverrides'] ?? []);
                $ov['spPayPaid'] = 0;
                $gr['earningPaidOverrides'] = $ov;
                $p['govRecalc'] = $gr;
                if (abs($lineSum($gm) - $sumBefore) > 0.001) {
                    throw new \RuntimeException("Line sum changed for employee {$code}.");
                }

                $a = $flat($old);
                $z = $flat($p);
                $changes = [];
                foreach (array_unique([...array_keys($a), ...array_keys($z)]) as $k) {
                    if (($a[$k] ?? null) === ($z[$k] ?? null)) {
                        continue;
                    }
                    $changes[$k] = ['previous' => $a[$k] ?? null, 'new' => $z[$k] ?? null];
                }
                $this->line(sprintf('  %-6s Special Pay %s -> 0 | Special Allowance %s -> %s', $code, number_format($sp), number_format((float) ($old['governmentMonthly']['customEarnings']['special_allowance'] ?? 0)), number_format((float) $ce['special_allowance'])));
                DB::table('cirt_payroll_draft_employees')->where('id', $r->id)->update(['row_payload' => json_encode($p), 'version' => $r->version + 1]);
                DB::table('cirt_payroll_draft_audits')->insert([
                    'id' => (string) Str::uuid(), 'company_id' => $draft->company_id, 'payroll_draft_id' => $draft->id, 'payroll_year' => $year, 'payroll_month' => $month,
                    'action' => 'employee_updated', 'employee_count' => 1,
                    'employee_snapshot' => json_encode([['employeeUserId' => $r->employee_user_id, 'employeeCode' => $code, 'changes' => $changes, 'reason' => $note]]),
                    'performed_by' => $user->id, 'created_at' => now(),
                ]);
                $moved++;
                $sum += $sp;
            }
            if ($moved > 0) {
                DB::table('cirt_payroll_drafts')->where('id', $draft->id)->update(['version' => $draft->version + 1]);
            }
            if ($snapshot() !== $before) {
                throw new \RuntimeException('Stored gross / earnings / deductions / net changed for at least one row; rolled back.');
            }
            $this->line("Moved Special Pay of {$moved} employee(s), total ".number_format($sum).'. Stored totals identical for all '.count($before).' rows.');
            if ($apply) {
                DB::commit();
                $this->info($moved === 0 ? 'Nothing to move.' : 'Saved; draft is now v'.($draft->version + 1).'.');
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
