<?php

namespace App\Console\Commands;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;

/**
 * One-off: enter DA Arrears / TR Arrears / CPF Arr from an arrears sheet into an open payroll draft.
 *
 * Goes through PayrollDraftService::saveDraft with explicit changedFields, i.e. the same path as the
 * Run Payroll "Save" for an Arrears (Unpaid) edit, so totals are recalculated and the draft audit log
 * is written exactly as for a manual edit. Nothing touches the tables directly.
 *
 * --dry-run runs that real save inside a transaction and rolls it back, so the printed Gross / Net are
 * what the app would store.
 */
class ApplyArrearsSheet extends Command
{
    protected $signature = 'payroll:apply-arrears-sheet
        {file : Path to the xlsx}
        {--year=2026 : Payroll year}
        {--month=10 : Payroll month}
        {--sheet=Arrears Entry : Sheet name}
        {--company= : Company id (needed only if several companies have an open draft)}
        {--user= : Email or id of the user recorded in the audit log (required)}
        {--note=DA arrears : Reason text stored in each audit entry}
        {--side-effects : Also list non-arrear payload fields the save changed}
        {--dry-run : Print old -> new and roll back (nothing is saved)}';

    protected $description = 'Enter DA/TR/CPF arrears from a sheet into an open payroll draft via the draft save path';

    public function handle(PayrollDraftService $drafts): int
    {
        $year = (int) $this->option('year');
        $month = (int) $this->option('month');
        $dry = (bool) $this->option('dry-run');

        $draftQuery = HrmsPayrollDraft::query()->where('payroll_year', $year)->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT);
        if ($this->option('company')) $draftQuery->where('company_id', $this->option('company'));
        $found = $draftQuery->get();
        if ($found->count() !== 1) {
            $this->error("Expected exactly one open draft for {$year}-{$month}, found {$found->count()}. Use --company.");
            return self::FAILURE;
        }
        $draft = $found->first();
        $companyId = (string) $draft->company_id;
        $u = (string) $this->option('user');
        $userModel = $u === '' ? null : \App\Models\HrmsUser::query()->where('company_id', $companyId)->where(str_contains($u, '@') ? 'email' : 'id', $u)->first();
        if (! $userModel) { $this->error('--user must be the email or id of a user in the draft\'s company.'); return self::FAILURE; }
        $userId = (string) $userModel->id;
        $this->line("Audit user: {$userModel->name} <{$userModel->email}> (role {$userModel->role->value})");

        $sheet = IOFactory::load((string) $this->argument('file'))->getSheetByName((string) $this->option('sheet'));
        if (! $sheet) { $this->error('Sheet not found.'); return self::FAILURE; }
        $grid = $sheet->toArray(null, true, true, false);
        $num = static fn ($v): ?float => ($v === null || trim((string) $v) === '') ? null : (float) str_replace(',', '', (string) $v);

        // Headers on row 3, data from row 4; skip the TOTAL row.
        $header = array_map(fn ($h) => trim((string) $h), $grid[2] ?? []);
        $col = array_flip($header);
        foreach (['Code', 'Name in app', 'DA Arrears', 'TR Arrears', 'CPF Arr (enter)', 'Now in app: DA', 'Now in app: TR', 'Now in app: CPF'] as $need) {
            if (! isset($col[$need])) { $this->error("Column '{$need}' not found on row 3."); return self::FAILURE; }
        }
        $sheetRows = [];
        foreach (array_slice($grid, 3) as $i => $r) {
            $code = trim((string) ($r[$col['Code']] ?? ''));
            $name = (string) ($r[$col['Name (Arrears statement)']] ?? '');
            if ($code === '' || stripos($name, 'TOTAL') === 0) continue;
            $sheetRows[$code] = ['name' => $name, 'appName' => trim((string) ($r[$col['Name in app']] ?? '')), 'nowDa' => $num($r[$col['Now in app: DA']]), 'nowTr' => $num($r[$col['Now in app: TR']]), 'nowCpf' => $num($r[$col['Now in app: CPF']]), 'row' => $i + 4, 'da' => $num($r[$col['DA Arrears']]), 'tr' => $num($r[$col['TR Arrears']]), 'cpf' => $num($r[$col['CPF Arr (enter)']])];
        }

