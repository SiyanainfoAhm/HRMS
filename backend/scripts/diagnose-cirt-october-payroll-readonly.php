<?php

use App\Services\PayrollRunRevisionService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

/**
 * Read-only production diagnostic. It never writes payroll or audit tables.
 * Run with --environment=production --confirm-read-only. A DB-level
 * SET TRANSACTION READ ONLY guards every query in this script.
 */
$options = [];
foreach (array_slice($argv, 1) as $argument) {
    if (str_starts_with($argument, '--') && str_contains($argument, '=')) {
        [$key, $value] = explode('=', substr($argument, 2), 2);
        $options[$key] = $value;
    } elseif (str_starts_with($argument, '--')) {
        $options[substr($argument, 2)] = true;
    }
}

$environment = (string) ($options['environment'] ?? '');
if (! in_array($environment, ['production', 'local-test'], true) || ! isset($options['confirm-read-only'])) {
    fwrite(STDERR, "Usage: php scripts/diagnose-cirt-october-payroll-readonly.php --environment=production|local-test --confirm-read-only [--excel=verified.xlsx] [--out=report.json] [--company-id=UUID]\n");
    exit(2);
}

if (! extension_loaded('pdo_pgsql')) {
    fwrite(STDERR, "pdo_pgsql is required.\n");
    exit(2);
}

$periodYear = 2026;
$periodMonth = 10;
$periodStart = '2026-10-01';
$companyId = isset($options['company-id']) ? (string) $options['company-id'] : null;
$connection = DB::connection();
$connection->beginTransaction();

