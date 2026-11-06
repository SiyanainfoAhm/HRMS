<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsPayrollDraft;
use App\Models\HrmsUser;
use App\Services\PayrollDraftService;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * One-off: enter leave lines (and a zero Transport override) into an open draft through the normal draft save path.
 *
 * The row for each edit is produced by the SAME code the Run Payroll screen runs when you edit (scripts/draft-edit-replay.ts
 * calls the shared row calculation), then saved with PayrollDraftService::saveDraft and the field token the screen sends
 * (`leaveLines`, `govEarning_transportPaid`). The dry run executes that real save in a transaction and rolls it back, so the
 * printed values (including CPF, Total Deductions and Net) are what --apply stores.
 *
 * The edits come from a JSON file (--edits=...), keyed by employee name exactly as in the draft, so no employee data is kept in the repo:
 *   {
 *     "Sample Employee A": {"kind": "leaveLines", "lines": [{"type": "HPL", "month": 9, "year": 2026, "days": 1}]},
 *     "Sample Employee B": {"kind": "leaveLines", "lines": [{"type": "HPL", "month": 9, "year": 2026, "days": 4}, {"type": "EOL", "month": 10, "year": 2026, "days": 2}]},
 *     "Sample Employee C": {"kind": "transportZero"}
 *   }
 * HPL / EOL days are per leave month; transportZero sets Transport to a manual override of 0.
 */
class ApplyLeaveLines extends Command
{
    protected $signature = 'payroll:apply-leave-lines
        {--year=2026} {--month=10}
        {--user= : Email or id of the audit user (required)}
        {--note= : Reason stored in each audit entry}
        {--edits= : JSON file with the edits (see the class comment; required)}
        {--apply : Save (default is a dry run)}';

    protected $description = 'Enter the agreed leave lines / zero Transport into the open draft (dry run unless --apply)';

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
        $note = (string) $this->option('note');
        $editsFile = (string) $this->option('edits');
        $specs = $editsFile !== '' && is_file($editsFile) ? json_decode((string) file_get_contents($editsFile), true) : null;
        if (! is_array($specs) || $specs === []) { $this->error('--edits=<json file> is required (see the class comment for the format).'); return self::FAILURE; }
        foreach ($specs as $name => $spec) {
            if (! in_array($spec['kind'] ?? null, ['leaveLines', 'transportZero'], true)) { $this->error("Unknown kind for '{$name}' in the edits file."); return self::FAILURE; }
        }
        $this->line("Audit user: {$user->name} <{$user->email}>");

        $controller = app(PayrollController::class);
        $call = function (string $method, array $query) use ($controller, $user) {
            $req = Request::create('/x', 'GET', $query);
            $req->setUserResolver(fn () => $user);
            return json_decode($controller->{$method}($req)->getContent(), true);
        };

        $shown = collect($drafts->getDraft($companyId, $year, $month)['employees']);
        $byName = $shown->keyBy(fn ($e) => trim((string) ($e['rowPayload']['employeeName'] ?? '')));
        $preview = $call('runPreview', ['year' => $year, 'month' => $month, 'runDay' => cal_days_in_month(CAL_GREGORIAN, $month, $year), 'all' => 1]);

        $edits = [];
        foreach ($specs as $name => $spec) {
            $e = $byName->get($name);
            if (! $e) { $this->error("'{$name}' is not in the {$year}-{$month} draft."); return self::FAILURE; }
            $edit = ['userId' => (string) $e['employeeUserId'], 'kind' => $spec['kind']];
            if ($spec['kind'] === 'leaveLines') {
                $edit['lines'] = array_map(function (array $l) use ($call, $e, $year, $month) {
                    if ($l['month'] === $month && $l['year'] === $year) return $l;
                    $ref = $call('referenceSalary', ['employee_user_id' => $e['employeeUserId'], 'year' => $l['year'], 'month' => $l['month']]);
                    return $l + ['grossBasic' => $ref['grossBasic'] ?? $ref['basic'], 'daPercent' => $ref['daPercent'] ?? null, 'daysInMonth' => $ref['daysInMonth'] ?? null];
                }, $spec['lines']);
            }
            $edits[] = $edit;
        }

