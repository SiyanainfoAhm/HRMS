<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsUser;
use App\Services\PayrollDraftService;
use App\Support\PayrollTotals;
use App\Support\SearchText;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-off: bring the row-level arrear fields (daArrear, transportArrear, grossArrear, netArrear, cpfArrear) of one employee, or of
 * every employee that needs it (--all), in an open draft in line with the PAID arrear lines of the same row
 * (governmentMonthly.daArrearsPaid / transportArrearsPaid / cpfArrear). The Employee Detail workbook reads the row-level fields,
 * the pay calculation reads the paid lines.
 *
 * Saved through PayrollDraftService::saveDraft with the field tokens the Run Payroll screen sends, so audit and versioning are the
 * normal ones. The dry run executes that real save inside a transaction and rolls it back. The command refuses to save (even with
 * --apply) if anything that is PAID would change for any employee: pay days, earnings, deductions, CPF, total earnings / deductions, net.
 */
class RepairRowArrearFields extends Command
{
    protected $signature = 'payroll:repair-row-arrears
        {employee? : Employee name or code (omit with --all)}
        {--all : Every employee whose row-level arrear fields differ from the paid arrear lines}
        {--year=2026} {--month=10}
        {--user= : Email or id of the audit user (required)}
        {--note= : Reason stored in the audit entry}
        {--apply : Save (default is a dry run)}';

    protected $description = 'Re-save employees so the row-level arrear fields equal the paid arrear lines (dry run unless --apply)';

    private const PAID_KEYS = ['basicPaid', 'daPaid', 'hraPaid', 'medicalPaid', 'transportPaid', 'daArrearsPaid', 'transportArrearsPaid', 'encashmentPaid', 'cpfArrear', 'totalEarnings', 'totalDeductions', 'netSalary'];

    private static function n(mixed $v): float
    {
        return is_numeric($v) ? (float) $v : 0.0;
    }

    /** @return array<string, float> what the row-level arrear fields should be, from the paid lines */
    private static function wanted(array $row): array
    {
        $gm = (array) ($row['governmentMonthly'] ?? []);
        $chain = PayrollTotals::arrearChain($gm['daArrearsPaid'] ?? 0, $gm['transportArrearsPaid'] ?? 0, $gm['cpfArrear'] ?? 0);

        return [
            'daArrear' => self::n($gm['daArrearsPaid'] ?? 0), 'transportArrear' => self::n($gm['transportArrearsPaid'] ?? 0),
            'cpfArrear' => self::n($gm['cpfArrear'] ?? 0), 'grossArrear' => $chain['grossArrear'], 'netArrear' => $chain['netArrear'],
        ];
    }

    /** @return list<string> */
    private static function rowDifferences(array $row): array
    {
        $diff = [];
        foreach (self::wanted($row) as $k => $want) {
            if (abs(self::n($row[$k] ?? 0) - $want) > 0.005) $diff[] = "$k ".self::n($row[$k] ?? 0)." (paid lines say $want)";
        }

        return $diff;
    }

    /** @return list<string> paid amounts that differ between two row payloads */
    private static function paidChanges(array $before, array $after): array
    {
        $b = (array) ($before['governmentMonthly'] ?? []);
        $a = (array) ($after['governmentMonthly'] ?? []);
        $out = [];
        foreach (self::PAID_KEYS as $k) {
            if (abs(self::n($b[$k] ?? 0) - self::n($a[$k] ?? 0)) > 0.005) $out[] = "gm.$k ".($b[$k] ?? 0).' -> '.($a[$k] ?? 0);
        }
        foreach (array_unique([...array_keys((array) ($b['deductions'] ?? [])), ...array_keys((array) ($a['deductions'] ?? []))]) as $k) {
            if (abs(self::n($b['deductions'][$k] ?? 0) - self::n($a['deductions'][$k] ?? 0)) > 0.005) $out[] = "deductions.$k ".($b['deductions'][$k] ?? 0).' -> '.($a['deductions'][$k] ?? 0);
        }
        foreach (['payDays', 'grossPay', 'deductions', 'netPay'] as $k) {
            if (abs(self::n($before[$k] ?? 0) - self::n($after[$k] ?? 0)) > 0.005) $out[] = "$k ".($before[$k] ?? 0).' -> '.($after[$k] ?? 0);
        }
        foreach (['customEarnings', 'customDeductions'] as $bag) {
            if (json_encode(array_filter((array) ($b[$bag] ?? []))) !== json_encode(array_filter((array) ($a[$bag] ?? [])))) $out[] = "gm.$bag";
        }

        return $out;
    }

