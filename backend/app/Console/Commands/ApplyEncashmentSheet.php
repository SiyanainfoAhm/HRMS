<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsUser;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;

/**
 * One-off: enter EL encashment (Run Payroll "Encash.") from a sheet into an open payroll draft.
 * Saves through PayrollDraftService::saveDraft with changedFields = ['govEarning_encashmentPaid'] only,
 * the same token the Run Payroll screen sends for a manual Encash. edit. Encashment DA is not touched.
 * --dry-run runs the real save inside a transaction and rolls it back.
 */
class ApplyEncashmentSheet extends Command
{
    protected $signature = 'payroll:apply-encashment-sheet
        {file : Path to the xlsx}
        {--year=2026}
        {--month=10}
        {--sheet=Encashment Entry}
        {--user= : Email or id of the audit user (required)}
        {--note=EL encashment : Reason stored in each audit entry}
        {--dry-run : Print and roll back}';

    protected $description = 'Enter Encash. from a sheet into an open payroll draft via the draft save path';

    public function handle(PayrollDraftService $drafts): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $dry = (bool) $this->option('dry-run');
        $found = HrmsPayrollDraft::query()->where('payroll_year', $year)->where('payroll_month', $month)->where('status', HrmsPayrollDraft::STATUS_DRAFT)->get();
        if ($found->count() !== 1) { $this->error("Expected exactly one open draft, found {$found->count()}."); return self::FAILURE; }
        $draft = $found->first();
        $companyId = (string) $draft->company_id;
        $u = (string) $this->option('user');
        $user = $u === '' ? null : HrmsUser::query()->where('company_id', $companyId)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
        if (! $user) { $this->error('--user must be the email or id of a user in the draft company.'); return self::FAILURE; }
        $this->line("Audit user: {$user->name} <{$user->email}> (role {$user->role->value})");

        $grid = IOFactory::load((string) $this->argument('file'))->getSheetByName((string) $this->option('sheet'))?->toArray(null, true, true, false);
        if (! $grid) { $this->error('Sheet not found.'); return self::FAILURE; }
        $num = static fn ($v): ?float => ($v === null || trim((string) $v) === '') ? null : (trim((string) $v) === '-' ? 0.0 : (float) str_replace(',', '', (string) $v));
        $col = array_flip(array_map(fn ($h) => trim((string) $h), $grid[2] ?? []));
        foreach (['Name (encashment list)', 'Name in app', 'Encashment (enter)', 'Now in app: Encash.'] as $need) {
            if (! isset($col[$need])) { $this->error("Column '{$need}' not found on row 3."); return self::FAILURE; }
        }
        $sheetRows = [];
        foreach (array_slice($grid, 3) as $i => $r) {
            $name = trim((string) ($r[$col['Name (encashment list)']] ?? ''));
            if ($name === '' || stripos($name, 'TOTAL') === 0) continue;
            $sheetRows[] = ['name' => $name, 'appName' => trim((string) ($r[$col['Name in app']] ?? '')), 'row' => $i + 4, 'enc' => $num($r[$col['Encashment (enter)']]), 'now' => $num($r[$col['Now in app: Encash.']])];
        }