try {
    $connection->statement('SET TRANSACTION READ ONLY');

    $companyQuery = DB::table('cirt_institute');
    $company = $companyId !== null
        ? $companyQuery->where('id', $companyId)->first(['id', 'code'])
        : $companyQuery->whereRaw('LOWER(code) = ?', ['cirt'])->first(['id', 'code']);
    if (! $company) {
        throw new RuntimeException('CIRT institute was not found. Supply --company-id only after verifying the database target.');
    }
    $companyId = (string) $company->id;

    $period = DB::table('cirt_payroll_periods')
        ->where('company_id', $companyId)
        ->whereDate('period_start', $periodStart)
        ->first();
    if (! $period) {
        throw new RuntimeException('No October 2026 payroll period exists for this CIRT institute.');
    }

    $database = (array) DB::selectOne('select current_database() as database, inet_server_addr()::text as host, inet_server_port() as port, current_user as database_user');
    $currentMonthly = DB::table('cirt_monthly_payroll')
        ->where('company_id', $companyId)->where('payroll_period_id', $period->id)
        ->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
    $currentPayslips = DB::table('cirt_payslips')
        ->where('company_id', $companyId)->where('payroll_period_id', $period->id)
        ->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
    $revisions = DB::table('cirt_payroll_run_revisions')
        ->where('company_id', $companyId)->where('payroll_period_id', $period->id)
        ->orderBy('revision_no')->get()->all();

    $revisionSnapshots = [];
    $revisionChecks = [];
    foreach ($revisions as $revision) {
        $monthly = json_decode((string) $revision->monthly_rows, true, flags: JSON_THROW_ON_ERROR);
        $payslips = json_decode((string) $revision->payslip_rows, true, flags: JSON_THROW_ON_ERROR);
        $valid = hash_equals(
            (string) $revision->snapshot_sha256,
            PayrollRunRevisionService::checksum($monthly, $payslips),
        );
        $revisionSnapshots[] = ['revision' => $revision, 'monthly' => $monthly, 'payslips' => $payslips];
        $revisionChecks[] = [
            'revision' => (int) $revision->revision_no,
            'action' => $revision->action,
            'reason' => $revision->reason,
            'createdAt' => $revision->created_at,
            'createdBy' => $revision->created_by,
            'checksumValid' => $valid,
            'monthlyRowCount' => count($monthly),
            'payslipCount' => count($payslips),
        ];
    }

    $employeeCodes = DB::table('cirt_employees')
        ->where('company_id', $companyId)
        ->get(['user_id', 'employee_code'])
        ->mapWithKeys(fn ($employee) => [(string) $employee->user_id => (string) $employee->employee_code])
        ->all();

    $normalize = static function (mixed $value, ?string $key = null) use (&$normalize): mixed {
        if (is_string($value) && in_array($key, ['custom_earnings', 'custom_deductions', 'allowances', 'deductions'], true)) {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE) $value = $decoded;
        }
        if (is_array($value)) {
            if (! array_is_list($value)) ksort($value);
            foreach ($value as $childKey => $child) $value[$childKey] = $normalize($child, (string) $childKey);
            return $value;
        }
        if (is_numeric($value)) return round((float) $value, 4);
        if (is_string($value) && preg_match('/^\d{4}-\d\d-\d\dT.*Z$/', $value)) {
            return gmdate('Y-m-d H:i:s', strtotime($value));
        }
        return $value;
    };
    $compareRows = static function (array $savedRows, array $liveRows) use ($normalize, $employeeCodes): array {
        $savedById = [];
        foreach ($savedRows as $row) $savedById[(string) ($row['id'] ?? '')] = $row;
        $changes = [];
        foreach ($liveRows as $live) {
            $id = (string) ($live['id'] ?? '');
            $saved = $savedById[$id] ?? null;
            if (! is_array($saved)) {
                $changes[] = ['rowId' => $id, 'employeeCode' => $employeeCodes[(string) ($live['employee_user_id'] ?? '')] ?? null, 'field' => '*', 'previous' => null, 'current' => 'row missing from snapshot'];
                continue;
            }
            foreach (array_unique([...array_keys($saved), ...array_keys($live)]) as $field) {
                if (in_array($field, ['created_at', 'updated_at', 'generated_at'], true)) continue;
                $before = $saved[$field] ?? null;
                $after = $live[$field] ?? null;
                if ($normalize($before, (string) $field) === $normalize($after, (string) $field)) continue;
                $changes[] = [
                    'rowId' => $id,
                    'employeeCode' => $employeeCodes[(string) ($live['employee_user_id'] ?? $saved['employee_user_id'] ?? '')] ?? null,
                    'employeeUserId' => $live['employee_user_id'] ?? $saved['employee_user_id'] ?? null,
                    'field' => (string) $field,
                    'previous' => $before,
                    'current' => $after,
                ];
            }
        }
        return $changes;
    };

    $revisionChanges = [];
    $discrepancyCandidates = [];
    for ($index = 1; $index < count($revisionSnapshots); $index++) {
        $from = $revisionSnapshots[$index - 1];
        $to = $revisionSnapshots[$index];
        $changes = $compareRows($from['monthly'], $to['monthly']);
        foreach ($changes as $change) {
            if (is_numeric($change['previous']) && is_numeric($change['current'])) {
                $delta = round((float) $change['current'] - (float) $change['previous'], 2);
                if (abs(abs($delta) - 11800.00) < 0.01) {
                    $discrepancyCandidates[] = [
                        'source' => 'revision-change',
                        'fromRevision' => (int) $from['revision']->revision_no,
                        'toRevision' => (int) $to['revision']->revision_no,
                        'employeeCode' => $change['employeeCode'],
                        'employeeUserId' => $change['employeeUserId'],
                        'field' => $change['field'],
                        'previous' => $change['previous'],
                        'current' => $change['current'],
                        'delta' => $delta,
                    ];
                }
            }
        }
        $revisionChanges[] = [
            'fromRevision' => (int) $from['revision']->revision_no,
            'toRevision' => (int) $to['revision']->revision_no,
            'fromAction' => $from['revision']->action,
            'toAction' => $to['revision']->action,
            'fromCreatedAt' => $from['revision']->created_at,
            'toCreatedAt' => $to['revision']->created_at,
            'toReason' => $to['revision']->reason,
            'changedFieldCount' => count($changes),
            'changes' => $changes,
        ];
    }

    $latest = $revisionSnapshots === [] ? null : $revisionSnapshots[array_key_last($revisionSnapshots)];
    $latestMonthlyChanges = $latest ? $compareRows($latest['monthly'], $currentMonthly) : [];
    $latestPayslipChanges = $latest ? $compareRows($latest['payslips'], $currentPayslips) : [];

    $sum = static fn (array $rows, string $field): float => round(array_sum(array_map(static fn ($row) => (float) ($row[$field] ?? 0), $rows)), 2);
    $componentTotals = [];
    foreach ([
        'night_allowance_paid' => 'Night Allowance',
        'extra_work_allowance_paid' => 'Extra Work Allowance',
        'mess_amount' => 'Mess',
        'credit_society_amount' => 'Credit Society',
        'electricity_amount' => 'Electricity Amount',
        'electricity_units_consumed' => 'Electricity Units',
        'total_earnings' => 'Gross / Total Earnings',
        'total_deductions' => 'Total Deductions',
        'net_salary' => 'Net Salary',
    ] as $field => $label) {
        $componentTotals[$field] = [
            'label' => $label,
            'current' => $sum($currentMonthly, $field),
            'latestRevision' => $latest ? $sum($latest['monthly'], $field) : null,
        ];
    }

    $employeeReconciliation = [];
    foreach ($currentMonthly as $row) {
        $gross = (float) ($row['total_earnings'] ?? 0);
        $deductions = (float) ($row['total_deductions'] ?? 0);
        $net = (float) ($row['net_salary'] ?? 0);
        $employeeReconciliation[] = [
            'employeeCode' => $employeeCodes[(string) ($row['employee_user_id'] ?? '')] ?? null,
            'employeeUserId' => $row['employee_user_id'] ?? null,
            'monthlyPayrollId' => $row['id'] ?? null,
            'nightAllowance' => (float) ($row['night_allowance_paid'] ?? 0),
            'extraWorkAllowance' => (float) ($row['extra_work_allowance_paid'] ?? 0),
            'mess' => (float) ($row['mess_amount'] ?? 0),
            'creditSociety' => (float) ($row['credit_society_amount'] ?? 0),
            'electricity' => (float) ($row['electricity_amount'] ?? 0),
            'electricityUnits' => (float) ($row['electricity_units_consumed'] ?? 0),
            'gross' => $gross,
            'deductions' => $deductions,
            'net' => $net,
            'grossMinusDeductionsMinusNet' => round($gross - $deductions - $net, 2),
        ];
    }

    $payrollAudits = DB::table('cirt_monthly_payroll_audits')
        ->where('company_id', $companyId)->where('payroll_period_id', $period->id)
        ->orderBy('created_at')->get([
            'id', 'monthly_payroll_id', 'employee_user_id', 'changed_by', 'changed_by_name',
            'change_reason', 'before_payload', 'after_payload', 'changed_fields', 'created_at',
        ])->map(function ($audit) use ($employeeCodes): array {
            $fields = is_array($audit->changed_fields) ? $audit->changed_fields : json_decode((string) $audit->changed_fields, true);
            return [
                'auditId' => $audit->id,
                'monthlyPayrollId' => $audit->monthly_payroll_id,
                'employeeCode' => $employeeCodes[(string) $audit->employee_user_id] ?? null,
                'employeeUserId' => $audit->employee_user_id,
                'actorId' => $audit->changed_by,
                'actorName' => $audit->changed_by_name,
                'reason' => $audit->change_reason,
                'changedFields' => $fields,
                'createdAt' => $audit->created_at,
            ];
        })->all();

    $activityLogs = DB::table('cirt_activity_logs')
        ->where('company_id', $companyId)->where('payroll_period_id', $period->id)
        ->whereIn('action', ['payroll.generated', 'payroll.generated.amended', 'payroll.excel.exported'])
        ->orderBy('created_at')->get([
            'id', 'action', 'outcome', 'actor_user_id', 'target_employee_user_id', 'monthly_payroll_id',
            'changed_fields', 'previous_value', 'new_value', 'metadata', 'request_id', 'created_at',
        ])->map(function ($log) use ($employeeCodes): array {
            $decode = static fn ($value) => is_array($value) ? $value : (json_decode((string) $value, true) ?? null);
            return [
                'activityId' => $log->id,
                'action' => $log->action,
                'outcome' => $log->outcome,
                'actorId' => $log->actor_user_id,
                'employeeCode' => $employeeCodes[(string) $log->target_employee_user_id] ?? null,
                'employeeUserId' => $log->target_employee_user_id,
                'monthlyPayrollId' => $log->monthly_payroll_id,
                'changedFields' => $decode($log->changed_fields),
                'previousValue' => $decode($log->previous_value),
                'newValue' => $decode($log->new_value),
                'metadata' => $decode($log->metadata),
                'requestId' => $log->request_id,
                'createdAt' => $log->created_at,
            ];
        })->all();

    $excelComparison = ['status' => 'not-provided', 'note' => 'Supply the previously verified October workbook with --excel=PATH to compare employee rows.'];
    if (isset($options['excel'])) {
        $excelPath = (string) $options['excel'];
        if (! is_file($excelPath)) throw new RuntimeException('The supplied Excel workbook was not found.');
        $excelComparison = compareExcelWorkbook($excelPath, $currentMonthly, $latest['monthly'] ?? [], $employeeCodes, $companyId, (string) $period->id);
    }

    $report = [
        'report' => 'CIRT October 2026 payroll read-only diagnostic',
        'generatedAt' => now()->toIso8601String(),
        'environmentLabel' => $environment,
        'databaseTarget' => $database,
        'company' => ['id' => $companyId, 'code' => $company->code],
        'period' => [
            'id' => $period->id,
            'start' => $period->period_start,
            'end' => $period->period_end,
            'locked' => (bool) $period->is_locked,
        ],
        'preservationCounts' => [
            'monthlyPayrollRows' => count($currentMonthly),
            'payslips' => count($currentPayslips),
            'revisions' => count($revisions),
            'monthlyPayrollAudits' => count($payrollAudits),
            'activityLogEvents' => count($activityLogs),
        ],
        'revisionChecks' => $revisionChecks,
        'revisionToRevisionChanges' => $revisionChanges,
        'latestRevisionVsCurrent' => [
            'monthlyMaterialDifferenceCount' => count($latestMonthlyChanges),
            'payslipMaterialDifferenceCount' => count($latestPayslipChanges),
            'monthlyDifferences' => $latestMonthlyChanges,
            'payslipDifferences' => $latestPayslipChanges,
        ],
        'componentTotals' => $componentTotals,
        'employeeReconciliation' => $employeeReconciliation,
        'monthlyPayrollAuditEvents' => $payrollAudits,
        'activityLogEvents' => $activityLogs,
        'exact11800ValueChanges' => $discrepancyCandidates,
        'excelComparison' => $excelComparison,
        'writeSafety' => [
            'transactionReadOnly' => true,
            'payrollRowsModified' => false,
            'revisionsModified' => false,
            'auditsModified' => false,
            'migrationsRun' => false,
        ],
    ];
} finally {
    if ($connection->transactionLevel() > 0) $connection->rollBack();
}

