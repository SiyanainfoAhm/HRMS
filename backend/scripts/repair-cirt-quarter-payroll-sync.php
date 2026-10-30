<?php

use App\Models\HrmsActivityLog;
use App\Models\HrmsCompany;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsQuarterAssignment;
use App\Models\HrmsUser;
use App\Services\DefaultCompanyService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollDraftService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__).'/vendor/autoload.php';
$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function (Throwable $exception): void {
    fwrite(STDERR, 'ABORT: '.$exception->getMessage()."\n");
    exit(2);
});

$options = [];
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--apply') { $options['apply'] = true; continue; }
    if (preg_match('/^--([a-z-]+)=(.*)$/', $argument, $match)) $options[$match[1]] = $match[2];
}
$year = filter_var($options['year'] ?? null, FILTER_VALIDATE_INT);
$month = filter_var($options['month'] ?? null, FILTER_VALIDATE_INT);
if (! $year || $year < 2000 || $year > 2100 || ! $month || $month < 1 || $month > 12) {
    fwrite(STDERR, "Usage: php scripts/repair-cirt-quarter-payroll-sync.php --year=YYYY --month=MM [--employee-code=CODE] [--apply --actor-id=UUID]\n");
    exit(2);
}
$apply = (bool) ($options['apply'] ?? false);
if ($apply && empty($options['actor-id'])) {
    fwrite(STDERR, "--actor-id=<manager UUID> is required with --apply so repair audit records identify the operator.\n");
    exit(2);
}
$code = isset($options['employee-code']) ? trim((string) $options['employee-code']) : null;
$periodStart = Carbon::create($year, $month, 1)->startOfMonth()->toDateString();
$periodEnd = Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
$companyCode = (string) config('app.default_company_code', 'CIRT');
$companyName = (string) config('app.organization_name', 'CIRT');
$company = HrmsCompany::query()->whereRaw('LOWER(code) = ?', [mb_strtolower($companyCode)])->first()
    ?? HrmsCompany::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($companyName)])->first();
if (! $company) { fwrite(STDERR, "No configured CIRT company row found; no data was created or changed.\n"); exit(2); }

$masters = HrmsPayrollMaster::query()->where('company_id', $company->id)->whereNull('effective_to')->orderBy('employee_code')->get();
if ($code !== null && $code !== '' && $masters->where('employee_code', $code)->count() !== 1) {
    throw new RuntimeException("Employee code {$code} must map to exactly one current Payroll Master row; aborting.");
}
if ($code !== null && $code !== '') $masters = $masters->where('employee_code', $code)->values();
$masterByUser = [];
foreach ($masters as $master) {
    $employeeUserId = (string) ($master->employee_user_id ?: $master->user_id ?: '');
    if ($employeeUserId === '') throw new RuntimeException("Payroll Master row {$master->id} has no employee user mapping.");
    if ($master->employee_user_id && $master->user_id && $master->employee_user_id !== $master->user_id) {
        throw new RuntimeException("Payroll Master row {$master->id} maps employee_user_id and user_id differently; aborting.");
    }
    if (isset($masterByUser[$employeeUserId])) throw new RuntimeException("Multiple current Payroll Master rows map to employee {$employeeUserId}; aborting.");
    $masterByUser[$employeeUserId] = $master;
}

$assignments = HrmsQuarterAssignment::query()->with(['quarter.quarterType'])
    ->where('company_id', $company->id)
    ->when($code !== null && $code !== '', fn ($query) => $query->whereIn('employee_id', array_keys($masterByUser)))
    ->where(fn ($query) => $query->whereNull('assigned_from')->orWhereDate('assigned_from', '<=', $periodEnd))
    ->where(fn ($query) => $query->whereNull('assigned_to')->orWhereDate('assigned_to', '>', $periodEnd))
    ->get();
$assignmentByUser = [];
foreach ($assignments as $assignment) {
    $employeeUserId = (string) $assignment->employee_id;
    if (isset($assignmentByUser[$employeeUserId])) throw new RuntimeException("Multiple active quarters overlap for employee {$employeeUserId} in {$year}-{$month}; aborting without guessing.");
    if (! $assignment->quarter || $assignment->quarter->company_id !== $company->id) throw new RuntimeException("Assignment {$assignment->id} has an invalid quarter mapping; aborting.");
    $assignmentByUser[$employeeUserId] = $assignment;
}

