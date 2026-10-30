<?php

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$periodId = 'a30895ff-b1a4-4775-bd2b-cdf8d6e5004f';
$revision = DB::table('cirt_payroll_run_revisions')->where('payroll_period_id', $periodId)->orderByDesc('revision_no')->first();
if (! $revision) throw new RuntimeException('September 2026 has no archived revision.');

$archivedMonthly = json_decode($revision->monthly_rows, true, flags: JSON_THROW_ON_ERROR);
$archivedPayslips = json_decode($revision->payslip_rows, true, flags: JSON_THROW_ON_ERROR);
$baselinePath = __DIR__.'/../../outputs/cirt-production-hardening-backup-20261027/september-2026-employee-snapshots.jsonl';
$baseline = [];
$baselineDuplicateIds = [];
$baselineLineCount = 0;
$baselineInvalidLines = [];
foreach (file($baselinePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $lineNo => $line) {
    if ($lineNo === 0) $line = preg_replace('/^\xEF\xBB\xBF/', '', $line) ?? $line;
    $record = json_decode($line, true);
    if (! is_array($record)) { $baselineInvalidLines[] = ['line' => $lineNo + 1, 'error' => json_last_error_msg()]; continue; }
    if (($record['period']['id'] ?? null) === $periodId) {
        $baselineLineCount++;
        if (isset($baseline[$record['payroll']['id']])) $baselineDuplicateIds[] = $record['payroll']['id'];
        $baseline[$record['payroll']['id']] = $record;
    }
}
$liveMonthly = DB::table('cirt_monthly_payroll')->where('payroll_period_id', $periodId)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
$livePayslips = DB::table('cirt_payslips')->where('payroll_period_id', $periodId)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
$archivedChecksum = \App\Services\PayrollRunRevisionService::checksum($archivedMonthly, $archivedPayslips);
$canonical = static function (mixed $value) use (&$canonical): mixed {
    if (! is_array($value)) return $value;
    if (! array_is_list($value)) ksort($value);
    foreach ($value as $key => $item) $value[$key] = $canonical($item);
    return $value;
};
$sum = static fn (array $rows, string $key): int => (int) array_sum(array_map(static fn ($row) => (float) ($row[$key] ?? 0), $rows));
$summary = [
    'employees' => count($archivedMonthly),
    'gross' => $sum($archivedMonthly, 'total_earnings'),
    'deductions' => $sum($archivedMonthly, 'total_deductions'),
    'net' => $sum($archivedMonthly, 'net_salary'),
];
$liveSummary = [
    'employees' => count($liveMonthly),
    'gross' => $sum($liveMonthly, 'total_earnings'),
    'deductions' => $sum($liveMonthly, 'total_deductions'),
    'net' => $sum($liveMonthly, 'net_salary'),
];
$employeeSnapshotsMatch = json_encode($canonical($archivedMonthly), JSON_THROW_ON_ERROR) === json_encode($canonical($liveMonthly), JSON_THROW_ON_ERROR)
    && json_encode($canonical($archivedPayslips), JSON_THROW_ON_ERROR) === json_encode($canonical($livePayslips), JSON_THROW_ON_ERROR);
$normalizeValue = static function (mixed $value) use (&$normalizeValue): mixed {
    if (is_array($value)) {
        if (! array_is_list($value)) ksort($value);
        foreach ($value as $key => $item) $value[$key] = $normalizeValue($item);
        return $value;
    }
    return is_numeric($value) ? number_format((float) $value, 4, '.', '') : $value;
};
$sourceFields = ['id', 'employee_user_id', 'payroll_period_id', 'payslip_id', 'paid_days', 'unpaid_days', 'hpl_days', 'eol_days', 'basic_paid', 'sp_pay_paid', 'da_paid', 'transport_paid', 'hra_paid', 'medical_paid', 'extra_work_allowance_paid', 'night_allowance_paid', 'uniform_allowance_paid', 'education_allowance_paid', 'encashment_paid', 'encashment_da_paid', 'income_tax_amount', 'pt_amount', 'lic_amount', 'cpf_amount', 'da_cpf_amount', 'vpf_amount', 'pf_loan_amount', 'post_office_amount', 'credit_society_amount', 'std_licence_fee_amount', 'electricity_amount', 'water_amount', 'mess_amount', 'loan_recovery_amount', 'welfare_amount', 'hpl_amount', 'eol_amount', 'veh_charge_amount', 'other_deduction_amount', 'total_earnings', 'total_deductions', 'net_salary'];
$archivedById = [];
foreach ($archivedMonthly as $row) $archivedById[$row['id']] = $row;
$sourceMismatches = [];
foreach ($baseline as $id => $record) {
    $saved = $archivedById[$id] ?? null;
    foreach ($sourceFields as $field) {
        if ($saved === null || $normalizeValue($saved[$field] ?? null) !== $normalizeValue($record['payroll'][$field] ?? null)) {
            $sourceMismatches[] = ['monthly_payroll_id' => $id, 'employee_user_id' => $record['payroll']['employee_user_id'] ?? null, 'field' => $field];
        }
    }
}
$sourceSnapshotsMatch = count($baseline) === 83 && $sourceMismatches === [];

echo json_encode([
    'database' => DB::selectOne('select current_database() as database, inet_server_addr()::text as host, inet_server_port() as port'),
    'period_id' => $periodId,
    'revision' => (int) $revision->revision_no,
    'revision_action' => $revision->action,
    'snapshot_checksum_valid' => hash_equals($revision->snapshot_sha256, $archivedChecksum),
    'archived_summary' => $summary,
    'live_summary' => $liveSummary,
    'archived_and_live_employee_snapshots_match' => $employeeSnapshotsMatch,
    'protected_baseline_employee_snapshots_match' => $sourceSnapshotsMatch,
    'protected_baseline_employee_count' => count($baseline),
    'protected_baseline_line_count' => $baselineLineCount,
    'protected_baseline_invalid_lines' => $baselineInvalidLines,
    'protected_baseline_duplicate_ids' => $baselineDuplicateIds,
    'protected_baseline_mismatch_count' => count($sourceMismatches),
    'archived_payslip_count' => count($archivedPayslips),
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;

if (! hash_equals($revision->snapshot_sha256, $archivedChecksum) || $summary !== $liveSummary || ! $employeeSnapshotsMatch || ! $sourceSnapshotsMatch) {
    exit(1);
}