$json = json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (isset($options['out'])) {
    $outputPath = (string) $options['out'];
    if (file_exists($outputPath)) throw new RuntimeException('Refusing to overwrite an existing diagnostic report.');
    if (! is_dir(dirname($outputPath))) throw new RuntimeException('The diagnostic output directory does not exist.');
    if (file_put_contents($outputPath, $json, LOCK_EX) === false) throw new RuntimeException('Could not write the local diagnostic report.');
    fwrite(STDOUT, json_encode([
        'reportPath' => $outputPath,
        'monthlyRows' => $report['preservationCounts']['monthlyPayrollRows'],
        'payslips' => $report['preservationCounts']['payslips'],
        'revisions' => count($report['revisionChecks']),
        'revisionCurrentMonthlyDifferences' => $report['latestRevisionVsCurrent']['monthlyMaterialDifferenceCount'],
        'revisionCurrentPayslipDifferences' => $report['latestRevisionVsCurrent']['payslipMaterialDifferenceCount'],
        'exact11800ValueChanges' => count($report['exact11800ValueChanges']),
        'excelComparison' => $report['excelComparison']['status'],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL);
} else {
    fwrite(STDOUT, $json.PHP_EOL);
}

/** Compare a supplied workbook to current and latest-revision data by unique EmployeeCode or bank account. */
function compareExcelWorkbook(string $path, array $currentRows, array $revisionRows, array $employeeCodes, string $companyId, string $periodId): array
{
    $spreadsheet = IOFactory::load($path);
    $sheet = $spreadsheet->getSheetByName('Employee Detail') ?? $spreadsheet->getSheet(0);
    $matrix = $sheet->toArray(null, true, true, false);
    $headerIndex = null;
    $headers = [];
    foreach (array_slice($matrix, 0, 30, true) as $index => $row) {
        $normalized = array_map(static fn ($value) => strtolower(preg_replace('/[^a-z0-9]/i', '', trim((string) $value))), $row);
        if (in_array('accountnumber', $normalized, true) && in_array('employeename', $normalized, true)) {
            $headerIndex = $index;
            $headers = $normalized;
            break;
        }
    }
    if ($headerIndex === null) return ['status' => 'unmatched-format', 'file' => basename($path), 'sha256' => hash_file('sha256', $path), 'note' => 'No Employee Detail header with AccountNumber and EmployeeName was found.'];

    $column = [];
    foreach ($headers as $index => $header) $column[$header] = $index;
    $currentById = [];
    foreach ($currentRows as $row) $currentById[(string) $row['employee_user_id']] = $row;
    $revisionById = [];
    foreach ($revisionRows as $row) $revisionById[(string) $row['employee_user_id']] = $row;

    $slips = DB::table('cirt_payslips')->where('company_id', $companyId)->where('payroll_period_id', $periodId)
        ->get(['employee_user_id', 'bank_account_number'])->all();
    $idsByAccount = [];
    foreach ($slips as $slip) {
        $account = normalizeWorkbookKey((string) $slip->bank_account_number);
        if ($account !== '') $idsByAccount[$account][] = (string) $slip->employee_user_id;
    }

    $fields = [
        'nightallowance' => ['Night Allowance', 'night_allowance_paid'],
        'extraworkallowance' => ['Extra Work Allowance', 'extra_work_allowance_paid'],
        'overtimepay' => ['Overtime Pay', 'extra_work_allowance_paid'],
        'mess' => ['Mess', 'mess_amount'],
        'creditsociety' => ['Credit Society', 'credit_society_amount'],
        'electricity' => ['Electricity', 'electricity_amount'],
        'electricityunits' => ['Electricity Units', 'electricity_units_consumed'],
        'grosstotal' => ['Gross Total', 'total_earnings'],
        'totalearnings' => ['Total Earnings', 'total_earnings'],
        'totaldeductions' => ['Total Deductions', 'total_deductions'],
        'netsalary' => ['Net Salary', 'net_salary'],
        'netpay' => ['Net Pay', 'net_salary'],
    ];
    $compared = 0;
    $unmatched = 0;
    $differences = [];
    $exact11800 = [];
    foreach (array_slice($matrix, $headerIndex + 1, null, true) as $row) {
        $account = normalizeWorkbookKey((string) ($row[$column['accountnumber']] ?? ''));
        if ($account === '') continue;
        $ids = $idsByAccount[$account] ?? [];
        if (count($ids) !== 1) { $unmatched++; continue; }
        $userId = $ids[0];
        $current = $currentById[$userId] ?? null;
        $revision = $revisionById[$userId] ?? null;
        if (! $current) { $unmatched++; continue; }
        $compared++;
        foreach ($fields as $header => [$label, $dbField]) {
            if (! array_key_exists($header, $column)) continue;
            $raw = $row[$column[$header]] ?? null;
            if (! is_numeric($raw)) continue;
            $excelValue = round((float) $raw, 2);
            $currentValue = round((float) ($current[$dbField] ?? 0), 2);
            $revisionValue = round((float) ($revision[$dbField] ?? 0), 2);
            $delta = round($currentValue - $excelValue, 2);
            if (abs($delta) > 0.01 || abs(round($revisionValue - $excelValue, 2)) > 0.01) {
                $employeeCode = $employeeCodes[$userId] ?? null;
                $differences[] = [
                    'employeeCode' => $employeeCode,
                    'employeeUserId' => $userId,
                    'component' => $label,
                    'excelValue' => $excelValue,
                    'latestRevisionValue' => $revisionValue,
                    'currentValue' => $currentValue,
                    'currentMinusExcel' => $delta,
                ];
                if (abs(abs($delta) - 11800) < 0.01) $exact11800[] = end($differences);
            }
        }
    }
    return [
        'status' => 'compared',
        'file' => basename($path),
        'sha256' => hash_file('sha256', $path),
        'matchKey' => 'unique AccountNumber from payslip snapshot (not included in report)',
        'matchedEmployees' => $compared,
        'unmatchedOrAmbiguousRows' => $unmatched,
        'componentDifferences' => $differences,
        'exact11800Differences' => $exact11800,
    ];
}

function normalizeWorkbookKey(string $value): string
{
    return preg_replace('/\s+/', '', trim($value));
}