$drafts = HrmsPayrollDraft::query()->where('company_id', $company->id)->where('payroll_year', $year)->where('payroll_month', $month)->where('status', HrmsPayrollDraft::STATUS_DRAFT)->get();
if ($drafts->count() > 1) throw new RuntimeException("More than one active draft exists for {$year}-{$month}; aborting.");
$draft = $drafts->first();
$draftEmployeeRows = $draft ? $draft->employees()->get() : collect();
if ($code !== null && $code !== '') $draftEmployeeRows = $draftEmployeeRows->whereIn('employee_user_id', array_keys($masterByUser))->values();
if ($draftEmployeeRows->pluck('employee_user_id')->unique()->count() !== $draftEmployeeRows->count()) {
    throw new RuntimeException("Duplicate employee rows exist in the selected draft; aborting.");
}
$draftRows = $draftEmployeeRows->keyBy('employee_user_id');
$generatedPeriods = HrmsPayrollPeriod::query()->where('company_id', $company->id)
    ->whereDate('period_start', '<=', $periodEnd)->whereDate('period_end', '>=', $periodStart)->get();
$generated = $generatedPeriods->contains(fn ($period) => HrmsPayslip::query()->where('payroll_period_id', $period->id)->exists()
    || HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id', $period->id)->exists());

$employeeIds = array_unique([...array_keys($masterByUser), ...array_keys($assignmentByUser), ...$draftRows->keys()->map(fn ($id) => (string) $id)->all()]);
if ($code !== null && $code !== '') {
    $employeeIds = array_values(array_filter($employeeIds, fn ($id) => (string) ($masterByUser[$id]->employee_code ?? '') === $code));
    if ($employeeIds === []) throw new RuntimeException("Employee code {$code} did not map uniquely to a current Payroll Master row.");
}

$quarterService = app(App\Services\QuarterService::class);
$draftService = app(PayrollDraftService::class);
$calculator = app(PayrollCalculationService::class);
$fieldDefinitions = App\Models\HrmsPayrollFieldDefinition::query()->where('company_id', $company->id)->where('is_active', true)
    ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all();
$plans = [];
foreach ($employeeIds as $employeeUserId) {
    $master = $masterByUser[$employeeUserId] ?? null;
    $user = HrmsUser::query()->where('company_id', $company->id)->whereKey($employeeUserId)->first();
    if (! $user) throw new RuntimeException("Employee mapping {$employeeUserId} is missing or outside the configured company.");
    if (! $master && isset($assignmentByUser[$employeeUserId])) throw new RuntimeException("Active quarter assignment for employee {$employeeUserId} has no unique Payroll Master row.");
    $assignment = $assignmentByUser[$employeeUserId] ?? null;
    $quarter = $assignment?->quarter;
    $quarterType = $quarter?->quarterType?->name ?: trim((string) ($quarter?->quarter_type ?? ''));
    $rent = $assignment ? $assignment->rent_at_assignment : 0;
    if ($assignment && ($quarterType === '' || $rent === null || ! is_numeric($rent) || (float) $rent < 0)) {
        throw new RuntimeException("Quarter type/rent cannot be resolved for employee {$employeeUserId}; aborting.");
    }
    $meta = $assignment ? [
        'hasQuarter' => true, 'quarterAssigned' => true, 'quarterId' => (string) $quarter->id,
        'quarterName' => (string) $quarter->quarter_name, 'quarterType' => $quarterType,
        'quarterTypeId' => $quarter->quarter_type_id, 'quarterRent' => round((float) $rent, 2), 'hraEligible' => false,
    ] : [
        'hasQuarter' => false, 'quarterAssigned' => false, 'quarterId' => null, 'quarterName' => null,
        'quarterType' => null, 'quarterTypeId' => null, 'quarterRent' => 0.0, 'hraEligible' => true,
    ];
    if ($code !== null && $code !== '' && (string) ($master?->employee_code ?? '') !== $code) continue;

    $currentMasterState = $master ? [
        'hasQuarter' => (bool) $master->has_quarter,
        'quarterId' => $master->quarter_id,
        'quarterRent' => (float) ($master->quarter_rent ?? 0),
    ] : ['hasQuarter' => false, 'quarterId' => null, 'quarterRent' => 0.0];
    $currentHra = $master ? (float) $calculator->calculateMaster([
        'gross_basic_pay' => (float) ($master->gross_basic_pay ?? $master->gross_basic ?? 0),
        'hra_percent' => (float) ($master->hra_percent ?? 30),
        'has_quarter' => (bool) $master->has_quarter,
        'quarter_rent' => (float) ($master->quarter_rent ?? 0),
    ])['hra_amount'] : null;
    $correctHra = $master ? (float) $calculator->calculateMaster([
        'gross_basic_pay' => (float) ($master->gross_basic_pay ?? $master->gross_basic ?? 0),
        'hra_percent' => (float) ($master->hra_percent ?? 30),
        'has_quarter' => $meta['hasQuarter'],
        'quarter_rent' => $meta['quarterRent'],
    ])['hra_amount'] : null;
    $draftRow = $draftRows->get($employeeUserId);
    $currentDraft = $draftRow && is_array($draftRow->row_payload) ? $draftRow->row_payload : null;
    $correctDraft = $currentDraft ? $draftService->applyAuthoritativeQuarterValues($currentDraft, $meta, $year, $month, $fieldDefinitions, $master) : null;
    $draftSummary = static function (?array $payload): ?array {
        if (! $payload) return null;
        $gm = $payload['governmentMonthly'] ?? $payload['government_monthly'] ?? [];
        $ded = is_array($gm) ? ($gm['deductions'] ?? []) : [];
        return [
            'hasQuarter' => (bool) ($payload['hasQuarter'] ?? $payload['quarterAssigned'] ?? false),
            'quarterId' => $payload['quarterId'] ?? null,
            'quarterName' => $payload['quarterName'] ?? null,
            'quarterType' => $payload['quarterType'] ?? null,
            'quarterRent' => (float) ($ded['quarterRent'] ?? $gm['quarterRent'] ?? $payload['quarterRent'] ?? 0),
            'hraPaid' => (float) ($gm['hraPaid'] ?? 0),
        ];
    };
    $masterChanged = $currentMasterState !== ['hasQuarter' => $meta['hasQuarter'], 'quarterId' => $meta['quarterId'], 'quarterRent' => (float) $meta['quarterRent']];
    $draftChanged = $draftSummary($currentDraft) !== $draftSummary($correctDraft);
    if ($currentDraft && ! $correctDraft) throw new RuntimeException("Could not calculate authoritative draft values for employee {$employeeUserId}.");
    $plans[] = [
        'employeeUserId' => $employeeUserId, 'code' => (string) ($master?->employee_code ?? $user->employee_code ?? ''), 'name' => (string) ($master?->name ?? $user->name),
        'quarter' => $meta['quarterName'] ?? '', 'quarterType' => $meta['quarterType'] ?? '', 'quarterRent' => (float) $meta['quarterRent'],
        'master' => $master, 'currentMaster' => $currentMasterState, 'correctMaster' => ['hasQuarter' => $meta['hasQuarter'], 'quarterId' => $meta['quarterId'], 'quarterRent' => (float) $meta['quarterRent']],
        'currentHra' => $currentHra, 'correctHra' => $correctHra, 'draftRow' => $draftRow, 'currentDraft' => $draftSummary($currentDraft),
        'correctDraft' => $draftSummary($correctDraft), 'correctPayload' => $correctDraft, 'draftNeedsRepair' => $draftChanged, 'repair' => $masterChanged || $draftChanged,
    ];
}

fwrite(STDOUT, "Mode: ".($apply ? 'APPLY (transactional)' : 'DRY RUN (read only)')."\nPeriod: {$year}-".str_pad((string) $month, 2, '0', STR_PAD_LEFT)." | Company: {$company->code}\nGenerated payroll present: ".($generated ? 'YES (apply prohibited)' : 'no')."\n");
fwrite(STDOUT, "Employee Code\tEmployee Name\tQuarter\tQuarter Type\tQuarter Rent\tMaster Current\tMaster Correct\tCurrent effective HRA\tCorrect effective HRA\tDraft Current\tDraft Correct\tRepair\n");
foreach ($plans as $plan) {
    fwrite(STDOUT, implode("\t", [
        $plan['code'], $plan['name'], $plan['quarter'], $plan['quarterType'], number_format($plan['quarterRent'], 2, '.', ''),
        json_encode($plan['currentMaster']), json_encode($plan['correctMaster']),
        $plan['currentHra'] === null ? 'n/a' : number_format($plan['currentHra'], 2, '.', ''),
        $plan['correctHra'] === null ? 'n/a' : number_format($plan['correctHra'], 2, '.', ''),
        json_encode($plan['currentDraft']), json_encode($plan['correctDraft']), $plan['repair'] ? 'YES' : 'no',
    ])."\n");
}
if (! $apply) {
    fwrite(STDOUT, "Dry run complete. No data was changed. Add --apply and --actor-id=<manager UUID> only after reviewing these values.\n");
    exit(0);
}
if ($generated) throw new RuntimeException("{$year}-{$month} already has generated payroll records; this tool never changes generated payroll.");
$actor = HrmsUser::query()->where('company_id', $company->id)->whereKey((string) $options['actor-id'])->first();
if (! $actor || ! $actor->hasManagerialRole()) throw new RuntimeException('--actor-id must identify a managerial user in the configured CIRT company.');
$draftVersion = (int) ($draft?->version ?? 0);
DB::transaction(function () use ($plans, $company, $actor, $draft, $draftVersion, $year, $month, $draftService, $quarterService) {
    $version = $draftVersion;
    foreach ($plans as $plan) {
        if (! $plan['repair']) continue;
        $master = $plan['master'];
        if ($master) {
            $before = $plan['currentMaster'];
            $lockedMaster = HrmsPayrollMaster::query()->whereKey($master->id)->where('company_id', $company->id)->lockForUpdate()->firstOrFail();
            $lockedState = ['hasQuarter' => (bool) $lockedMaster->has_quarter, 'quarterId' => $lockedMaster->quarter_id, 'quarterRent' => (float) ($lockedMaster->quarter_rent ?? 0)];
            if ($lockedState !== $before) throw new RuntimeException("Payroll Master changed since dry run for employee {$plan['code']}; rerun the dry run.");
            $freshMeta = $quarterService->quarterMetaForEmployeePeriod((string) $company->id, $plan['employeeUserId'], $year, $month);
            $after = ['hasQuarter' => (bool) $freshMeta['hasQuarter'], 'quarterId' => $freshMeta['quarterId'], 'quarterRent' => (float) $freshMeta['quarterRent']];
            if ($after !== $plan['correctMaster']) throw new RuntimeException("Quarter assignment changed since dry run for employee {$plan['code']}; rerun the dry run.");
            fwrite(STDOUT, "MASTER BEFORE/AFTER {$plan['code']}: ".json_encode($before)." => ".json_encode($after)."\n");
            HrmsActivityLog::query()->create([
                'company_id' => $company->id, 'actor_user_id' => $actor->id, 'actor_role' => (string) $actor->getRawOriginal('role'),
                'action' => 'payroll.quarter.reconciled', 'outcome' => 'succeeded', 'target_employee_user_id' => $plan['employeeUserId'],
                'payroll_year' => $year, 'payroll_month' => $month,
                'field_changed' => 'quarter_assignment',
                'changed_fields' => [
                    ['field' => 'has_quarter', 'old' => $before['hasQuarter'], 'new' => $after['hasQuarter']],
                    ['field' => 'quarter_id', 'old' => $before['quarterId'], 'new' => $after['quarterId']],
                    ['field' => 'quarter_rent', 'old' => $before['quarterRent'], 'new' => $after['quarterRent']],
                ],
                'previous_value' => $before, 'new_value' => $after,
                'metadata' => ['source' => 'repair-cirt-quarter-payroll-sync', 'draftVersion' => $version],
            ]);
            $lockedMaster->update(['has_quarter' => $after['hasQuarter'], 'quarter_id' => $after['quarterId'], 'quarter_rent' => $after['quarterRent']]);
        }
        if ($draft && $plan['draftRow'] && $plan['correctPayload'] && $plan['draftNeedsRepair']) {
            fwrite(STDOUT, "DRAFT BEFORE/AFTER {$plan['code']}: ".json_encode($plan['currentDraft'])." => ".json_encode($plan['correctDraft'])."; currentDraftVersion={$version}\n");
            $saved = $draftService->saveDraft((string) $company->id, $year, $month, (string) $actor->id, [[
                'employeeUserId' => $plan['employeeUserId'],
                'employeeCode' => $plan['code'],
                'changedFields' => ['govEarning_hraPaid', 'govDeduction_quarterRent'],
                'rowPayload' => $plan['correctPayload'],
                'reason' => 'Quarter assignment reconciliation ('. $year .'-'. str_pad((string) $month, 2, '0', STR_PAD_LEFT) .')',
            ]], $version, false);
            $version = (int) $saved['draft']['version'];
        }
    }
});
fwrite(STDOUT, "Apply complete. Payroll Master changes have Activity Log evidence; draft changes have versioned employee audit evidence.\n");