    public function handle(PayrollDraftService $drafts): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $apply = (bool) $this->option('apply');
        $draft = HrmsPayrollDraft::query()->where('payroll_year', $year)->where('payroll_month', $month)->where('status', HrmsPayrollDraft::STATUS_DRAFT)->first();
        if (! $draft) { $this->error('No open draft for that period.'); return self::FAILURE; }
        $companyId = (string) $draft->company_id;
        $u = (string) $this->option('user');
        $user = $u === '' ? null : HrmsUser::query()->where('company_id', $companyId)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
        if (! $user) { $this->error('--user (email or id) is required.'); return self::FAILURE; }
        $this->line('Database: '.DB::connection()->getDatabaseName()." | draft v{$draft->version} | audit user {$user->email}");

        $shown = collect($drafts->getDraft($companyId, $year, $month)['employees'])->values();
        $nameOf = static fn (array $e): string => trim((string) ($e['rowPayload']['employeeName'] ?? ''));

        if ($this->option('all')) {
            $targets = $shown->filter(fn ($e) => self::rowDifferences((array) $e['rowPayload']) !== [])->values();
        } else {
            $needle = trim((string) $this->argument('employee'));
            if ($needle === '') { $this->error('Give an employee name / code, or --all.'); return self::FAILURE; }
            $targets = $shown->filter(fn ($e) => SearchText::normalize($nameOf($e)) === SearchText::normalize($needle) || (string) ($e['employeeCode'] ?? '') === $needle)->values();
            if ($targets->count() !== 1) { $this->error("'{$needle}' matches {$targets->count()} employees in the draft."); return self::FAILURE; }
        }
        $this->line('Employees whose row-level arrear fields differ from their paid arrear lines: '.$shown->filter(fn ($e) => self::rowDifferences((array) $e['rowPayload']) !== [])->count().' of '.$shown->count().'; this run handles '.$targets->count());
        if ($targets->isEmpty()) { $this->info('Nothing to do.'); return self::SUCCESS; }

        $patch = [];
        foreach ($targets as $e) {
            $row = array_merge((array) $e['rowPayload'], self::wanted((array) $e['rowPayload']));
            $patch[] = [
                'employeeUserId' => (string) $e['employeeUserId'], 'employeeCode' => $e['employeeCode'] ?? null, 'rowPayload' => $row,
                'changedFields' => ['daArrear', 'transportArrear', 'cpfArrear'], 'reason' => (string) $this->option('note'),
            ];
        }

        $gm = static fn (array $emps, string $k): float => (float) collect($emps)->sum(fn ($x) => (float) ($x['rowPayload']['governmentMonthly'][$k] ?? 0));
        $detailGross = static fn (array $emps): float => (float) collect($emps)->sum(fn ($x) => (float) ($x['rowPayload']['daArrear'] ?? 0) + (float) ($x['rowPayload']['transportArrear'] ?? 0));
        $detailNet = static fn (array $emps): float => $detailGross($emps) - (float) collect($emps)->sum(fn ($x) => (float) ($x['rowPayload']['cpfArrear'] ?? 0));
        $rowSum = static fn (array $emps, string $k): float => (float) collect($emps)->sum(fn ($x) => (float) ($x['rowPayload'][$k] ?? 0));
        $f = static fn (float $v): string => number_format($v, 0);