        $normName = static fn (string $n): string => mb_strtolower(trim((string) preg_replace('/\s+/', ' ', $n)));
        // What the Run Payroll screen shows (getDraft re-applies current quarter / electricity values); the edit is made on that.
        $shown = collect($drafts->getDraft($companyId, $year, $month)['employees'])->map(fn ($e) => (object) ['employee_user_id' => $e['employeeUserId'], 'employee_code' => $e['employeeCode'], 'row_payload' => $e['rowPayload'], 'net_pay' => $e['netPay']]);
        $draftRows = $shown->groupBy(fn ($r) => $normName((string) ((array) $r->row_payload)['employeeName'] ?? ''));
        $before = [];
        $oldPayloads = [];
        $patch = [];
        $skipped = [];
        foreach ($sheetRows as $code => $s) {
            if ($s['appName'] === '') { $skipped[] = "{$code} {$s['name']} (sheet row {$s['row']}): no 'Name in app' on the sheet"; continue; }
            $matches = $draftRows->get($normName($s['appName']), collect());
            if ($matches->count() !== 1) { $skipped[] = "{$code} {$s['name']} (sheet row {$s['row']}): '{$s['appName']}' matches {$matches->count()} draft rows"; continue; }
            $row = $matches->first();
            if ($s['da'] === null || $s['tr'] === null || $s['cpf'] === null) { $skipped[] = "{$code} {$s['name']}: blank value"; continue; }
            $payload = (array) $row->row_payload;
            $gm = (array) ($payload['governmentMonthly'] ?? $payload['government_monthly'] ?? []);
            $old = [
                'da' => (float) ($gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? 0),
                'tr' => (float) ($gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? 0),
                'cpf' => (float) ($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? 0),
                'gross' => (float) ($gm['grossArrear'] ?? 0), 'net' => (float) ($gm['netArrear'] ?? 0),
                'netPay' => $row->net_pay,
            ];
            $oldPayloads[(string) $row->employee_user_id] = $payload0 = (array) $row->row_payload;
            foreach ([['da', 'nowDa'], ['tr', 'nowTr'], ['cpf', 'nowCpf']] as [$k, $sk]) {
                if ($s[$sk] !== null && abs($old[$k] - $s[$sk]) > 0.5) { $skipped[] = "{$code} {$s['name']}: draft {$k} is ".$old[$k]." but the sheet says it is now ".$s[$sk].' - not matching the same person/state, left alone'; continue 2; }
            }
            $before[(string) $row->employee_user_id] = ['code' => $code, 'name' => $s['name'], 'old' => $old];

            $changed = [];
            if (abs($old['da'] - $s['da']) > 0.004) { $changed[] = 'daArrear'; $payload['daArrear'] = $s['da']; $gm['daArrearsPaid'] = $gm['da_arrears_paid'] = $s['da']; }
            if (abs($old['tr'] - $s['tr']) > 0.004) { $changed[] = 'transportArrear'; $payload['transportArrear'] = $s['tr']; $gm['transportArrearsPaid'] = $gm['transport_arrears_paid'] = $s['tr']; }
            if (abs($old['cpf'] - $s['cpf']) > 0.004) { $changed[] = 'cpfArrear'; $payload['cpfArrear'] = $s['cpf']; $gm['cpfArrear'] = $gm['cpf_arrear'] = $s['cpf']; }
            if ($changed === []) continue;
            // Same unit the screen sends: gross/net arrear travel with whichever arrear was typed.
            $payload['governmentMonthly'] = $gm;
            $patch[] = ['employeeUserId' => (string) $row->employee_user_id, 'employeeCode' => $code, 'rowPayload' => $payload, 'changedFields' => $changed, 'reason' => (string) $this->option('note')];
        }

        $this->line(($dry ? 'DRY RUN' : 'SAVE')." {$year}-{$month}, draft v{$draft->version}, ".count($sheetRows).' sheet rows, '.count($patch).' to change, '.(count($sheetRows) - count($patch) - count($skipped)).' already equal, '.count($skipped).' skipped.');
        foreach ($skipped as $s) $this->warn("SKIP {$s}");
        if ($patch === []) return self::SUCCESS;

        $fmt = static fn ($v) => number_format((float) $v, 0, '.', '');
        $flat = function (array $a, string $p = '') use (&$flat): array { $o = []; foreach ($a as $k => $v) { if (is_array($v)) $o += $flat($v, $p.$k.'.'); else $o[$p.$k] = $v; } return $o; };
        $report = function (array $savedEmployees) use ($before, $fmt, $oldPayloads, $flat): void {
            $byUser = collect($savedEmployees)->keyBy('employeeUserId');
            foreach ($before as $uid => $b) {
                $e = $byUser->get($uid);
                if (! $e) continue;
                $gm = (array) ($e['rowPayload']['governmentMonthly'] ?? []);
                $new = ['da' => $gm['daArrearsPaid'] ?? 0, 'tr' => $gm['transportArrearsPaid'] ?? 0, 'cpf' => $gm['cpfArrear'] ?? 0, 'gross' => $gm['grossArrear'] ?? 0, 'net' => $gm['netArrear'] ?? 0, 'netPay' => $e['netPay']];
                if ($this->option('side-effects')) {
                    $a = $flat($oldPayloads[$uid]); $z = $flat((array) $e['rowPayload']);
                    foreach (array_unique([...array_keys($a), ...array_keys($z)]) as $k) {
                        if (preg_match('/arrear|Arrear|ArrearsPaid|arrears_paid|^(grossPay|netPay|takeHome)$|totalEarnings|totalDeductions|netSalary|gross|net|updated|total_/i', $k)) continue;
                        if (($a[$k] ?? null) != ($z[$k] ?? null)) $this->line('      ~ '.$b['code'].' '.$k.': '.json_encode($a[$k] ?? null).' → '.json_encode($z[$k] ?? null));
                    }
                }
                $o = $b['old'];
                if ($o['da'] == $new['da'] && $o['tr'] == $new['tr'] && $o['cpf'] == $new['cpf']) continue;
                $this->line(sprintf('%-5s %-28s DA %s→%s | TR %s→%s | CPF Arr %s→%s | Gross %s→%s | Net %s→%s | Net pay %s→%s',
                    $b['code'], mb_substr($b['name'], 0, 28), $fmt($o['da']), $fmt($new['da']), $fmt($o['tr']), $fmt($new['tr']), $fmt($o['cpf']), $fmt($new['cpf']),
                    $fmt($o['gross']), $fmt($new['gross']), $fmt($o['net']), $fmt($new['net']), $fmt($o['netPay']), $fmt($new['netPay'])));
            }
        };

        try {
            DB::beginTransaction();
            $result = $drafts->saveDraft($companyId, $year, $month, $userId, $patch, (int) $draft->version, false);
            $report($result['employees']);
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