        $norm = static fn (string $n): string => mb_strtolower(trim((string) preg_replace('/\s+/', ' ', $n)));
        $shown = collect($drafts->getDraft($companyId, $year, $month)['employees'])->groupBy(fn ($e) => $norm((string) ($e['rowPayload']['employeeName'] ?? '')));
        $before = [];
        $oldPayloads = [];
        $patch = [];
        $skipped = [];
        $equal = 0;
        $seen = [];
        foreach ($sheetRows as $s) {
            $tag = "{$s['name']} (sheet row {$s['row']})";
            if ($s['appName'] === '' || $s['enc'] === null) { $skipped[] = "{$tag}: no Name in app or blank value"; continue; }
            $m = $shown->get($norm($s['appName']), collect());
            if ($m->count() !== 1) { $skipped[] = "{$tag}: '{$s['appName']}' matches {$m->count()} draft rows"; continue; }
            $e = $m->first();
            $uid = (string) $e['employeeUserId'];
            if (isset($seen[$uid])) { $skipped[] = "{$tag}: duplicate of an earlier sheet row"; continue; }
            $seen[$uid] = true;
            $payload = (array) $e['rowPayload'];
            $gm = (array) ($payload['governmentMonthly'] ?? []);
            $old = (float) ($gm['encashmentPaid'] ?? 0);
            if ($s['now'] !== null && abs($old - $s['now']) > 0.5) { $skipped[] = "{$tag}: draft Encash. is {$old} but the sheet says it is now {$s['now']} - left alone"; continue; }
            if (abs($old - $s['enc']) <= 0.004) { $equal++; continue; }
            $before[$uid] = ['name' => (string) ($payload['employeeName'] ?? $s['name']), 'oldEnc' => $old, 'oldGross' => (float) $e['grossPay'], 'oldNet' => (float) $e['netPay']];
            $oldPayloads[$uid] = $payload;
            $gm['encashmentPaid'] = $s['enc'];
            if (array_key_exists('encashmentActual', $gm)) $gm['encashmentActual'] = $s['enc'];
            $payload['governmentMonthly'] = $gm;
            $gr = (array) ($payload['govRecalc'] ?? []);
            $ov = (array) ($gr['earningPaidOverrides'] ?? []);
            $ov['encashmentPaid'] = $s['enc'];
            $gr['earningPaidOverrides'] = $ov;
            $payload['govRecalc'] = $gr;
            $patch[] = ['employeeUserId' => $uid, 'employeeCode' => $e['employeeCode'], 'rowPayload' => $payload, 'changedFields' => ['govEarning_encashmentPaid'], 'reason' => (string) $this->option('note')];
        }
        $this->line(($dry ? 'DRY RUN' : 'SAVE')." {$year}-{$month}, draft v{$draft->version}: ".count($sheetRows).' sheet rows, '.count($patch)." to change, {$equal} already equal, ".count($skipped).' skipped.');
        foreach ($skipped as $x) $this->warn("SKIP {$x}");
        if ($patch === []) return self::SUCCESS;

        $flat = function (array $a, string $p = '') use (&$flat): array {
            $o = [];
            foreach ($a as $k => $v) { if (is_array($v)) $o += $flat($v, $p.$k.'.'); else $o[$p.$k] = $v; }
            return $o;
        };
        try {
            DB::beginTransaction();
            $result = $drafts->saveDraft($companyId, $year, $month, (string) $user->id, $patch, (int) $draft->version, false);
            $byUser = collect($result['employees'])->keyBy('employeeUserId');
            $totEnc = 0;
            $other = [];
            $anomalies = [];
            foreach ($before as $uid => $b) {
                $e = $byUser->get($uid);
                $gm = (array) ($e['rowPayload']['governmentMonthly'] ?? []);
                $newEnc = (float) ($gm['encashmentPaid'] ?? 0);
                $totEnc += $newEnc;
                $dEnc = $newEnc - $b['oldEnc'];
                $dGross = (float) $e['grossPay'] - $b['oldGross'];
                $dNet = (float) $e['netPay'] - $b['oldNet'];
                $this->line(sprintf('%-30s Encash. %s→%s | Gross %s→%s | Net pay %s→%s', mb_substr($b['name'], 0, 30), number_format($b['oldEnc']), number_format($newEnc), number_format($b['oldGross']), number_format((float) $e['grossPay']), number_format($b['oldNet']), number_format((float) $e['netPay'])));
                if (abs($dGross - $dEnc) > 0.5 || abs($dNet - $dEnc) > 0.5) $anomalies[] = "{$b['name']}: d.encash {$dEnc}, d.gross {$dGross}, d.net {$dNet}";
                $a = $flat($oldPayloads[$uid]);
                $z = $flat((array) $e['rowPayload']);
                foreach (array_unique([...array_keys($a), ...array_keys($z)]) as $k) {
                    if (($a[$k] ?? null) == ($z[$k] ?? null)) continue;
                    $other[$k] = ($other[$k] ?? 0) + 1;
                }
            }
            $this->line('Total encashment on changed rows: '.number_format($totEnc));
            $this->line('Payload paths changed (count of employees): '.json_encode($other));
            $this->line($anomalies === [] ? 'Every row: gross and net pay rose by exactly the encashment change.' : 'ANOMALIES: '.implode(' ; ', $anomalies));
            if ($dry) { DB::rollBack(); $this->info('Dry run: rolled back, nothing saved.'); }
            else { DB::commit(); $this->info("Saved {$result['saved']} employees; draft is now v{$result['draft']['version']}."); }
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$e->getMessage());
            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