        $this->line(($apply ? 'SAVE' : 'DRY RUN').' '.$targets->count().' employee(s)');
        $okToSave = false;
        try {
            DB::beginTransaction();
            $result = $drafts->saveDraft($companyId, $year, $month, (string) $user->id, $patch, (int) $draft->version, false);
            $afterAll = collect($result['employees'])->values();
            $after = $afterAll->keyBy('employeeUserId');

            $problems = [];
            $stillWrong = [];
            foreach ($targets as $e) {
                $uid = (string) $e['employeeUserId'];
                $a = (array) $after[$uid]['rowPayload'];
                foreach (self::paidChanges((array) $e['rowPayload'], $a) as $c) $problems[] = $nameOf($e).': '.$c;
                if (self::rowDifferences($a) !== []) $stillWrong[] = $nameOf($e).': '.implode('; ', self::rowDifferences($a));
            }
            $touchedIds = $targets->pluck('employeeUserId')->map(fn ($x) => (string) $x)->all();
            foreach ($shown as $e) {
                if (in_array((string) $e['employeeUserId'], $touchedIds, true)) continue;
                if (json_encode($e['rowPayload']) !== json_encode($after[(string) $e['employeeUserId']]['rowPayload'] ?? null)) $problems[] = $nameOf($e).': an employee outside the target set changed';
            }
            $sample = $targets->take(3);
            foreach ($sample as $e) {
                $a = (array) $after[(string) $e['employeeUserId']]['rowPayload'];
                $b = (array) $e['rowPayload'];
                $this->line('  e.g. '.$nameOf($e).': grossArrear '.json_encode($b['grossArrear'] ?? null).' -> '.json_encode($a['grossArrear'] ?? null).', netArrear '.json_encode($b['netArrear'] ?? null).' -> '.json_encode($a['netArrear'] ?? null).', transportArrear '.json_encode($b['transportArrear'] ?? null).' -> '.json_encode($a['transportArrear'] ?? null).' | gross '.($b['grossPay'] ?? 0).' -> '.($a['grossPay'] ?? 0).', net '.($b['netPay'] ?? 0).' -> '.($a['netPay'] ?? 0));
            }
            $sh = $shown->all();
            $af = $afterAll->all();
            $this->line('  Employee Detail "Gross Arrears" total: '.$f($detailGross($sh)).' -> '.$f($detailGross($af)).' | "Net Arrears" total: '.$f($detailNet($sh)).' -> '.$f($detailNet($af)));
            $this->line('  Row-level grossArrear sum: '.$f($rowSum($sh, 'grossArrear')).' -> '.$f($rowSum($af, 'grossArrear')).' | netArrear sum: '.$f($rowSum($sh, 'netArrear')).' -> '.$f($rowSum($af, 'netArrear')));
            foreach (['totalEarnings' => 'Gross', 'totalDeductions' => 'Total Deductions', 'netSalary' => 'Net'] as $k => $label) {
                $this->line(sprintf('  %-17s all %d employees: %s -> %s', $label, $shown->count(), $f($gm($sh, $k)), $f($gm($af, $k))));
                if (abs($gm($sh, $k) - $gm($af, $k)) > 0.005) $problems[] = "draft total $label changed";
            }
            $this->line('  CPF total: '.$f((float) collect($sh)->sum(fn ($x) => (float) ($x['rowPayload']['governmentMonthly']['deductions']['cpf'] ?? 0))).' -> '.$f((float) collect($af)->sum(fn ($x) => (float) ($x['rowPayload']['governmentMonthly']['deductions']['cpf'] ?? 0))));
            $this->line("  Draft version {$draft->version} -> {$result['draft']['version']}; employees saved: {$result['saved']}");
            if ($stillWrong) { $this->error('Row-level fields still differ after the save for: '.implode(' | ', array_slice($stillWrong, 0, 5))); $problems[] = 'row-level fields not aligned'; }
            if ($problems) {
                $this->error('REFUSING ('.count($problems).' problem(s)): '.implode('; ', array_slice($problems, 0, 8)));
            } else {
                $this->info('Pay check: for every employee nothing that is paid changes (pay days, earnings, deductions incl. CPF, custom lines, totals, net), nobody outside the target set changes, and the draft totals are identical.');
                $okToSave = true;
            }
            if ($apply && $okToSave) { DB::commit(); $this->info("Saved; draft is now v{$result['draft']['version']}."); }
            else { DB::rollBack(); $this->info($apply ? 'Not saved (rolled back).' : 'Dry run: rolled back, nothing saved.'); }
        } catch (\Throwable $ex) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$ex->getMessage());
            return self::FAILURE;
        }

        return $okToSave ? self::SUCCESS : self::FAILURE;
    }
}