        $dir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'cirt_leave_'.bin2hex(random_bytes(4));
        mkdir($dir);
        $in = $dir.DIRECTORY_SEPARATOR.'in.json';
        $out = $dir.DIRECTORY_SEPARATOR.'out.json';
        file_put_contents($in, json_encode(['preview' => $preview, 'draft' => $shown->values()->all(), 'edits' => $edits, 'year' => $year, 'month' => $month]));
        $root = dirname(base_path());
        // tsx is a pinned devDependency (npm ci installs it); never fetched from the registry at run time.
        $tsx = $root.DIRECTORY_SEPARATOR.'node_modules'.DIRECTORY_SEPARATOR.'tsx'.DIRECTORY_SEPARATOR.'dist'.DIRECTORY_SEPARATOR.'cli.mjs';
        if (! is_file($tsx)) { $this->error("tsx is not installed ($tsx). Run npm ci in $root."); return self::FAILURE; }
        $cmd = 'node '.escapeshellarg($tsx).' scripts/draft-edit-replay.ts '.escapeshellarg($in).' '.escapeshellarg($out);
        $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root);
        $stdout = stream_get_contents($pipes[1]); $stderr = stream_get_contents($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0 || ! is_file($out)) { $this->error("Row calculation failed:\n{$stderr}{$stdout}"); return self::FAILURE; }
        $computed = collect(json_decode((string) file_get_contents($out), true))->keyBy('userId');

        $patch = [];
        foreach ($edits as $edit) {
            $row = $computed[$edit['userId']]['row'];
            $token = $edit['kind'] === 'leaveLines' ? 'leaveLines' : 'govEarning_transportPaid';
            $patch[] = ['employeeUserId' => $edit['userId'], 'employeeCode' => $row['employeeCode'] ?? null, 'rowPayload' => $row, 'changedFields' => [$token], 'reason' => $note];
        }

        $fmt = static fn ($v) => number_format((float) $v, 0, '.', ',');
        $line = function (string $label, array $gm, array $e) use ($fmt): string {
            $d = $gm['deductions'] ?? [];
            return sprintf('  %-5s Basic %s | DA %s | HRA %s | Medical %s | Transport %s | Gross %s | CPF %s | Total Ded. %s | Net %s', $label,
                $fmt($gm['basicPaid'] ?? 0), $fmt($gm['daPaid'] ?? 0), $fmt($gm['hraPaid'] ?? 0), $fmt($gm['medicalPaid'] ?? 0), $fmt($gm['transportPaid'] ?? 0),
                $fmt($gm['totalEarnings'] ?? 0), $fmt($d['cpf'] ?? 0), $fmt($gm['totalDeductions'] ?? 0), $fmt($e['netPay'] ?? ($gm['netSalary'] ?? 0)));
        };

        $this->line(($apply ? 'SAVE' : 'DRY RUN')." {$year}-{$month}, draft v{$draft->version}");
        try {
            DB::beginTransaction();
            $result = $drafts->saveDraft($companyId, $year, $month, (string) $user->id, $patch, (int) $draft->version, false);
            $after = collect($result['employees'])->keyBy('employeeUserId');
            foreach ($edits as $edit) {
                $b = $shown->firstWhere('employeeUserId', $edit['userId']);
                $a = $after[$edit['userId']];
                $this->line(trim((string) ($b['rowPayload']['employeeName'] ?? '')).' ['.$edit['kind'].']');
                $this->line($line('old', (array) ($b['rowPayload']['governmentMonthly'] ?? []), $b));
                $this->line($line('new', (array) ($a['rowPayload']['governmentMonthly'] ?? []), $a));
                $gm = (array) ($a['rowPayload']['governmentMonthly'] ?? []);
                if (! empty($gm['leaveLines'])) $this->line('        leave lines: '.json_encode(array_map(fn ($l) => "{$l['type']} {$l['days']}d {$l['month']}/{$l['year']} (basic {$l['grossBasic']}, DA {$l['daPercent']}%, {$l['daysInMonth']}d)", $gm['leaveLines'])));
            }
            if ($apply) { DB::commit(); $this->info("Saved {$result['saved']} employees; draft is now v{$result['draft']['version']}."); }
            else { DB::rollBack(); $this->info('Dry run: rolled back, nothing saved.'); }
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, rolled back: '.$e->getMessage());
            return self::FAILURE;
        }
        @unlink($in); @unlink($out); @rmdir($dir);

        return self::SUCCESS;
    }
}
