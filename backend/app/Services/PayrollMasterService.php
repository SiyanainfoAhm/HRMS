<?php

namespace App\Services;

use App\Enums\EmploymentStatus;
use App\Enums\UserRole;
use App\Models\HrmsCompany;
use App\Models\HrmsDepartment;
use App\Models\HrmsDesignation;
use App\Models\HrmsDivision;
use App\Models\HrmsEmployee;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollMasterHistory;
use App\Models\HrmsUser;
use App\Support\IncrementMonth;
use App\Support\SpreadsheetImportSecurity;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Csv;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PayrollMasterService
{
    private ?string $importCompanyContext = null;

    public function __construct(
        private readonly PayrollCalculationService $calculator,
        private readonly PayrollFieldService $fieldService,
    ) {}

    /** @return list<array<string, mixed>> */
    public function listForCompany(?string $companyId): array
    {
        $query = HrmsPayrollMaster::query()
            ->whereNull('effective_to')
            ->orderBy('created_at');

        if ($companyId) {
            $query->where('company_id', $companyId);
        }

        if (config('app.debug')) {
            Log::debug('payroll_master.list', [
                'company_id' => $companyId,
                'total_in_table' => HrmsPayrollMaster::query()->when($companyId, fn ($q) => $q->where('company_id', $companyId))->count(),
            ]);
        }

        $masters = $query->get();

        if (config('app.debug')) {
            Log::debug('payroll_master.list_result', [
                'company_id' => $companyId,
                'returned' => $masters->count(),
                'sample_da' => $masters->take(5)->map(fn (HrmsPayrollMaster $m) => [
                    'id' => $m->id,
                    'name' => $m->name,
                    'da_percent' => $m->da_percent,
                ])->values()->all(),
            ]);
        }

        return $masters->map(fn (HrmsPayrollMaster $m) => $this->formatRow($m))->values()->all();
    }

    /** @return list<array<string, mixed>> */
    public function historyForMaster(HrmsPayrollMaster $anchor, ?string $companyId): array
    {
        $userId = $anchor->user_id ?? $anchor->employee_user_id;
        $rows = [];

        $currentQuery = HrmsPayrollMaster::query();
        if ($companyId) {
            $currentQuery->where('company_id', $companyId);
        }
        if ($userId) {
            $currentQuery->where(function ($w) use ($userId) {
                $w->where('user_id', $userId)->orWhere('employee_user_id', $userId);
            });
        } elseif ($anchor->employee_code) {
            $currentQuery->where('employee_code', $anchor->employee_code);
        } else {
            $currentQuery->where('id', $anchor->id);
        }
        $current = $currentQuery->first();
        if ($current) {
            $rows[] = $this->formatRow($current, 'CURRENT');
        }

        if (Schema::hasTable('cirt_payroll_master_history')) {
            $historyQuery = HrmsPayrollMasterHistory::query();
            if ($companyId) {
                $historyQuery->where('company_id', $companyId);
            }
            if ($userId) {
                $historyQuery->where(function ($w) use ($userId) {
                    $w->where('user_id', $userId)->orWhere('employee_user_id', $userId);
                });
            } elseif ($anchor->employee_code) {
                $historyQuery->where('employee_code', $anchor->employee_code);
            } else {
                $historyQuery->where('original_master_id', $anchor->id);
            }

            foreach ($historyQuery->get() as $history) {
                $rows[] = $this->formatHistoryRow($history);
            }
        }

        usort($rows, function (array $a, array $b) {
            $fromCmp = strcmp((string) ($b['effectiveFrom'] ?? ''), (string) ($a['effectiveFrom'] ?? ''));
            if ($fromCmp !== 0) {
                return $fromCmp;
            }
            $archivedCmp = strcmp((string) ($b['archivedAt'] ?? ''), (string) ($a['archivedAt'] ?? ''));
            if ($archivedCmp !== 0) {
                return $archivedCmp;
            }

            return strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? ''));
        });

        return array_values($rows);
    }

    /**
     * Apply institute default DA/HRA change to all current payroll master rows (in-place update).
     *
     * @return array{revised: int, skipped: int, errors: list<array{employee: string, message: string}>, samples?: list<array<string, mixed>>}
     */
    public function applyInstituteDaHraRevisionToPayrollMasters(
        string $companyId,
        float $newDaPercent,
        float $newHraPercent,
        string $effectiveFrom,
        ?string $reason,
        string $updatedBy,
    ): array {
        $summary = ['revised' => 0, 'skipped' => 0, 'errors' => []];
        $samples = [];

        if (config('app.debug')) {
            Log::debug('payroll_master.institute_revision_start', [
                'company_id' => $companyId,
                'new_da_percent' => $newDaPercent,
                'new_hra_percent' => $newHraPercent,
                'effective_from' => $effectiveFrom,
            ]);
        }

        try {
            DB::transaction(function () use ($companyId, $newDaPercent, $newHraPercent, $effectiveFrom, $reason, $updatedBy, &$summary, &$samples) {
                $masters = HrmsPayrollMaster::query()
                    ->where('company_id', $companyId)
                    ->whereNull('effective_to')
                    ->orderBy('employee_code')
                    ->lockForUpdate()
                    ->get();

                $historyEffectiveTo = Carbon::parse($effectiveFrom)->subDay()->toDateString();

                foreach ($masters as $master) {
                    $currentDa = (float) ($master->da_percent ?? 0);
                    $currentHra = (float) ($master->hra_percent ?? 0);
                    if (abs($currentDa - $newDaPercent) < 0.001 && abs($currentHra - $newHraPercent) < 0.001) {
                        $summary['skipped']++;

                        continue;
                    }

                    $revisionReason = $reason ?? sprintf(
                        'Institute DA/HRA revision: DA %.2f%% → %.2f%%, HRA %.2f%% → %.2f%%',
                        $currentDa,
                        $newDaPercent,
                        $currentHra,
                        $newHraPercent,
                    );

                    if (Schema::hasTable('cirt_payroll_master_history')) {
                        $this->archiveMasterToHistory(
                            $master,
                            'INSTITUTE_DA_HRA_REVISION',
                            $revisionReason,
                            true,
                            $updatedBy,
                            $master->id,
                            $historyEffectiveTo,
                        );
                    }

                    $validated = $this->masterToRevisionPayload($master, [
                        'da_percent' => $newDaPercent,
                        'hra_percent' => $newHraPercent,
                        'effective_from' => $effectiveFrom,
                        'effectiveFrom' => $effectiveFrom,
                        'reason_for_change' => $revisionReason,
                        'reasonForChange' => $revisionReason,
                    ]);

                    $calc = $this->calculateMasterForCompany($companyId, $validated, null, null, $master->id);
                    $attrs = $this->filterExistingColumns(
                        $this->mergeCalculated($validated, $calc, $companyId, $master->created_by ?? $updatedBy, true),
                    );
                    $master->update($attrs);
                    $master->refresh();

                    $summary['revised']++;
                    if (count($samples) < 5) {
                        $samples[] = [
                            'employee' => (string) ($master->name ?? $master->employee_code ?? $master->id),
                            'da_before' => $currentDa,
                            'da_after' => (float) $master->da_percent,
                            'hra_before' => $currentHra,
                            'hra_after' => (float) $master->hra_percent,
                        ];
                    }
                }
            });
        } catch (\Throwable $e) {
            $summary['errors'][] = [
                'employee' => '*',
                'message' => $e->getMessage(),
            ];
        }

        if (config('app.debug')) {
            Log::debug('payroll_master.institute_revision_done', [
                'company_id' => $companyId,
                'revised' => $summary['revised'],
                'skipped' => $summary['skipped'],
                'error_count' => count($summary['errors']),
                'samples' => $samples,
            ]);
        }

        if ($samples !== []) {
            $summary['samples'] = $samples;
        }

        return $summary;
    }

    /**
     * @return array{revised: int, skipped: int, errors: list<array{employee: string, message: string}>, samples?: list<array<string, mixed>>}
     */
    public function revisionizeForCompanyDaHraChange(
        string $companyId,
        float $newDa,
        float $newHra,
        string $effectiveFrom,
        string $createdBy,
    ): array {
        return $this->applyInstituteDaHraRevisionToPayrollMasters(
            $companyId,
            $newDa,
            $newHra,
            $effectiveFrom,
            null,
            $createdBy,
        );
    }

    public function create(array $payload, string $companyId, string $createdBy, bool $salaryPending = false, bool $provisionUser = true): HrmsPayrollMaster
    {
        return $this->createOrUpdatePayrollMasterRevision($payload, $companyId, $createdBy, null, $salaryPending, $provisionUser);
    }

    public function update(HrmsPayrollMaster $master, array $payload, string $companyId): HrmsPayrollMaster
    {
        return $this->createOrUpdatePayrollMasterRevision(
            $payload,
            $companyId,
            (string) ($master->created_by ?? ''),
            $master,
            false,
            false,
        );
    }

    /**
     * Centralized payroll master create/update/revision with history archival.
     */
    public function createOrUpdatePayrollMasterRevision(
        array $payload,
        string $companyId,
        string $createdBy,
        ?HrmsPayrollMaster $existingMaster = null,
        bool $salaryPending = false,
        bool $provisionUser = true,
    ): HrmsPayrollMaster {
        return DB::transaction(function () use ($payload, $companyId, $createdBy, $existingMaster, $salaryPending, $provisionUser) {
            if ($existingMaster) {
                if ($existingMaster->company_id && $existingMaster->company_id !== $companyId) {
                    abort(403, 'Forbidden');
                }
                $existingMaster = HrmsPayrollMaster::query()
                    ->where('id', $existingMaster->id)
                    ->lockForUpdate()
                    ->firstOrFail();
            } else {
                $userId = $payload['employee_user_id'] ?? $payload['employeeUserId'] ?? $payload['user_id'] ?? $payload['userId'] ?? null;
                if ($userId) {
                    $existingMaster = HrmsPayrollMaster::query()
                        ->where('company_id', $companyId)
                        ->where(function ($q) use ($userId) {
                            $q->where('employee_user_id', $userId)->orWhere('user_id', $userId);
                        })
                        ->lockForUpdate()
                        ->first();
                }
            }

            if (! $existingMaster) {
                $validated = $this->validatePayload($payload, null, $companyId, $salaryPending);
                if ($provisionUser) {
                    $this->provisionIdentityRecords($validated, $companyId, true);
                }
                $defaults = $this->resolveCompanyPayrollDefaults($companyId);
                $calc = $this->calculateMasterForCompany($companyId, $validated, $defaults['da'], $defaults['hra']);
                $attrs = $this->filterExistingColumns($this->mergeCalculated($validated, $calc, $companyId, $createdBy, true));

                $master = HrmsPayrollMaster::create($attrs);
                $this->persistCustomFieldsFromPayload($companyId, $master, $payload);

                return $master;
            }

            $validated = $this->validatePayload($payload, $existingMaster->id, $companyId);
            $needsUser = ! ($existingMaster->employee_user_id ?? $existingMaster->user_id);
            if (! $needsUser) {
                $validated['user_id'] = $existingMaster->user_id ?? $existingMaster->employee_user_id;
                $validated['employee_user_id'] = $existingMaster->employee_user_id ?? $existingMaster->user_id;
            }
            $this->provisionIdentityRecords($validated, $companyId, $needsUser);
            $validated = $this->mergeExistingMasterDefaults($existingMaster, $validated);

            $reason = $validated['reason_for_change'] ?? $validated['reasonForChange'] ?? null;
            $newEffectiveFrom = $validated['effective_from'] ?? $validated['effectiveFrom'] ?? null;
            $currentEffectiveFrom = ($existingMaster->effective_from ?? $existingMaster->effective_start_date)?->toDateString();
            $effectiveFromChanged = $newEffectiveFrom && $currentEffectiveFrom && $newEffectiveFrom !== $currentEffectiveFrom;
            $structureChanged = $this->salaryStructureChanged($existingMaster, $validated);

            if ($effectiveFromChanged) {
                $this->requireRevisionReason($reason, $structureChanged);

                return $this->reviseMasterRecord(
                    $existingMaster,
                    $validated,
                    $companyId,
                    $createdBy ?: $existingMaster->created_by,
                    $reason,
                );
            }

            [$defaultDa, $defaultHra] = $this->resolveCalcDefaults($companyId, $validated);
            if (config('app.debug')) {
                Log::debug('payroll_master.update', [
                    'master_id' => $existingMaster->id,
                    'employee_user_id' => $existingMaster->employee_user_id ?? $existingMaster->user_id,
                    'da_before' => $existingMaster->da_percent,
                    'da_in_payload' => $validated['da_percent'] ?? $validated['daPercent'] ?? null,
                    'structure_changed' => $structureChanged,
                ]);
            }

            $calc = $this->calculateMasterForCompany($companyId, $validated, $defaultDa, $defaultHra, $existingMaster->id);
            $attrs = $this->filterExistingColumns($this->mergeCalculated($validated, $calc, $companyId, $existingMaster->created_by ?? null, true));
            $existingMaster->update($attrs);
            $existingMaster->refresh();
            $this->persistCustomFieldsFromPayload($companyId, $existingMaster, $payload);

            if (config('app.debug')) {
                Log::debug('payroll_master.update_result', [
                    'master_id' => $existingMaster->id,
                    'da_after' => $existingMaster->da_percent,
                    'hra_after' => $existingMaster->hra_percent,
                ]);
            }

            return $existingMaster;
        });
    }

    public function recalculate(HrmsPayrollMaster $master): HrmsPayrollMaster
    {
        $calc = $this->calculateMasterForCompany(
            (string) $master->company_id,
            $this->masterToCalcInput($master),
            null,
            null,
            $master->id,
        );
        $master->update($this->filterExistingColumns($this->calculatedOnly($calc)));

        return $master->refresh();
    }

    public function recalculateAll(?string $companyId): int
    {
        $query = HrmsPayrollMaster::query()->where('status', 'active');
        if ($companyId) {
            $query->where('company_id', $companyId);
        }
        $count = 0;
        foreach ($query->cursor() as $master) {
            $this->recalculate($master);
            $count++;
        }

        return $count;
    }

    /** @return array{found_employees: int, created_master_rows: int, skipped_existing_rows: int, missing_salary_rows: int} */
    public function syncExistingEmployees(?string $companyId, string $createdBy): array
    {
        $found = 0;
        $created = 0;
        $skipped = 0;
        $missingSalary = 0;

        $employees = HrmsEmployee::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->with(['user', 'designation', 'department', 'division'])
            ->get();

        foreach ($employees as $emp) {
            $found++;
            $user = $emp->user;
            if ($this->findExistingMaster($companyId, [
                'employee_code' => $emp->employee_code ?? $user?->employee_code,
                'email' => $emp->email ?? $user?->email,
                'employee_id' => $emp->id,
                'user_id' => $emp->user_id,
            ])) {
                $skipped++;

                continue;
            }

            $gross = (float) ($user?->gross_salary ?? 0);
            $payLevel = (int) ($user?->government_pay_level ?? 0);
            $remarks = ($gross <= 0 || $payLevel <= 0) ? 'Salary details pending' : null;
            if ($remarks) {
                $missingSalary++;
            }

            $payload = [
                'employee_id' => $emp->id,
                'user_id' => $emp->user_id,
                'employee_user_id' => $emp->user_id,
                'employee_code' => $emp->employee_code ?? $user?->employee_code,
                'name' => trim(($emp->first_name ?? '').' '.($emp->last_name ?? '')) ?: $user?->name,
                'email' => $emp->email ?? $user?->email,
                'phone' => $emp->phone ?? $user?->phone,
                'gender' => $user?->gender,
                'designation' => $emp->designation?->title ?? $user?->designation ?? 'Pending',
                'department' => $emp->department?->name,
                'division' => $emp->division?->name,
                'pay_level' => max(1, $payLevel ?: 1),
                'gross_basic_pay' => max(0, $gross),
                'status' => 'active',
                'remarks' => $remarks,
                'effective_from' => now()->toDateString(),
                'date_of_joining' => $emp->date_of_joining?->toDateString() ?? $user?->date_of_joining?->toDateString(),
                'date_of_birth' => $emp->date_of_birth?->toDateString() ?? $user?->date_of_birth?->toDateString(),
                'pan' => $user?->pan,
                'aadhaar' => $user?->aadhaar,
                'uan' => $user?->uan_number,
                'bank_name' => $user?->bank_name,
                'bank_account_number' => $user?->bank_account_number,
                'bank_ifsc' => $user?->bank_ifsc,
            ];

            $this->create($payload, $companyId ?? $emp->company_id, $createdBy, $remarks === 'Salary details pending');
            $created++;
        }

        return [
            'found_employees' => $found,
            'created_master_rows' => $created,
            'skipped_existing_rows' => $skipped,
            'missing_salary_rows' => $missingSalary,
        ];
    }

    /**
     * @return array{
     *     headers: list<string>,
     *     summary: array<string, int>,
     *     rows: list<array<string, mixed>>,
     *     file_errors: list<array{field: string, message: string}>
     * }
     */
    public function previewImportFile(UploadedFile $file, ?string $companyId): array
    {
        $this->importCompanyContext = $companyId;
        $plan = $this->buildImportPlan($file, $companyId);
        $issues = $this->flattenImportIssues($plan);

        $invalidRows = (int) ($plan['summary']['invalid_rows'] ?? 0);
        $canImport = $plan['file_errors'] === [] && $invalidRows === 0;
        $warningRows = (int) ($plan['summary']['warning_rows'] ?? 0);
        $blockedMessage = null;
        if (! $canImport) {
            $blockedMessage = 'Import blocked. Please fix the listed errors and upload again.';
            foreach ($plan['file_errors'] as $fe) {
                if (($fe['field'] ?? '') === 'template') {
                    $blockedMessage = (string) ($fe['message'] ?? $blockedMessage);
                    break;
                }
            }
        }

        return [
            'headers' => $plan['headers'],
            'summary' => $plan['summary'],
            'can_import' => $canImport,
            'requires_confirmation' => $canImport && $warningRows > 0,
            'blocked_message' => $blockedMessage,
            'rows' => array_map(fn (array $item) => $this->formatImportPreviewRow($item), $plan['rows']),
            'file_errors' => $plan['file_errors'],
            'issues' => $issues,
        ];
    }

    /**
     * @return array{message: string, summary: array<string, int>, errors: list<array{row: int, field: string, message: string}>}
     */
    public function importFile(UploadedFile $file, ?string $companyId, string $createdBy): array
    {
        $this->importCompanyContext = $companyId;
        $plan = $this->buildImportPlan($file, $companyId);
        $summary = $plan['summary'];
        $errors = [];

        foreach ($plan['file_errors'] as $e) {
            $errors[] = [
                'row' => 0,
                'employee_code' => null,
                'employee_name' => null,
                'field' => $e['field'],
                'message' => $e['message'],
                'error_type' => 'error',
            ];
        }

        if ($plan['file_errors'] !== [] || ($summary['invalid_rows'] ?? 0) > 0) {
            $blockedMessage = 'Import blocked. Please fix the listed errors and upload again.';
            foreach ($plan['file_errors'] as $fe) {
                if (($fe['field'] ?? '') === 'template') {
                    $blockedMessage = (string) ($fe['message'] ?? $blockedMessage);
                    break;
                }
            }

            foreach ($plan['rows'] as $item) {
                if ($item['valid']) {
                    continue;
                }
                foreach ($item['errors'] as $e) {
                    $errors[] = [
                        'row' => $item['row'],
                        'employee_code' => $item['data']['employee_code'] ?? null,
                        'employee_name' => $item['data']['name'] ?? null,
                        'field' => $e['field'],
                        'message' => $e['message'],
                        'error_type' => $e['type'] ?? 'error',
                    ];
                }
            }

            return [
                'message' => $blockedMessage,
                'summary' => $summary,
                'errors' => $errors,
            ];
        }

        $generatedPasswordAccounts = [];

        foreach ($plan['rows'] as $item) {
            try {
                $data = $item['data'];
                if ($companyId) {
                    $custom = $this->extractCustomFieldValuesFromImportRow($companyId, $data);
                    if ($custom !== []) {
                        $data['customFieldValues'] = $custom;
                    }
                    $customErrors = $this->fieldService->validateCustomFieldValues($companyId, $custom);
                    foreach ($customErrors as $ce) {
                        throw new \InvalidArgumentException($ce['message']);
                    }
                }
                if ($item['action'] === 'update' && $item['existing']) {
                    $this->update($item['existing'], $data, $companyId ?? $item['existing']->company_id);
                    $summary['updated_rows']++;
                } else {
                    $this->create($data, $companyId ?? '', $createdBy, false, true);
                    $summary['inserted_rows']++;
                }
                if (! empty($item['generated_password'])) {
                    $generatedPasswordAccounts[] = [
                        'row' => $item['row'],
                        'employeeCode' => $item['data']['employee_code'] ?? null,
                        'employeeName' => $item['data']['name'] ?? null,
                    ];
                }
            } catch (\Throwable $e) {
                $summary['failed_rows'] = ($summary['failed_rows'] ?? 0) + 1;
                $errors[] = [
                    'row' => $item['row'],
                    'employee_code' => $item['data']['employee_code'] ?? null,
                    'employee_name' => $item['data']['name'] ?? null,
                    'field' => 'row',
                    'message' => $this->friendlyImportSaveError($e),
                    'error_type' => 'error',
                ];
            }
        }

        $message = $errors === []
            ? 'Import completed successfully'
            : 'Import completed with errors';

        return array_merge(compact('message', 'summary', 'errors'), [
            'generated_password_count' => count($generatedPasswordAccounts),
            'generated_password_accounts' => $generatedPasswordAccounts,
        ]);
    }

    /**
     * @return array{
     *     headers: list<string>,
     *     summary: array<string, int>,
     *     rows: list<array{
     *         row: int,
     *         data: array<string, mixed>,
     *         errors: list<array{field: string, message: string}>,
     *         valid: bool,
     *         action: string,
     *         existing: ?HrmsPayrollMaster
     *     }>,
     *     file_errors: list<array{field: string, message: string}>
     * }
     */
    private function buildImportPlan(UploadedFile $file, ?string $companyId): array
    {
        $rows = $this->parseSpreadsheet($file);
        $summary = [
            'total_rows' => 0,
            'valid_rows' => 0,
            'invalid_rows' => 0,
            'warning_rows' => 0,
            'insert_rows' => 0,
            'update_rows' => 0,
            'inserted_rows' => 0,
            'updated_rows' => 0,
            'skipped_rows' => 0,
            'failed_rows' => 0,
        ];
        $fileErrors = [];
        $planRows = [];

        if ($rows === []) {
            $fileErrors[] = ['field' => 'file', 'message' => 'Empty file'];

            return [
                'headers' => [],
                'summary' => $summary,
                'rows' => [],
                'file_errors' => $fileErrors,
            ];
        }

        $header = array_shift($rows);
        $map = $this->normalizeHeaders($header);
        $headers = array_values(array_filter($map));
        $headerRowIndex = 1;

        if (! $this->headersLookLikePayrollImport($headers) && $rows !== []) {
            $legacyHeader = array_shift($rows);
            $legacyMap = $this->normalizeHeaders($legacyHeader);
            $legacyHeaders = array_values(array_filter($legacyMap));
            if ($this->headersLookLikePayrollImport($legacyHeaders)) {
                $headerRowIndex = 2;
                $header = $legacyHeader;
                $map = $legacyMap;
                $headers = $legacyHeaders;
            }
        }

        foreach ($this->validateImportTemplateStructure($headers) as $templateError) {
            $fileErrors[] = $templateError;
        }

        if ($fileErrors !== []) {
            return [
                'headers' => $headers,
                'summary' => $summary,
                'rows' => [],
                'file_errors' => $fileErrors,
            ];
        }

        $rowNum = $headerRowIndex;
        while ($rows !== [] && $this->isImportInstructionRow($rows[0])) {
            array_shift($rows);
        }

        foreach ($rows as $rawRow) {
            $rowNum++;
            if ($this->isEmptyRow($rawRow)) {
                continue;
            }
            $summary['total_rows']++;
            $columnError = $this->validateImportColumnCount($header, $rawRow);
            $row = $this->normalizeImportRow($this->mapRow($map, $rawRow));
            $repair = $this->repairImportRowAlignment($row);
            $row = $repair['row'];
            $rowWarnings = $this->applyImportRowDefaults($row);
            if (! empty($row['status'])) {
                $row['status'] = mb_strtolower(trim((string) $row['status']));
            }
            $existing = $this->findExistingMaster($companyId, $row);
            $action = $existing ? 'update' : 'insert';
            $rowErrors = $this->validateImportRow($row, $companyId, $existing);
            if ($columnError !== null && ! $repair['fixed']) {
                array_unshift($rowErrors, $this->importIssue('columns', $columnError['message']));
            }

            $generatedPassword = ($row['_import_password_source'] ?? '') === 'generated'
                ? (string) ($row['password'] ?? '')
                : null;
            unset($row['_import_password_source']);

            $planRows[] = [
                'row' => $rowNum,
                'data' => $row,
                'errors' => $rowErrors,
                'warnings' => $rowWarnings,
                'valid' => $rowErrors === [],
                'action' => $action,
                'existing' => $existing,
                'generated_password' => $generatedPassword,
            ];
        }

        $this->flagImportFileDuplicates($planRows);
        $this->appendImportRowWarnings($planRows);
        $summary = $this->recountImportPlanSummary($planRows, $summary);

        if ($summary['total_rows'] === 0 && $fileErrors === []) {
            $fileErrors[] = ['field' => 'file', 'message' => 'No data rows found'];
        }

        return [
            'headers' => $headers,
            'summary' => $summary,
            'rows' => $planRows,
            'file_errors' => $fileErrors,
        ];
    }

    public function exportSpreadsheet(?string $companyId, string $format = 'xlsx'): StreamedResponse
    {
        $this->importCompanyContext = $companyId;
        $rows = $this->listForCompany($companyId);
        $sheet = new Spreadsheet;
        $this->writeMasterExportSheet($sheet, $rows);

        $filename = 'cirt_payroll_master_'.date('Ymd_His').'.'.($format === 'csv' ? 'csv' : 'xlsx');

        return response()->streamDownload(function () use ($sheet, $format) {
            if ($format === 'csv') {
                $writer = new Csv($sheet);
                $writer->setDelimiter(',');
                $writer->save('php://output');
            } else {
                (new Xlsx($sheet))->save('php://output');
            }
        }, $filename, [
            'Content-Type' => $format === 'csv'
                ? 'text/csv'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    public function templateDownload(string $format, ?string $companyId = null): StreamedResponse
    {
        $this->importCompanyContext = $companyId;
        $spreadsheet = new Spreadsheet;
        $this->writeImportTemplateDataSheet($spreadsheet->getActiveSheet());
        if ($format !== 'csv') {
            $instructions = $spreadsheet->createSheet();
            $instructions->setTitle('Instructions');
            $this->writeImportTemplateInstructionsSheet($instructions, $companyId);
        }
        $spreadsheet->setActiveSheetIndex(0);

        $filename = 'cirt_payroll_master_template.'.($format === 'csv' ? 'csv' : 'xlsx');

        return response()->streamDownload(function () use ($spreadsheet, $format) {
            if ($format === 'csv') {
                (new Csv($spreadsheet))->save('php://output');
            } else {
                (new Xlsx($spreadsheet))->save('php://output');
            }
        }, $filename);
    }

    /**
     * Import template column order — display headers in Excel row 1, internal keys for parser.
     *
     * @return list<array{key: string, header: string, required_in_template: bool}>
     */
    private function importTemplateColumns(): array
    {
        $base = [
            ['key' => 'employee_code', 'header' => 'Employee Code*', 'required_in_template' => true],
            ['key' => 'pay_level', 'header' => 'Pay Level*', 'required_in_template' => true],
            ['key' => 'increment_month', 'header' => 'Increment Month*', 'required_in_template' => true],
            ['key' => 'name', 'header' => 'Name*', 'required_in_template' => true],
            ['key' => 'email', 'header' => 'Email*', 'required_in_template' => true],
            ['key' => 'user_role', 'header' => 'User Role', 'required_in_template' => true],
            ['key' => 'password', 'header' => 'Password', 'required_in_template' => true],
            ['key' => 'confirm_password', 'header' => 'Confirm Password', 'required_in_template' => true],
            ['key' => 'phone', 'header' => 'Phone', 'required_in_template' => false],
            ['key' => 'gender', 'header' => 'Gender', 'required_in_template' => false],
            ['key' => 'date_of_birth', 'header' => 'Date of Birth', 'required_in_template' => false],
            ['key' => 'date_of_joining', 'header' => 'Date of Joining', 'required_in_template' => false],
            ['key' => 'designation', 'header' => 'Designation', 'required_in_template' => false],
            ['key' => 'department', 'header' => 'Department', 'required_in_template' => false],
            ['key' => 'division', 'header' => 'Division', 'required_in_template' => false],
            ['key' => 'status', 'header' => 'Status', 'required_in_template' => false],
            ['key' => 'gross_basic_pay', 'header' => 'Gross Basic*', 'required_in_template' => true],
            ['key' => 'da_percent', 'header' => 'DA %', 'required_in_template' => false],
            ['key' => 'hra_percent', 'header' => 'HRA %', 'required_in_template' => false],
            ['key' => 'uan', 'header' => 'UAN', 'required_in_template' => false],
            ['key' => 'cpf_no', 'header' => 'CPF No', 'required_in_template' => false],
            ['key' => 'pan', 'header' => 'PAN*', 'required_in_template' => true],
            ['key' => 'aadhaar', 'header' => 'Aadhaar*', 'required_in_template' => true],
            ['key' => 'bank_name', 'header' => 'Bank Name', 'required_in_template' => false],
            ['key' => 'bank_account_number', 'header' => 'Bank Account Number*', 'required_in_template' => true],
            ['key' => 'bank_ifsc', 'header' => 'IFSC Code', 'required_in_template' => false],
            ['key' => 'professional_tax', 'header' => 'Professional Tax', 'required_in_template' => false],
            ['key' => 'cpf_default', 'header' => 'PF / CPF %', 'required_in_template' => false],
        ];

        if ($this->importCompanyContext) {
            $base = array_merge($base, $this->fieldService->customImportColumns($this->importCompanyContext));
        }

        return $base;
    }

    /** @return list<string> */
    private function importTemplateDisplayHeaders(): array
    {
        return array_map(fn (array $col) => $col['header'], $this->importTemplateColumns());
    }

    /** @return list<string|int|float> */
    private function importTemplateSampleValues(): array
    {
        $sample = [
            'employee_code' => 'EMP001',
            'pay_level' => 8,
            'increment_month' => 'July',
            'name' => 'Test Employee',
            'email' => 'test@example.com',
            'user_role' => 'Employee',
            'password' => 'Welcome@123',
            'confirm_password' => 'Welcome@123',
            'phone' => '9876543210',
            'gender' => 'male',
            'date_of_birth' => '1990-01-01',
            'date_of_joining' => '2026-05-01',
            'designation' => 'Developer',
            'department' => 'IT Department',
            'division' => 'Admin',
            'status' => 'active',
            'gross_basic_pay' => 52000,
            'da_percent' => 60,
            'hra_percent' => 30,
            'uan' => 'UAN123',
            'cpf_no' => 'CPF123',
            'pan' => 'ABCDE1234F',
            'aadhaar' => '123456789012',
            'bank_name' => 'Test Bank',
            'bank_account_number' => '1234567890',
            'bank_ifsc' => 'TEST0001234',
            'professional_tax' => 200,
            'cpf_default' => 0,
        ];

        return array_map(fn (array $col) => $sample[$col['key']] ?? '', $this->importTemplateColumns());
    }

    private function writeImportTemplateDataSheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet): void
    {
        $sheet->setTitle('Payroll Master');
        $sheet->fromArray($this->importTemplateDisplayHeaders(), null, 'A1');
        $sheet->fromArray($this->importTemplateSampleValues(), null, 'A2');
        $lastCol = Coordinate::stringFromColumnIndex(count($this->importTemplateColumns()));
        $sheet->getStyle('A1:'.$lastCol.'1')->getFont()->setBold(true);
    }

    private function writeImportTemplateInstructionsSheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet, ?string $companyId = null): void
    {
        $lines = [
            ['Payroll Master Import — Instructions'],
            [''],
            ['Required columns are marked with * in the Data sheet header row.'],
            ['User Role allowed values: Employee, Admin (blank defaults to Employee).'],
            ['Password: leave blank to auto-generate a temporary password, or set Password and Confirm Password to the same value.'],
            ['PAN format: ABCDE1234F (5 letters + 4 digits + 1 letter).'],
            ['Aadhaar: exactly 12 digits.'],
            ['Status: active or inactive (blank defaults to active).'],
            [''],
            ['Must be unique: Employee Code, Email, Phone, Aadhaar, PAN, Bank Account Number.'],
            [''],
            ['Download a fresh template if you see "Missing required columns: User Role, Password, Confirm Password".'],
        ];

        if ($companyId) {
            $fieldRows = $this->fieldService->templateInstructionFieldRows($companyId);
            if ($fieldRows !== []) {
                $lines[] = [''];
                $lines[] = ['Dynamic payroll fields (configured in Settings → Payroll Fields)'];
                $lines[] = ['Label', 'Key', 'Group', 'Type', 'Required', 'In total earnings', 'In total deductions', 'Allowed values'];
                foreach ($fieldRows as $row) {
                    $lines[] = $row;
                }
            }
        }

        $sheet->fromArray($lines, null, 'A1');
        $sheet->getStyle('A1')->getFont()->setBold(true);
        $sheet->getColumnDimension('A')->setWidth(28);
        $sheet->getColumnDimension('B')->setWidth(22);
        $sheet->getColumnDimension('C')->setWidth(14);
        $sheet->getColumnDimension('D')->setWidth(12);
        $sheet->getColumnDimension('E')->setWidth(10);
        $sheet->getColumnDimension('F')->setWidth(16);
        $sheet->getColumnDimension('G')->setWidth(18);
        $sheet->getColumnDimension('H')->setWidth(36);
    }

    private function importColumnDisplayName(string $key): string
    {
        foreach ($this->importTemplateColumns() as $col) {
            if ($col['key'] === $key) {
                return rtrim($col['header'], '*');
            }
        }

        return str_replace('_', ' ', ucwords($key, '_'));
    }

    /**
     * @param  list<string>  $mappedHeaders
     * @return list<array{field: string, message: string, missing_columns?: list<string>}>
     */
    private function validateImportTemplateStructure(array $mappedHeaders): array
    {
        $missing = [];
        foreach ($this->importTemplateColumns() as $col) {
            if (! $col['required_in_template']) {
                continue;
            }
            if (! in_array($col['key'], $mappedHeaders, true)) {
                $missing[] = rtrim($col['header'], '*');
            }
        }

        if ($missing === []) {
            return [];
        }

        return [[
            'field' => 'template',
            'message' => 'Invalid template. Missing required columns: '.implode(', ', $missing).'. Please download the latest template.',
            'missing_columns' => $missing,
        ]];
    }

    /** @param  list<string>  $mappedHeaders */
    private function headersLookLikePayrollImport(array $mappedHeaders): bool
    {
        return in_array('employee_code', $mappedHeaders, true)
            || in_array('name', $mappedHeaders, true)
            || in_array('email', $mappedHeaders, true);
    }

    private function generateTemporaryImportPassword(): string
    {
        return 'Welcome@'.random_int(1000, 9999);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return list<array{field: string, message: string, type?: string}>
     */
    private function applyImportRowDefaults(array &$row): array
    {
        $warnings = [];

        $rawRole = trim((string) ($row['user_role'] ?? ''));
        if ($rawRole === '') {
            $row['user_role'] = 'employee';
        } else {
            $normalizedRole = $this->normalizeImportUserRole($rawRole);
            if ($normalizedRole !== null) {
                $row['user_role'] = $normalizedRole;
            }
        }

        $status = mb_strtolower(trim((string) ($row['status'] ?? '')));
        $row['status'] = $status !== '' ? $status : 'active';

        if (empty($row['effective_from'])) {
            $row['effective_from'] = now()->toDateString();
        }

        $ptRaw = trim((string) ($row['professional_tax'] ?? ''));
        if ($ptRaw === '') {
            $row['professional_tax'] = 200;
        }

        $password = trim((string) ($row['password'] ?? ''));
        if ($password === '') {
            $generated = $this->generateTemporaryImportPassword();
            $row['password'] = $generated;
            $row['confirm_password'] = $generated;
            $row['_import_password_source'] = 'generated';
            $warnings[] = $this->importIssue(
                'password',
                'Temporary password was auto-generated for this row.',
                'warning',
            );
        } else {
            $row['_import_password_source'] = 'provided';
        }

        return $warnings;
    }

    private function normalizeImportUserRole(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return 'employee';
        }
        $lower = mb_strtolower($raw);
        if ($lower === 'employee') {
            return 'employee';
        }
        if ($lower === 'admin') {
            return 'admin';
        }

        return null;
    }

    public function deactivate(HrmsPayrollMaster $master): HrmsPayrollMaster
    {
        $master->update([
            'status' => 'inactive',
            'updated_at' => now(),
        ]);

        return $master->refresh();
    }

    /** @return list<string> */
    private function templatePreDeductionHeaders(): array
    {
        return [
            'employee_code', 'name', 'email', 'user_role', 'password', 'confirm_password',
            'phone', 'gender', 'date_of_birth', 'date_of_joining',
            'designation', 'department', 'division', 'pay_level', 'increment_month', 'gross_basic_pay', 'da_percent', 'hra_percent', 'medical',
            'uan', 'cpf_no', 'pan', 'aadhaar', 'bank_name', 'bank_account_number', 'bank_ifsc',
            'status', 'remarks', 'effective_from',
        ];
    }

    /** @return list<string> */
    private function templateDefaultDeductionHeaders(): array
    {
        return ['cpf_default', 'professional_tax'];
    }

    /** @return list<string> */
    private function templateVariableDeductionHeaders(): array
    {
        return [
            'income_tax', 'lic', 'mess', 'welfare', 'vpf', 'pf_loan', 'post_office',
            'credit_society', 'standard_licence_fee', 'electricity', 'water', 'loan_recovery', 'vehicle_charge',
            'other_deduction', 'advance',
        ];
    }

    /** @return list<string> */
    private function templateHeaders(): array
    {
        return array_merge(
            $this->templatePreDeductionHeaders(),
            $this->templateDefaultDeductionHeaders(),
            $this->templateVariableDeductionHeaders(),
        );
    }

    /** @return list<string> */
    private function templateGroupHeaderRow(): array
    {
        $pre = $this->templatePreDeductionHeaders();
        $default = $this->templateDefaultDeductionHeaders();
        $variable = $this->templateVariableDeductionHeaders();

        $row = array_fill(0, count($pre), '');
        $row = array_merge($row, ['Default deductions'], array_fill(0, count($default) - 1, ''));
        $row = array_merge($row, ['Variable deductions'], array_fill(0, count($variable) - 1, ''));

        return $row;
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function writeSpreadsheetWithGroupedHeaders(Spreadsheet $sheet, array $rows, bool $includeInstructions = false): void
    {
        $activeSheet = $sheet->getActiveSheet();
        $activeSheet->fromArray($this->templateGroupHeaderRow(), null, 'A1');
        $activeSheet->fromArray($this->templateHeaders(), null, 'A2');
        $dataRowStart = 3;
        if ($includeInstructions) {
            $activeSheet->fromArray($this->templateInstructionRow(), null, 'A3');
            $this->applyTemplateInstructionMerge($activeSheet);
            $dataRowStart = 4;
        }
        $i = $dataRowStart;
        foreach ($rows as $r) {
            $activeSheet->fromArray($this->rowToExport($r), null, 'A'.$i);
            $i++;
        }
        $this->applyTemplateGroupHeaderMerges($activeSheet);
    }

    private function applyTemplateInstructionMerge(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet): void
    {
        $lastCol = Coordinate::stringFromColumnIndex(count($this->templateHeaders()));
        $sheet->mergeCells('A3:'.$lastCol.'3');
        $sheet->getStyle('A3')->getAlignment()->setWrapText(true);
    }

    /** @return list<string> */
    private function templateInstructionRow(): array
    {
        $cols = count($this->templateHeaders());
        $row = array_fill(0, $cols, '');
        $row[0] = 'Required: employee_code, name, email, user_role, password (new login), pay_level, designation, status, pan, aadhaar, bank_name, bank_account_number, bank_ifsc, gross_basic_pay, effective_from. '
            .'Unique: employee_code, email, phone, aadhaar, pan, bank_account_number.';

        return $row;
    }

    private function applyTemplateGroupHeaderMerges(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet): void
    {
        $preCount = count($this->templatePreDeductionHeaders());
        $defaultCount = count($this->templateDefaultDeductionHeaders());
        $variableCount = count($this->templateVariableDeductionHeaders());

        $defaultStart = $preCount + 1;
        $defaultEnd = $preCount + $defaultCount;
        $variableStart = $defaultEnd + 1;
        $variableEnd = $defaultEnd + $variableCount;

        if ($defaultCount > 1) {
            $sheet->mergeCells(
                Coordinate::stringFromColumnIndex($defaultStart).'1:'.Coordinate::stringFromColumnIndex($defaultEnd).'1'
            );
        }
        if ($variableCount > 1) {
            $sheet->mergeCells(
                Coordinate::stringFromColumnIndex($variableStart).'1:'.Coordinate::stringFromColumnIndex($variableEnd).'1'
            );
        }
    }

    /** @return array<string, mixed> */
    private function sampleTemplateRowAsRecord(): array
    {
        $record = [];
        foreach ($this->sampleTemplateRow() as $i => $value) {
            $record[$this->templateHeaders()[$i]] = $value;
        }

        return $record;
    }

    /** @return list<string|int|float> */
    private function sampleTemplateRow(): array
    {
        $byHeader = [
            'employee_code' => 'EMP001',
            'name' => 'Test Employee',
            'email' => 'test@example.com',
            'user_role' => 'employee',
            'password' => 'ChangeMe1!',
            'confirm_password' => 'ChangeMe1!',
            'phone' => '9876543210',
            'gender' => 'male',
            'date_of_birth' => '1990-01-01',
            'date_of_joining' => '2026-05-01',
            'designation' => 'Developer',
            'department' => 'IT Department',
            'division' => 'Admin',
            'pay_level' => 8,
            'gross_basic_pay' => 52000,
            'da_percent' => 60,
            'hra_percent' => 30,
            'medical' => 3000,
            'uan' => 'UAN123',
            'cpf_no' => 'CPF123',
            'pan' => 'ABCDE1234F',
            'aadhaar' => '123456789012',
            'bank_name' => 'Test Bank',
            'bank_account_number' => '1234567890',
            'bank_ifsc' => 'TEST0001234',
            'status' => 'active',
            'remarks' => 'Imported from template',
            'effective_from' => '2026-06-01',
            'cpf_default' => 0,
            'professional_tax' => 200,
            'income_tax' => 0,
            'lic' => 0,
            'mess' => 0,
            'welfare' => 80,
            'vpf' => 0,
            'pf_loan' => 0,
            'post_office' => 0,
            'credit_society' => 0,
            'standard_licence_fee' => 0,
            'electricity' => 0,
            'water' => 0,
            'loan_recovery' => 0,
            'vehicle_charge' => 0,
            'other_deduction' => 0,
            'advance' => 0,
        ];

        return array_map(fn (string $h) => $byHeader[$h] ?? '', $this->templateHeaders());
    }

    /** @param  array<string, mixed>  $r */
    private function rowToExport(array $r): array
    {
        $customValues = is_array($r['customFieldValues'] ?? null) ? $r['customFieldValues'] : [];

        return array_map(function (array $col) use ($r, $customValues) {
            $key = $col['key'];
            if (array_key_exists($key, $customValues)) {
                return $customValues[$key];
            }

            return $r[$key] ?? $r[Str::camel($key)] ?? '';
        }, $this->masterExportColumnDefs());
    }

    /** @return list<array{key: string, header: string}> */
    private function masterExportColumnDefs(): array
    {
        $defs = [];
        $seen = [];
        foreach ($this->templateHeaders() as $key) {
            $defs[] = ['key' => $key, 'header' => $this->importColumnDisplayName($key)];
            $seen[$key] = true;
        }
        if ($this->importCompanyContext) {
            foreach ($this->fieldService->customImportColumns($this->importCompanyContext) as $col) {
                if (isset($seen[$col['key']])) {
                    continue;
                }
                $defs[] = ['key' => $col['key'], 'header' => rtrim($col['header'], '*')];
                $seen[$col['key']] = true;
            }
        }

        return $defs;
    }

    /** @return list<string> */
    private function exportDisplayHeaders(): array
    {
        return array_map(fn (array $col) => $col['header'], $this->masterExportColumnDefs());
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function writeMasterExportSheet(Spreadsheet $sheet, array $rows): void
    {
        $activeSheet = $sheet->getActiveSheet();
        $activeSheet->setTitle('Payroll Master');
        $headers = $this->exportDisplayHeaders();
        $activeSheet->fromArray($headers, null, 'A1');
        $lastCol = Coordinate::stringFromColumnIndex(max(1, count($headers)));
        $activeSheet->getStyle('A1:'.$lastCol.'1')->getFont()->setBold(true);
        $i = 2;
        foreach ($rows as $r) {
            $activeSheet->fromArray($this->rowToExport($r), null, 'A'.$i);
            $i++;
        }
    }

    private function resolveTakeHome(HrmsPayrollMaster $m): float
    {
        if ($m->take_home !== null && $m->take_home !== '') {
            return (float) $m->take_home;
        }

        $defaults = $this->resolveCompanyPayrollDefaults($m->company_id);
        $calc = $this->calculateMasterForCompany(
            (string) $m->company_id,
            $this->masterToCalcInput($m),
            $defaults['da'],
            $defaults['hra'],
            $m->id,
        );

        return (float) $calc['take_home'];
    }

    /** @return array{da: float, hra: float} */
    private function resolveCompanyPayrollDefaults(?string $companyId): array
    {
        if (! $companyId) {
            return [
                'da' => PayrollCalculationService::DEFAULT_DA_PERCENT,
                'hra' => PayrollCalculationService::DEFAULT_HRA_PERCENT,
            ];
        }

        static $cache = [];
        if (! array_key_exists($companyId, $cache)) {
            $company = HrmsCompany::find($companyId);
            $cache[$companyId] = [
                'da' => (float) ($company?->default_da_percent ?? PayrollCalculationService::DEFAULT_DA_PERCENT),
                'hra' => (float) ($company?->default_hra_percent ?? PayrollCalculationService::DEFAULT_HRA_PERCENT),
            ];
        }

        return $cache[$companyId];
    }

    /** @return array{0: ?float, 1: ?float} */
    private function resolveCalcDefaults(?string $companyId, array $payload): array
    {
        $defaults = $this->resolveCompanyPayrollDefaults($companyId);
        $defaultDa = $this->payloadMissingPercent($payload, 'da_percent', 'daPercent') ? $defaults['da'] : null;
        $defaultHra = $this->payloadMissingPercent($payload, 'hra_percent', 'hraPercent') ? $defaults['hra'] : null;

        return [$defaultDa, $defaultHra];
    }

    private function formatPercentField(mixed $value, float $fallback): float
    {
        if ($value !== null && $value !== '') {
            return (float) $value;
        }

        return $fallback;
    }

    private function roundDaAmount(HrmsPayrollMaster $m): float
    {
        $basic = (float) ($m->gross_basic_pay ?? $m->gross_basic ?? $m->gross_salary ?? 0);
        $percent = (float) ($m->da_percent ?? PayrollCalculationService::DEFAULT_DA_PERCENT);

        return round($basic * $percent / 100);
    }

    private function roundHraAmount(HrmsPayrollMaster $m): float
    {
        $basic = (float) ($m->gross_basic_pay ?? $m->gross_basic ?? $m->gross_salary ?? 0);
        $percent = (float) ($m->hra_percent ?? PayrollCalculationService::DEFAULT_HRA_PERCENT);

        return round($basic * $percent / 100);
    }

    /** @param  array<string, mixed>  $payload */
    private function mergeExistingMasterDefaults(HrmsPayrollMaster $master, array $payload): array
    {
        if ($this->payloadMissingPercent($payload, 'da_percent', 'daPercent') && $master->da_percent !== null && $master->da_percent !== '') {
            $payload['da_percent'] = $master->da_percent;
        }
        if ($this->payloadMissingPercent($payload, 'hra_percent', 'hraPercent') && $master->hra_percent !== null && $master->hra_percent !== '') {
            $payload['hra_percent'] = $master->hra_percent;
        }

        return $payload;
    }

    /** @param  array<string, mixed>  $payload */
    private function payloadMissingPercent(array $payload, string $snakeKey, string $camelKey): bool
    {
        foreach ([$snakeKey, $camelKey] as $key) {
            if (! array_key_exists($key, $payload)) {
                continue;
            }
            $value = $payload[$key];
            if ($value !== null && $value !== '') {
                return false;
            }
        }

        return true;
    }

    /** @return array<string, mixed> */
    public function formatRow(HrmsPayrollMaster $m, ?string $rowType = null): array
    {
        $userId = $m->user_id ?? $m->employee_user_id;
        $userRole = UserRole::Employee->value;
        if ($userId) {
            $user = HrmsUser::find($userId);
            if ($user) {
                $role = $user->role;
                $userRole = $role instanceof UserRole
                    ? $role->value
                    : UserRole::fromStored(is_string($role) ? $role : null)->value;
            }
        }

        return [
            'id' => $m->id,
            'companyId' => $m->company_id,
            'employeeId' => $m->employee_id,
            'userId' => $userId,
            'employeeUserId' => $userId,
            'userRole' => $userRole,
            'employeeCode' => $m->employee_code,
            'name' => $m->name ?: ($userId ? 'Employee ID: '.$userId : '—'),
            'email' => $m->email,
            'phone' => $m->phone,
            'gender' => $m->gender,
            'designation' => $m->designation,
            'department' => $m->department,
            'division' => $m->division,
            'payLevel' => $m->pay_level ?? $m->getAttributes()['pay_level'] ?? null,
            'incrementMonth' => $m->increment_month ?? IncrementMonth::DEFAULT,
            'customFieldValues' => $m->company_id
                ? $this->fieldService->getCustomFieldValuesForMaster((string) $m->company_id, $m->id)
                : [],
            'grossBasicPay' => (float) ($m->gross_basic_pay ?? $m->gross_basic ?? $m->gross_salary ?? 0),
            'daPercent' => $this->formatPercentField($m->da_percent, PayrollCalculationService::DEFAULT_DA_PERCENT),
            'daAmount' => (float) ($m->da_amount ?? $this->roundDaAmount($m)),
            'hraPercent' => $this->formatPercentField($m->hra_percent, PayrollCalculationService::DEFAULT_HRA_PERCENT),
            'hraAmount' => (float) ($m->hra ?? $this->roundHraAmount($m)),
            'medical' => (float) ($m->medical ?? $m->medical_fixed ?? PayrollCalculationService::DEFAULT_MEDICAL),
            'transportBase' => (float) ($m->transport_base ?? 0),
            'transportDa' => (float) ($m->transport_da ?? 0),
            'transportTotal' => (float) ($m->transport_total ?? $m->trans ?? 0),
            'totalEarnings' => (float) ($m->total_earnings ?? $m->ctc ?? 0),
            'cpfDefault' => (float) ($m->cpf_default ?? 0),
            'cpfEffective' => (float) ($m->cpf_effective ?? 0),
            'cpfUseCompanySettings' => (bool) ($m->cpf_use_company_settings ?? true),
            'cpfPercentageOverride' => $m->cpf_percentage_override !== null
                ? (float) $m->cpf_percentage_override
                : null,
            'cpfBasisFieldKeysOverride' => $m->cpf_basis_field_keys_override ?? [],
            'cpfSettings' => $m->company_id
                ? $this->fieldService->formatMasterCpfSettings((string) $m->company_id, $m)
                : null,
            'daCpf' => (float) ($m->da_cpf ?? $m->da_cpf_default ?? 0),
            'professionalTax' => (float) ($m->professional_tax ?? $m->pt_default ?? $m->pt ?? 0),
            'incomeTax' => (float) ($m->income_tax ?? $m->income_tax_default ?? $m->tds ?? 0),
            'lic' => (float) ($m->lic ?? $m->lic_default ?? 0),
            'mess' => (float) ($m->mess ?? $m->mess_default ?? 0),
            'welfare' => (float) ($m->welfare ?? $m->welfare_default ?? 0),
            'vpf' => (float) ($m->vpf ?? $m->vpf_default ?? 0),
            'pfLoan' => (float) ($m->pf_loan ?? $m->pf_loan_default ?? 0),
            'postOffice' => (float) ($m->post_office ?? $m->post_office_default ?? 0),
            'creditSociety' => (float) ($m->credit_society ?? $m->credit_society_default ?? 0),
            'standardLicenceFee' => (float) ($m->standard_licence_fee ?? $m->std_licence_fee_default ?? 0),
            'electricity' => (float) ($m->electricity ?? $m->electricity_default ?? 0),
            'water' => (float) ($m->water ?? $m->water_default ?? 0),
            'loanRecovery' => (float) ($m->loan_recovery ?? $m->loan_recovery_default ?? 0),
            'vehicleCharge' => (float) ($m->vehicle_charge ?? $m->veh_charge_default ?? 0),
            'otherDeduction' => (float) ($m->other_deduction ?? $m->other_deduction_default ?? 0),
            'advance' => (float) ($m->advance ?? $m->advance_bonus ?? 0),
            'takeHome' => $this->resolveTakeHome($m),
            'uan' => $m->uan,
            'cpfNo' => $m->cpf_no,
            'pan' => $m->pan,
            'aadhaar' => $m->aadhaar,
            'bankName' => $m->bank_name,
            'bankAccountNumber' => $m->bank_account_number,
            'bankIfsc' => $m->bank_ifsc,
            'dateOfJoining' => $m->date_of_joining?->toDateString() ?? null,
            'dateOfBirth' => $m->date_of_birth?->toDateString() ?? null,
            'status' => $m->status ?? 'active',
            'remarks' => $m->remarks,
            'effectiveFrom' => $m->effective_from?->toDateString() ?? $m->effective_start_date?->toDateString(),
            'effectiveTo' => $m->effective_to?->toDateString() ?? $m->effective_end_date?->toDateString(),
            'reasonForChange' => $m->reason_for_change,
            'isCurrent' => $this->isCurrentMaster($m),
            'rowType' => $rowType ?? ($this->isCurrentMaster($m) ? 'CURRENT' : 'HISTORY'),
            'archivedAt' => null,
            'updatedAt' => $m->updated_at?->toIso8601String(),
            'payrollMode' => $m->payroll_mode ?? 'government',
        ];
    }

    /** @return array<string, mixed> */
    public function formatHistoryRow(HrmsPayrollMasterHistory $h): array
    {
        $row = [
            'id' => (string) $h->history_id,
            'historyId' => (string) $h->history_id,
            'originalMasterId' => $h->original_master_id,
            'employeeUserId' => $h->employee_user_id ?? $h->user_id,
            'employeeCode' => $h->employee_code,
            'name' => $h->name,
            'email' => $h->email,
            'payLevel' => $h->pay_level,
            'grossBasicPay' => (float) ($h->gross_basic_pay ?? $h->gross_basic ?? $h->gross_salary ?? 0),
            'daPercent' => (float) ($h->da_percent ?? PayrollCalculationService::DEFAULT_DA_PERCENT),
            'hraPercent' => (float) ($h->hra_percent ?? PayrollCalculationService::DEFAULT_HRA_PERCENT),
            'takeHome' => (float) ($h->take_home ?? 0),
            'effectiveFrom' => $h->effective_from?->toDateString() ?? $h->effective_start_date?->toDateString(),
            'effectiveTo' => $h->effective_to?->toDateString() ?? $h->effective_end_date?->toDateString(),
            'reasonForChange' => $h->archive_reason ?? $h->reason_for_change,
            'isCurrent' => false,
            'rowType' => $h->is_superseded ? 'SUPERSEDED' : 'HISTORY',
            'archiveAction' => $h->archive_action,
            'archivedAt' => $h->archived_at?->toIso8601String(),
            'updatedAt' => $h->updated_at?->toIso8601String(),
            'payrollMode' => $h->payroll_mode ?? 'government',
        ];

        return $row;
    }

    public function getPayrollMasterForDate(string $companyId, string $employeeUserId, string $payrollDate): ?HrmsPayrollMaster
    {
        $current = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->where(function ($q) use ($employeeUserId) {
                $q->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId);
            })
            ->where(function ($q) use ($payrollDate) {
                $q->whereDate('effective_from', '<=', $payrollDate)
                    ->orWhere(function ($q2) use ($payrollDate) {
                        $q2->whereNull('effective_from')->whereDate('effective_start_date', '<=', $payrollDate);
                    });
            })
            ->whereNull('effective_to')
            ->orderByDesc('effective_from')
            ->orderByDesc('effective_start_date')
            ->get();

        if ($current->count() > 1) {
            Log::warning('Multiple current payroll masters for employee on date lookup', [
                'company_id' => $companyId,
                'employee_user_id' => $employeeUserId,
                'payroll_date' => $payrollDate,
            ]);
        }
        if ($current->isNotEmpty()) {
            return $current->first();
        }

        if (! Schema::hasTable('cirt_payroll_master_history')) {
            return null;
        }

        $historyRows = HrmsPayrollMasterHistory::query()
            ->where('company_id', $companyId)
            ->where('is_superseded', false)
            ->where(function ($q) use ($employeeUserId) {
                $q->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId);
            })
            ->where(function ($q) use ($payrollDate) {
                $q->whereDate('effective_from', '<=', $payrollDate)
                    ->orWhere(function ($q2) use ($payrollDate) {
                        $q2->whereNull('effective_from')->whereDate('effective_start_date', '<=', $payrollDate);
                    });
            })
            ->where(function ($q) use ($payrollDate) {
                $q->whereNull('effective_to')
                    ->orWhereNull('effective_end_date')
                    ->orWhereDate('effective_to', '>=', $payrollDate)
                    ->orWhereDate('effective_end_date', '>=', $payrollDate);
            })
            ->orderByDesc('effective_from')
            ->orderByDesc('effective_start_date')
            ->orderByDesc('archived_at')
            ->get();

        if ($historyRows->count() > 1) {
            Log::warning('Multiple payroll master history rows matched for date', [
                'company_id' => $companyId,
                'employee_user_id' => $employeeUserId,
                'payroll_date' => $payrollDate,
            ]);
        }

        $history = $historyRows->first();

        return $history ? $this->historyToMasterModel($history) : null;
    }

    public function historyToMasterModel(HrmsPayrollMasterHistory $history): HrmsPayrollMaster
    {
        $master = new HrmsPayrollMaster;
        $attrs = $history->getAttributes();
        unset($attrs['history_id'], $attrs['original_master_id'], $attrs['archive_action'], $attrs['archive_reason'],
            $attrs['is_superseded'], $attrs['archived_at'], $attrs['archived_by'], $attrs['replaced_by_master_id']);
        $attrs['id'] = $history->original_master_id ?? $history->history_id;
        $master->forceFill($attrs);
        $master->exists = false;

        return $master;
    }

    public function findMasterOrHistoryById(string $id): ?HrmsPayrollMaster
    {
        $current = HrmsPayrollMaster::find($id);
        if ($current) {
            return $current;
        }

        if (! Schema::hasTable('cirt_payroll_master_history')) {
            return null;
        }

        $history = HrmsPayrollMasterHistory::query()
            ->where('history_id', $id)
            ->orWhere('original_master_id', $id)
            ->orderByDesc('archived_at')
            ->first();

        return $history ? $this->historyToMasterModel($history) : null;
    }

    public function reviseMasterRecord(
        HrmsPayrollMaster $master,
        array $validated,
        string $companyId,
        ?string $createdBy,
        ?string $reason = null,
    ): HrmsPayrollMaster {
        if ($master->company_id && $master->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        $effectiveFrom = $validated['effective_from'] ?? $validated['effectiveFrom'] ?? now()->toDateString();
        $oldEffectiveFrom = ($master->effective_from ?? $master->effective_start_date)?->toDateString() ?? $effectiveFrom;
        $newFrom = Carbon::parse($effectiveFrom);
        $oldFrom = Carbon::parse($oldEffectiveFrom);
        $isSuperseded = $newFrom->lte($oldFrom);
        $effectiveTo = $isSuperseded
            ? ($master->effective_to?->toDateString() ?? $master->effective_end_date?->toDateString())
            : $newFrom->copy()->subDay()->toDateString();

        $revisionReason = $reason
            ?? $validated['reason_for_change']
            ?? $validated['reasonForChange']
            ?? 'Payroll master revision';

        $payload = $this->masterToRevisionPayload($master, $validated);
        $payload['effective_from'] = $effectiveFrom;
        $payload['effectiveFrom'] = $effectiveFrom;
        $payload['reason_for_change'] = $revisionReason;
        unset($payload['effective_to'], $payload['effectiveTo'], $payload['effective_end_date'], $payload['effectiveEndDate']);

        $historyRow = null;
        if (Schema::hasTable('cirt_payroll_master_history')) {
            $historyRow = $this->archiveMasterToHistory(
                $master,
                'REVISION',
                $revisionReason,
                $isSuperseded,
                $createdBy,
                null,
                $effectiveTo,
            );
        }

        // Soft-close the superseded row so cirt_monthly_payroll FK references remain valid.
        $supersededMasterId = $master->id;
        $master->update([
            'effective_to' => $effectiveTo,
            'effective_end_date' => $effectiveTo,
            'updated_at' => now(),
        ]);

        $validatedInner = $this->validatePayload($payload, $supersededMasterId, $companyId, false, true);
        $validatedInner['user_id'] = $payload['user_id'] ?? $payload['employee_user_id'] ?? null;
        $validatedInner['employee_user_id'] = $payload['employee_user_id'] ?? $payload['user_id'] ?? null;
        $defaults = $this->resolveCompanyPayrollDefaults($companyId);
        [$defaultDa, $defaultHra] = $this->resolveCalcDefaults($companyId, $validatedInner);
        $calc = $this->calculateMasterForCompany($companyId, $validatedInner, $defaultDa, $defaultHra, $supersededMasterId);
        $attrs = $this->filterExistingColumns($this->mergeCalculated($validatedInner, $calc, $companyId, $createdBy, true));

        $newMaster = HrmsPayrollMaster::create($attrs);

        if ($historyRow !== null) {
            $historyRow->update(['replaced_by_master_id' => $newMaster->id]);
        }

        return $newMaster;
    }

    public function archiveMasterToHistory(
        HrmsPayrollMaster $master,
        string $archiveAction,
        ?string $archiveReason,
        bool $isSuperseded,
        ?string $archivedBy,
        ?string $replacedByMasterId,
        ?string $effectiveToOverride = null,
    ): HrmsPayrollMasterHistory {
        $attrs = $master->getAttributes();
        $originalId = $attrs['id'];
        unset($attrs['id']);

        $effectiveFrom = $attrs['effective_from'] ?? $attrs['effective_start_date'] ?? now()->toDateString();
        $effectiveTo = $effectiveToOverride;
        if ($effectiveTo === null && ! $isSuperseded) {
            $effectiveTo = $attrs['effective_to'] ?? $attrs['effective_end_date'] ?? null;
        }

        $attrs['history_id'] = (string) Str::uuid();
        $attrs['original_master_id'] = $originalId;
        $attrs['effective_from'] = $effectiveFrom;
        $attrs['effective_start_date'] = $effectiveFrom;
        $attrs['effective_to'] = $effectiveTo;
        $attrs['effective_end_date'] = $effectiveTo;
        $attrs['archive_action'] = $archiveAction;
        $attrs['archive_reason'] = $archiveReason ?? ($attrs['reason_for_change'] ?? null);
        $attrs['is_superseded'] = $isSuperseded;
        $attrs['archived_at'] = now();
        $attrs['archived_by'] = $archivedBy;
        $attrs['replaced_by_master_id'] = $replacedByMasterId;
        $attrs['updated_at'] = now();

        $filtered = $this->filterExistingHistoryColumns($attrs);

        return HrmsPayrollMasterHistory::create($filtered);
    }

    /** @param  array<string, mixed>  $attrs */
    private function filterExistingHistoryColumns(array $attrs): array
    {
        if (! Schema::hasTable('cirt_payroll_master_history')) {
            return $attrs;
        }
        $columns = Schema::getColumnListing('cirt_payroll_master_history');

        return array_intersect_key($attrs, array_flip($columns));
    }

    /** @param  array<string, mixed>  $validated */
    private function salaryStructureChanged(HrmsPayrollMaster $master, array $validated): bool
    {
        $newDa = $this->pickPercent($validated, 'da_percent', 'daPercent', $master->da_percent);
        $newHra = $this->pickPercent($validated, 'hra_percent', 'hraPercent', $master->hra_percent);
        $oldDa = (float) ($master->da_percent ?? 0);
        $oldHra = (float) ($master->hra_percent ?? 0);
        if (abs($newDa - $oldDa) >= 0.001 || abs($newHra - $oldHra) >= 0.001) {
            return true;
        }

        $newGross = (float) ($validated['gross_basic_pay'] ?? $validated['grossBasicPay'] ?? $master->gross_basic_pay ?? 0);
        $oldGross = (float) ($master->gross_basic_pay ?? $master->gross_basic ?? $master->gross_salary ?? 0);
        if (abs($newGross - $oldGross) >= 0.01) {
            return true;
        }

        $deductionKeys = [
            'income_tax', 'professional_tax', 'lic', 'mess', 'welfare', 'vpf', 'pf_loan',
            'post_office', 'credit_society', 'standard_licence_fee', 'electricity', 'water',
            'loan_recovery', 'vehicle_charge', 'other_deduction', 'advance',
        ];
        foreach ($deductionKeys as $key) {
            $camel = Str::camel($key);
            if (! array_key_exists($key, $validated) && ! array_key_exists($camel, $validated)) {
                continue;
            }
            $newVal = (float) ($validated[$key] ?? $validated[$camel] ?? $master->{$key} ?? 0);
            $oldVal = (float) ($master->{$key} ?? 0);
            if (abs($newVal - $oldVal) >= 0.01) {
                return true;
            }
        }

        return false;
    }

    private function requireRevisionReason(?string $reason, bool $required): void
    {
        if ($required && (! is_string($reason) || trim($reason) === '')) {
            abort(422, 'Reason for change is required when revising payroll master (DA/HRA/basic/deductions).');
        }
    }

    /** @param  array<string, mixed>  $overrides */
    private function masterToRevisionPayload(HrmsPayrollMaster $master, array $overrides = []): array
    {
        $userId = $master->user_id ?? $master->employee_user_id;

        return array_merge([
            'employee_id' => $master->employee_id,
            'user_id' => $userId,
            'employee_user_id' => $userId,
            'employee_code' => $master->employee_code,
            'name' => $master->name,
            'email' => $master->email,
            'phone' => $master->phone,
            'gender' => $master->gender,
            'designation' => $master->designation,
            'department' => $master->department,
            'division' => $master->division,
            'pay_level' => $master->pay_level,
            'increment_month' => $master->increment_month ?? IncrementMonth::DEFAULT,
            'gross_basic_pay' => $master->gross_basic_pay ?? $master->gross_basic ?? $master->gross_salary,
            'da_percent' => $master->da_percent,
            'hra_percent' => $master->hra_percent,
            'medical' => $master->medical ?? $master->medical_fixed,
            'transport_da_percent' => $master->transport_da_percent,
            'cpf_default' => $master->cpf_default,
            'da_cpf' => $master->da_cpf ?? $master->da_cpf_default,
            'professional_tax' => $master->professional_tax ?? $master->pt_default ?? $master->pt,
            'income_tax' => $master->income_tax ?? $master->income_tax_default ?? $master->tds,
            'lic' => $master->lic ?? $master->lic_default,
            'mess' => $master->mess ?? $master->mess_default,
            'welfare' => $master->welfare ?? $master->welfare_default,
            'vpf' => $master->vpf ?? $master->vpf_default,
            'pf_loan' => $master->pf_loan ?? $master->pf_loan_default,
            'post_office' => $master->post_office ?? $master->post_office_default,
            'credit_society' => $master->credit_society ?? $master->credit_society_default,
            'standard_licence_fee' => $master->standard_licence_fee ?? $master->std_licence_fee_default,
            'electricity' => $master->electricity ?? $master->electricity_default,
            'water' => $master->water ?? $master->water_default,
            'loan_recovery' => $master->loan_recovery ?? $master->loan_recovery_default,
            'vehicle_charge' => $master->vehicle_charge ?? $master->veh_charge_default,
            'other_deduction' => $master->other_deduction ?? $master->other_deduction_default,
            'advance' => $master->advance ?? $master->advance_bonus,
            'uan' => $master->uan,
            'cpf_no' => $master->cpf_no,
            'pan' => $master->pan,
            'aadhaar' => $master->aadhaar,
            'bank_name' => $master->bank_name,
            'bank_account_number' => $master->bank_account_number,
            'bank_ifsc' => $master->bank_ifsc,
            'date_of_joining' => $master->date_of_joining?->toDateString(),
            'date_of_birth' => $master->date_of_birth?->toDateString(),
            'status' => $master->status ?? 'active',
            'remarks' => $master->remarks,
        ], $overrides);
    }

    private function isCurrentMaster(HrmsPayrollMaster $master): bool
    {
        // cirt_payroll_master stores current rows only; effective_end_date may be legacy.
        return $master->effective_to === null;
    }

    /** @param  \Illuminate\Database\Eloquent\Builder<HrmsPayrollMaster>  $query */
    private function scopeCurrentMaster($query)
    {
        // Current master table — no history rows. Only exclude if effective_to is explicitly closed.
        return $query->whereNull('effective_to');
    }

    /** @param  array<string, mixed>  $payload */
    private function pickPercent(array $payload, string $snakeKey, string $camelKey, mixed $fallback): float
    {
        foreach ([$snakeKey, $camelKey] as $key) {
            if (! array_key_exists($key, $payload)) {
                continue;
            }
            $value = $payload[$key];
            if ($value !== null && $value !== '') {
                return (float) $value;
            }
        }

        return (float) $fallback;
    }

    /** @param  array<string, mixed>  $payload */
    private function validatePayload(array $payload, ?string $ignoreId, ?string $companyId, bool $salaryPending = false, bool $isRevision = false): array
    {
        if (empty($payload['name'])) {
            abort(422, 'Name is required');
        }
        if (empty($payload['pay_level']) && empty($payload['payLevel'])) {
            abort(422, 'Pay level is required');
        }
        $gross = (float) ($payload['gross_basic_pay'] ?? $payload['grossBasicPay'] ?? 0);
        if (! $salaryPending && $gross <= 0) {
            abort(422, 'Gross basic pay must be greater than 0');
        }
        if (! $salaryPending && ! $isRevision && empty($payload['designation'])) {
            abort(422, 'Designation is required');
        }
        $incrementMonth = IncrementMonth::normalize(
            (string) ($payload['increment_month'] ?? $payload['incrementMonth'] ?? ''),
        );
        if (! $salaryPending && ! $isRevision && $incrementMonth === null) {
            abort(422, 'Increment Month is required.');
        }
        if ($incrementMonth !== null) {
            $payload['increment_month'] = $incrementMonth;
            $payload['incrementMonth'] = $incrementMonth;
        } elseif ($isRevision) {
            $payload['increment_month'] = IncrementMonth::DEFAULT;
            $payload['incrementMonth'] = IncrementMonth::DEFAULT;
        }
        if (! $salaryPending && ! $isRevision && empty($payload['email'])) {
            abort(422, 'Email is required');
        }

        $ignoreUserId = null;
        if ($ignoreId) {
            $existing = HrmsPayrollMaster::find($ignoreId);
            $ignoreUserId = $existing?->user_id ?? $existing?->employee_user_id;
        }

        $code = $payload['employee_code'] ?? $payload['employeeCode'] ?? null;
        if ($code) {
            $q = HrmsPayrollMaster::whereRaw('LOWER(TRIM(employee_code)) = ?', [mb_strtolower(trim((string) $code))]);
            if ($companyId) {
                $q->where('company_id', $companyId);
            }
            if ($ignoreId) {
                $q->where('id', '!=', $ignoreId);
            }
            $this->scopeCurrentMaster($q);
            if ($q->exists()) {
                abort(422, 'Employee Code already exists.');
            }
            if ($companyId) {
                $uq = HrmsUser::query()
                    ->where('company_id', $companyId)
                    ->whereRaw('LOWER(TRIM(employee_code)) = ?', [mb_strtolower(trim((string) $code))]);
                if ($ignoreUserId) {
                    $uq->where('id', '!=', $ignoreUserId);
                }
                if ($uq->exists()) {
                    abort(422, 'Employee Code already exists.');
                }
            }
        }

        foreach ($this->validatePayloadUniquenessErrors($payload, $ignoreId, $companyId, $ignoreUserId, $salaryPending, $isRevision) as $err) {
            abort(422, $err['message']);
        }

        foreach (['cpf_no' => 'cpfNo', 'uan' => 'uan'] as $col => $camel) {
            $val = $payload[$col] ?? $payload[$camel] ?? null;
            if (! $val) {
                continue;
            }
            $q = HrmsPayrollMaster::where($col, $val);
            if ($companyId) {
                $q->where('company_id', $companyId);
            }
            if ($ignoreId) {
                $q->where('id', '!=', $ignoreId);
            }
            $this->scopeCurrentMaster($q);
            if ($q->exists()) {
                abort(422, ucfirst(str_replace('_', ' ', $col)).' already exists');
            }
        }

        if ($companyId) {
            $customValues = $payload['custom_field_values'] ?? $payload['customFieldValues'] ?? [];
            if (is_array($customValues)) {
                foreach ($this->fieldService->validateCustomFieldValues($companyId, $customValues, (bool) $ignoreId) as $err) {
                    abort(422, $err['message']);
                }
            }
        }

        return $payload;
    }

    /**
     * @return list<array{field: string, message: string}>
     *
     * @param  array<string, mixed>  $payload
     */
    private function validatePayloadUniquenessErrors(
        array $payload,
        ?string $ignoreMasterId,
        ?string $companyId,
        ?string $ignoreUserId,
        bool $salaryPending = false,
        bool $isRevision = false,
    ): array {
        $errors = [];

        if (! $salaryPending && ! $isRevision) {
            $pan = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) ($payload['pan'] ?? '')));
            if ($pan === '') {
                $errors[] = ['field' => 'pan', 'message' => 'PAN is required.'];
            } elseif (! preg_match('/^[A-Z]{5}\d{4}[A-Z]$/', $pan)) {
                $errors[] = ['field' => 'pan', 'message' => 'Enter a valid PAN number.'];
            } elseif ($this->masterNormalizedFieldExists('pan', $pan, $ignoreMasterId, $companyId, fn ($v) => strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $v)))) {
                $errors[] = ['field' => 'pan', 'message' => 'PAN number already exists.'];
            }
        } elseif ($isRevision) {
            $pan = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) ($payload['pan'] ?? '')));
            if ($pan !== '' && ! preg_match('/^[A-Z]{5}\d{4}[A-Z]$/', $pan)) {
                $errors[] = ['field' => 'pan', 'message' => 'Enter a valid PAN number.'];
            }
        }

        $code = trim((string) ($payload['employee_code'] ?? $payload['employeeCode'] ?? ''));
        if ($code === '' && ! $ignoreMasterId && ! $salaryPending) {
            $errors[] = ['field' => 'employee_code', 'message' => 'Employee code is required.'];
        }

        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        if ($email !== '') {
            if ($this->masterNormalizedFieldExists('email', $email, $ignoreMasterId, $companyId, fn ($v) => mb_strtolower(trim((string) $v)))) {
                $errors[] = ['field' => 'email', 'message' => 'Email already exists.'];
            }
            if ($companyId && $this->userFieldExists('email', $email, $ignoreUserId, $companyId, fn ($v) => mb_strtolower(trim((string) $v)))) {
                $errors[] = ['field' => 'email', 'message' => 'Email already exists.'];
            }
        }

        $phone = preg_replace('/\D/', '', (string) ($payload['phone'] ?? ''));
        if ($phone !== '') {
            if ($this->masterNormalizedFieldExists('phone', $phone, $ignoreMasterId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'phone', 'message' => 'Phone number already exists.'];
            }
            if ($companyId && $this->userFieldExists('phone', $phone, $ignoreUserId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'phone', 'message' => 'Phone number already exists.'];
            }
        }

        $aadhaar = preg_replace('/\D/', '', (string) ($payload['aadhaar'] ?? ''));
        if ($aadhaar !== '') {
            if ($this->masterNormalizedFieldExists('aadhaar', $aadhaar, $ignoreMasterId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'aadhaar', 'message' => 'Aadhaar number already exists.'];
            }
            if ($companyId && $this->userFieldExists('aadhaar', $aadhaar, $ignoreUserId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'aadhaar', 'message' => 'Aadhaar number already exists.'];
            }
        }

        $account = preg_replace('/\D/', '', (string) ($payload['bank_account_number'] ?? $payload['bankAccountNumber'] ?? ''));
        if ($account !== '') {
            if ($this->masterNormalizedFieldExists('bank_account_number', $account, $ignoreMasterId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'bank_account_number', 'message' => 'Bank account number already exists.'];
            }
            if ($companyId && $this->userFieldExists('bank_account_number', $account, $ignoreUserId, $companyId, fn ($v) => preg_replace('/\D/', '', (string) $v))) {
                $errors[] = ['field' => 'bank_account_number', 'message' => 'Bank account number already exists.'];
            }
        }

        return $errors;
    }

    private function masterNormalizedFieldExists(
        string $column,
        string $normalizedValue,
        ?string $ignoreMasterId,
        ?string $companyId,
        callable $normalize,
    ): bool {
        if ($normalizedValue === '') {
            return false;
        }
        $q = HrmsPayrollMaster::query()->whereNotNull($column)->where($column, '!=', '');
        if ($companyId) {
            $q->where('company_id', $companyId);
        }
        if ($ignoreMasterId) {
            $q->where('id', '!=', $ignoreMasterId);
        }
        $this->scopeCurrentMaster($q);

        foreach ($q->get([$column]) as $row) {
            if ($normalize($row->{$column} ?? '') === $normalizedValue) {
                return true;
            }
        }

        return false;
    }

    private function userFieldExists(
        string $column,
        string $normalizedValue,
        ?string $ignoreUserId,
        string $companyId,
        callable $normalize,
    ): bool {
        if ($normalizedValue === '') {
            return false;
        }
        $q = HrmsUser::query()->where('company_id', $companyId)->whereNotNull($column)->where($column, '!=', '');
        if ($ignoreUserId) {
            $q->where('id', '!=', $ignoreUserId);
        }
        foreach ($q->get([$column]) as $row) {
            if ($normalize($row->{$column} ?? '') === $normalizedValue) {
                return true;
            }
        }

        return false;
    }

    /** @param  array<string, mixed>  $payload */
    private function validatePasswordComplexity(array $payload): void
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            return;
        }

        if (strlen($password) < 8) {
            abort(422, 'Password must be at least 8 characters');
        }
        if (! preg_match('/[A-Z]/', $password)) {
            abort(422, 'Password must include at least one uppercase letter');
        }
        if (! preg_match('/[a-z]/', $password)) {
            abort(422, 'Password must include at least one lowercase letter');
        }
        if (! preg_match('/[0-9]/', $password)) {
            abort(422, 'Password must include at least one number');
        }
        if (! preg_match('/[^A-Za-z0-9]/', $password)) {
            abort(422, 'Password must include at least one special character');
        }
        if (strlen($password) > 255) {
            abort(422, 'Password is too long');
        }
    }

    /** @param  array<string, mixed>  $payload */
    private function requirePasswordForNewUser(array $payload): void
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            abort(422, 'Password is required for new employee login');
        }
        $this->validatePasswordComplexity($payload);
    }

    /** @param  array<string, mixed>  $payload */
    private function hashPasswordFromPayload(array $payload): ?string
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            return null;
        }

        $this->validatePasswordComplexity($payload);

        return Hash::make($password);
    }

    /** @param  array<string, mixed>  $payload */
    private function applyPasswordToUser(HrmsUser $user, array $payload): void
    {
        $hash = $this->hashPasswordFromPayload($payload);
        if (! $hash) {
            return;
        }

        $user->update([
            'password_hash' => $hash,
            'auth_session_version' => (int) ($user->auth_session_version ?? 0) + 1,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    /** @param  array<string, mixed>  $calc */
    private function mergeCalculated(array $validated, array $calc, ?string $companyId, ?string $createdBy, bool $forceCurrentRow = false): array
    {
        $userId = $validated['user_id'] ?? $validated['userId'] ?? $validated['employee_user_id'] ?? $validated['employeeUserId'] ?? null;
        $effectiveFrom = $validated['effective_from'] ?? $validated['effectiveFrom'] ?? now()->toDateString();
        $effectiveTo = $forceCurrentRow ? null : ($validated['effective_to'] ?? $validated['effectiveTo'] ?? null);

        $attrs = [
            'company_id' => $companyId,
            'employee_id' => $validated['employee_id'] ?? $validated['employeeId'] ?? null,
            'employee_code' => $validated['employee_code'] ?? $validated['employeeCode'] ?? null,
            'name' => $validated['name'],
            'email' => $validated['email'] ?? null,
            'phone' => $validated['phone'] ?? null,
            'gender' => $validated['gender'] ?? null,
            'designation' => $validated['designation'] ?? 'Pending',
            'department' => $validated['department'] ?? null,
            'division' => $validated['division'] ?? null,
            'pay_level' => $calc['pay_level'],
            'increment_month' => IncrementMonth::normalize(
                (string) ($validated['increment_month'] ?? $validated['incrementMonth'] ?? IncrementMonth::DEFAULT),
            ) ?? IncrementMonth::DEFAULT,
            'gross_basic_pay' => $calc['gross_basic_pay'],
            'gross_basic' => $calc['gross_basic_pay'],
            'gross_salary' => $calc['gross_basic_pay'],
            'da_percent' => $calc['da_percent'],
            'da_amount' => $calc['da_amount'],
            'hra_percent' => $calc['hra_percent'],
            'medical_fixed' => $calc['medical'],
            'transport_base' => $calc['transport_base'],
            'transport_da' => $calc['transport_da'],
            'transport_total' => $calc['transport_total'],
            'transport_da_percent' => $calc['transport_da_percent'],
            'transport_slab_group' => $calc['transport_slab_group'],
            'trans' => $calc['transport_total'],
            'basic' => $calc['gross_basic_pay'],
            'hra' => $calc['hra_amount'],
            'total_earnings' => $calc['total_earnings'],
            'ctc' => $calc['total_earnings'],
            'cpf_default' => $calc['cpf_default'],
            'cpf_effective' => $calc['cpf_effective'],
            'cpf_use_company_settings' => (bool) ($validated['cpf_use_company_settings'] ?? $validated['cpfUseCompanySettings'] ?? true),
            'cpf_percentage_override' => $this->nullableFloat(
                $validated['cpf_percentage_override'] ?? $validated['cpfPercentageOverride'] ?? null,
            ),
            'cpf_basis_field_keys_override' => $this->normalizeCpfBasisOverride(
                $validated['cpf_basis_field_keys_override'] ?? $validated['cpfBasisFieldKeysOverride'] ?? null,
            ),
            'da_cpf' => $calc['da_cpf'],
            'da_cpf_default' => $calc['da_cpf'],
            'professional_tax' => $calc['professional_tax'],
            'pt' => $calc['professional_tax'],
            'pt_default' => $calc['professional_tax'],
            'income_tax' => $calc['income_tax'],
            'income_tax_default' => $calc['income_tax'],
            'tds' => $calc['income_tax'],
            'lic' => $calc['lic'],
            'lic_default' => $calc['lic'],
            'mess' => $calc['mess'],
            'mess_default' => $calc['mess'],
            'welfare' => $calc['welfare'],
            'welfare_default' => $calc['welfare'],
            'vpf' => $calc['vpf'],
            'vpf_default' => $calc['vpf'],
            'pf_loan' => $calc['pf_loan'],
            'pf_loan_default' => $calc['pf_loan'],
            'post_office' => $calc['post_office'],
            'post_office_default' => $calc['post_office'],
            'credit_society' => $calc['credit_society'],
            'credit_society_default' => $calc['credit_society'],
            'standard_licence_fee' => $calc['standard_licence_fee'],
            'std_licence_fee_default' => $calc['standard_licence_fee'],
            'electricity' => $calc['electricity'],
            'electricity_default' => $calc['electricity'],
            'water' => $calc['water'],
            'water_default' => $calc['water'],
            'loan_recovery' => $calc['loan_recovery'],
            'loan_recovery_default' => $calc['loan_recovery'],
            'vehicle_charge' => $calc['vehicle_charge'],
            'veh_charge_default' => $calc['vehicle_charge'],
            'other_deduction' => $calc['other_deduction'],
            'other_deduction_default' => $calc['other_deduction'],
            'advance' => $calc['advance'],
            'advance_bonus' => $calc['advance'],
            'take_home' => $calc['take_home'],
            'uan' => $validated['uan'] ?? null,
            'cpf_no' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? null,
            'pan' => $validated['pan'] ?? null,
            'aadhaar' => $validated['aadhaar'] ?? null,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? null,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? null,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? null,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? null,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? null,
            'status' => $validated['status'] ?? 'active',
            'remarks' => $validated['remarks'] ?? null,
            'reason_for_change' => $validated['reason_for_change'] ?? $validated['reasonForChange'] ?? null,
            'effective_from' => $effectiveFrom,
            'effective_start_date' => $effectiveFrom,
            'effective_to' => $effectiveTo,
            'effective_end_date' => $effectiveTo,
            'payroll_mode' => 'government',
            'pf_eligible' => false,
            'esic_eligible' => false,
            'created_by' => $createdBy,
            'updated_at' => now(),
        ];

        $userId = $this->resolveLinkedUserId($validated, $companyId, $userId);
        if ($userId) {
            $attrs['user_id'] = $userId;
            $attrs['employee_user_id'] = $userId;
        }

        return $attrs;
    }

    /** @param  array<string, mixed>  $validated */
    private function provisionIdentityRecords(array &$validated, string $companyId, bool $createIfMissing): void
    {
        $explicit = $validated['user_id'] ?? $validated['userId'] ?? $validated['employee_user_id'] ?? $validated['employeeUserId'] ?? null;
        $userId = $this->resolveLinkedUserId($validated, $companyId, $explicit);

        if ($userId) {
            $validated['user_id'] = $userId;
            $validated['employee_user_id'] = $userId;
            $employee = HrmsEmployee::query()
                ->where('company_id', $companyId)
                ->where('user_id', $userId)
                ->first();
            if ($employee) {
                $validated['employee_id'] = $employee->id;
            }
            $this->syncUserProfileFromPayroll($userId, $validated);

            return;
        }

        if (! $createIfMissing) {
            return;
        }

        $email = trim((string) ($validated['email'] ?? ''));
        if ($email === '') {
            abort(422, 'Email is required to create the employee user record');
        }

        $this->requirePasswordForNewUser($validated);

        $user = $this->createUserFromPayrollPayload($validated, $companyId);
        $employee = $this->createEmployeeFromPayrollPayload($validated, $companyId, $user);

        $validated['user_id'] = $user->id;
        $validated['employee_user_id'] = $user->id;
        $validated['employee_id'] = $employee->id;
    }

    /** @param  array<string, mixed>  $validated */
    private function createUserFromPayrollPayload(array $validated, string $companyId): HrmsUser
    {
        $email = mb_strtolower(trim((string) $validated['email']));
        $payLevel = (int) ($validated['pay_level'] ?? $validated['payLevel'] ?? 1);
        $gross = (float) ($validated['gross_basic_pay'] ?? $validated['grossBasicPay'] ?? 0);
        $code = trim((string) ($validated['employee_code'] ?? $validated['employeeCode'] ?? ''));
        if ($code === '') {
            $code = $this->generateEmployeeCode();
            $validated['employee_code'] = $code;
        }

        $passwordHash = $this->hashPasswordFromPayload($validated);
        if (! $passwordHash) {
            abort(422, 'Password is required for new employee login');
        }

        return HrmsUser::create([
            'email' => $email,
            'password_hash' => $passwordHash,
            'name' => trim((string) ($validated['name'] ?? '')),
            'role' => $this->resolveRoleFromPayload($validated),
            'auth_provider' => 'password',
            'auth_session_version' => 0,
            'company_id' => $companyId,
            'employee_code' => $code,
            'employment_status' => EmploymentStatus::Current,
            'phone' => $validated['phone'] ?? null,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? null,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? null,
            'gender' => $validated['gender'] ?? null,
            'designation' => $validated['designation'] ?? null,
            'gross_salary' => $gross > 0 ? $gross : null,
            'government_pay_level' => $payLevel,
            'aadhaar' => $validated['aadhaar'] ?? null,
            'pan' => $validated['pan'] ?? null,
            'uan_number' => $validated['uan'] ?? null,
            'cpf_number' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? null,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? null,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? null,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? null,
            'tds_monthly' => (float) ($validated['income_tax'] ?? $validated['incomeTax'] ?? 0) ?: null,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    private function createEmployeeFromPayrollPayload(array $validated, string $companyId, HrmsUser $user): HrmsEmployee
    {
        [$firstName, $lastName] = $this->splitFullName((string) ($validated['name'] ?? $user->name ?? 'Employee'));

        return HrmsEmployee::create([
            'user_id' => $user->id,
            'company_id' => $companyId,
            'employee_code' => $user->employee_code,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $user->email,
            'phone' => $validated['phone'] ?? $user->phone,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? $user->date_of_birth,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? $user->date_of_joining,
            'is_active' => true,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    private function syncUserProfileFromPayroll(string $userId, array $validated): void
    {
        $user = HrmsUser::find($userId);
        if (! $user) {
            return;
        }

        $payLevel = (int) ($validated['pay_level'] ?? $validated['payLevel'] ?? 0);
        $gross = (float) ($validated['gross_basic_pay'] ?? $validated['grossBasicPay'] ?? 0);

        $user->update(array_filter([
            'name' => $validated['name'] ?? $user->name,
            'phone' => $validated['phone'] ?? $user->phone,
            'gender' => $validated['gender'] ?? $user->gender,
            'designation' => $validated['designation'] ?? $user->designation,
            'role' => $this->resolveRoleFromPayload($validated)->value,
            'employment_status' => EmploymentStatus::Current,
            'government_pay_level' => $payLevel > 0 ? $payLevel : $user->government_pay_level,
            'gross_salary' => $gross > 0 ? $gross : $user->gross_salary,
            'aadhaar' => $validated['aadhaar'] ?? $user->aadhaar,
            'pan' => $validated['pan'] ?? $user->pan,
            'uan_number' => $validated['uan'] ?? $user->uan_number,
            'cpf_number' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? $user->cpf_number,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? $user->bank_name,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? $user->bank_account_number,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? $user->bank_ifsc,
        ], fn ($v) => $v !== null && $v !== ''));

        $this->applyPasswordToUser($user, $validated);
    }

    /** @param  array<string, mixed>  $validated */
    private function resolveRoleFromPayload(array $validated): UserRole
    {
        $raw = $validated['role'] ?? $validated['userRole'] ?? $validated['user_role'] ?? null;
        if ($raw instanceof UserRole) {
            return $raw;
        }
        if ($raw === null || $raw === '') {
            return UserRole::Employee;
        }

        return UserRole::fromStored(is_string($raw) ? $raw : null);
    }

    /** @return array{0: string, 1: ?string} */
    private function splitFullName(string $name): array
    {
        $trimmed = trim($name);
        if ($trimmed === '') {
            return ['Employee', null];
        }
        $parts = preg_split('/\s+/', $trimmed, 2);

        return [$parts[0], $parts[1] ?? null];
    }

    private function generateEmployeeCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = 'EMP-';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            if (! HrmsUser::where('employee_code', $code)->exists()) {
                return $code;
            }
        }

        return 'EMP-'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    }

    private function normalizeEmailForMatch(string $email): string
    {
        $email = mb_strtolower(trim($email));
        if (! str_contains($email, '@')) {
            return $email;
        }
        [$local, $domain] = explode('@', $email, 2);

        return str_replace('.', '', $local).'@'.$domain;
    }

    /** @param  array<string, mixed>  $validated */
    private function resolveLinkedUserId(array $validated, ?string $companyId, ?string $explicitUserId): ?string
    {
        if ($explicitUserId) {
            return $explicitUserId;
        }

        if (! $companyId) {
            return null;
        }

        $email = trim((string) ($validated['email'] ?? ''));
        if ($email !== '') {
            $lower = mb_strtolower($email);
            $exact = HrmsUser::query()
                ->where('company_id', $companyId)
                ->whereRaw('LOWER(email) = ?', [$lower])
                ->value('id');
            if ($exact) {
                return $exact;
            }

            $normalized = $this->normalizeEmailForMatch($email);
            $candidates = HrmsUser::query()
                ->where('company_id', $companyId)
                ->whereNotNull('email')
                ->get(['id', 'email']);
            foreach ($candidates as $candidate) {
                if ($this->normalizeEmailForMatch((string) $candidate->email) === $normalized) {
                    return $candidate->id;
                }
            }
        }

        $code = trim((string) ($validated['employee_code'] ?? $validated['employeeCode'] ?? ''));
        if ($code !== '') {
            $byCode = HrmsUser::query()
                ->where('company_id', $companyId)
                ->where('employee_code', $code)
                ->value('id');
            if ($byCode) {
                return $byCode;
            }
        }

        return null;
    }

    /** @param  array<string, mixed>  $calc */
    private function calculatedOnly(array $calc): array
    {
        return [
            'gross_basic_pay' => $calc['gross_basic_pay'],
            'gross_basic' => $calc['gross_basic_pay'],
            'gross_salary' => $calc['gross_basic_pay'],
            'da_amount' => $calc['da_amount'],
            'hra' => $calc['hra_amount'],
            'transport_base' => $calc['transport_base'],
            'transport_da' => $calc['transport_da'],
            'transport_total' => $calc['transport_total'],
            'trans' => $calc['transport_total'],
            'total_earnings' => $calc['total_earnings'],
            'ctc' => $calc['total_earnings'],
            'cpf_effective' => $calc['cpf_effective'],
            'take_home' => $calc['take_home'],
            'updated_at' => now(),
        ] + $this->mergeDeductionColumns($calc);
    }

    /** @param  array<string, mixed>  $calc */
    private function mergeDeductionColumns(array $calc): array
    {
        return [
            'da_percent' => $calc['da_percent'],
            'da_amount' => $calc['da_amount'],
            'hra_percent' => $calc['hra_percent'],
            'hra' => $calc['hra_amount'],
            'basic' => $calc['gross_basic_pay'],
            'medical_fixed' => $calc['medical'],
            'professional_tax' => $calc['professional_tax'],
            'pt' => $calc['professional_tax'],
            'income_tax' => $calc['income_tax'],
            'tds' => $calc['income_tax'],
            'lic' => $calc['lic'],
            'mess' => $calc['mess'],
            'welfare' => $calc['welfare'],
            'vpf' => $calc['vpf'],
            'pf_loan' => $calc['pf_loan'],
            'advance' => $calc['advance'],
            'da_cpf' => $calc['da_cpf'],
        ];
    }

    /** @param  array<string, mixed>  $attrs */
    /** @return array<string, mixed> */
    private function filterExistingColumns(array $attrs): array
    {
        static $columns = null;
        if ($columns === null) {
            $columns = array_flip(Schema::getColumnListing('cirt_payroll_master'));
        }

        return array_intersect_key($attrs, $columns);
    }

    private function masterToCalcInput(HrmsPayrollMaster $m): array
    {
        return $m->only([
            'pay_level', 'gross_basic_pay', 'gross_basic', 'gross_salary', 'da_percent', 'hra_percent',
            'medical', 'medical_fixed', 'transport_da_percent', 'cpf_default', 'da_cpf', 'da_cpf_default',
            'income_tax', 'income_tax_default', 'tds', 'professional_tax', 'pt', 'pt_default',
            'lic', 'lic_default', 'mess', 'mess_default', 'welfare', 'welfare_default',
            'vpf', 'vpf_default', 'pf_loan', 'pf_loan_default', 'post_office', 'post_office_default',
            'credit_society', 'credit_society_default', 'standard_licence_fee', 'std_licence_fee_default',
            'electricity', 'electricity_default', 'water', 'water_default', 'loan_recovery', 'loan_recovery_default',
            'vehicle_charge', 'veh_charge_default', 'other_deduction', 'other_deduction_default',
            'advance', 'advance_bonus',
        ]);
    }

    /** @param  array<string, mixed>  $criteria */
    private function findExistingMaster(?string $companyId, array $criteria): ?HrmsPayrollMaster
    {
        $q = HrmsPayrollMaster::query();
        $this->scopeCurrentMaster($q);
        if ($companyId) {
            $q->where('company_id', $companyId);
        }

        if (! empty($criteria['employee_code'])) {
            $found = (clone $q)->where('employee_code', $criteria['employee_code'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['cpf_no'])) {
            $found = (clone $q)->where('cpf_no', $criteria['cpf_no'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['uan'])) {
            $found = (clone $q)->where('uan', $criteria['uan'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['email'])) {
            $found = (clone $q)->whereRaw('LOWER(email) = ?', [mb_strtolower($criteria['email'])])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['employee_id'])) {
            $found = (clone $q)->where('employee_id', $criteria['employee_id'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['user_id'])) {
            $found = (clone $q)->where(function ($w) use ($criteria) {
                $w->where('user_id', $criteria['user_id'])
                    ->orWhere('employee_user_id', $criteria['user_id']);
            })->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['name']) && ! empty($criteria['pay_level'])) {
            return (clone $q)->whereRaw('LOWER(name) = ?', [mb_strtolower($criteria['name'])])
                ->where('pay_level', $criteria['pay_level'])
                ->first();
        }

        return null;
    }

    /** @return list<list<mixed>> */
    private function parseSpreadsheet(UploadedFile $file): array
    {
        $path = $file->getRealPath() ?: $file->path();
        $spreadsheet = IOFactory::load($path);
        $sheet = $spreadsheet->getActiveSheet();
        $rows = $sheet->toArray(null, true, true, false);

        return SpreadsheetImportSecurity::sanitizeSpreadsheetRows($rows);
    }

    /** @param  list<mixed>  $header */
    /** @return array<int, string> */
    private function normalizeHeaders(array $header): array
    {
        $aliases = $this->headerAliases();
        $map = [];
        foreach ($header as $i => $cell) {
            $key = $this->normHeaderKey((string) $cell);
            $map[$i] = $aliases[$key] ?? $key;
        }

        return $map;
    }

    /** @return array<string, string> */
    private function headerAliases(): array
    {
        $aliases = [
            'code' => 'employee_code',
            'emp_code' => 'employee_code',
            'employee id' => 'employee_code',
            'employee code' => 'employee_code',
            'employee name' => 'name',
            'name of employee' => 'name',
            'staff name' => 'name',
            'post' => 'designation',
            'dept' => 'department',
            'div' => 'division',
            'level' => 'pay_level',
            'pay level' => 'pay_level',
            'increment month' => 'increment_month',
            'p_level' => 'pay_level',
            'basic' => 'gross_basic_pay',
            'gross basic' => 'gross_basic_pay',
            'gross basic pay' => 'gross_basic_pay',
            'basic pay' => 'gross_basic_pay',
            'da %' => 'da_percent',
            'da percent' => 'da_percent',
            'hra %' => 'hra_percent',
            'hra percent' => 'hra_percent',
            'total earnings' => 'total_earnings',
            'cpf' => 'cpf_effective',
            'take home' => 'take_home',
            'uan no' => 'uan',
            'uan' => 'uan',
            'cpf no' => 'cpf_no',
            'gpf no' => 'cpf_no',
            'pf no' => 'cpf_no',
            'pf' => 'cpf_default',
            'pf / cpf %' => 'cpf_default',
            'pf/cpf %' => 'cpf_default',
            'pf default' => 'cpf_default',
            'cpf default' => 'cpf_default',
            'pt' => 'professional_tax',
            'professional tax' => 'professional_tax',
            'account no' => 'bank_account_number',
            'bank account' => 'bank_account_number',
            'bank account number' => 'bank_account_number',
            'ifsc code' => 'bank_ifsc',
            'ifsc' => 'bank_ifsc',
            'mobile' => 'phone',
            'phone number' => 'phone',
            'user role' => 'user_role',
            'role' => 'user_role',
            'confirm password' => 'confirm_password',
            'password confirm' => 'confirm_password',
            'date of birth' => 'date_of_birth',
            'date of joining' => 'date_of_joining',
            'bank name' => 'bank_name',
            'bank recovery' => 'loan_recovery',
            'loan recovery' => 'loan_recovery',
            'horticulture' => 'loan_recovery',
            'user_role' => 'user_role',
            'confirm_password' => 'confirm_password',
            'employee_code' => 'employee_code',
            'pay_level' => 'pay_level',
            'gross_basic_pay' => 'gross_basic_pay',
            'bank_account_number' => 'bank_account_number',
            'bank_ifsc' => 'bank_ifsc',
        ];

        foreach ($this->importTemplateColumns() as $col) {
            $aliases[$this->normHeaderKey($col['header'])] = $col['key'];
        }

        return $aliases;
    }

    private function normHeaderKey(string $h): string
    {
        $h = trim($h);
        $h = rtrim($h, '*');
        $h = trim($h);

        return preg_replace('/\s+/', ' ', mb_strtolower($h)) ?? '';
    }

    /** @param  array<int, string>  $map */
    /** @param  list<mixed>  $raw */
    /** @return array<string, mixed> */
    private function mapRow(array $map, array $raw): array
    {
        $row = [];
        foreach ($map as $i => $field) {
            if ($field === '') {
                continue;
            }
            $row[$field] = $raw[$i] ?? null;
        }

        return $row;
    }

    /** @param  list<mixed>  $row */
    private function isEmptyRow(array $row): bool
    {
        foreach ($row as $cell) {
            if ($cell !== null && trim((string) $cell) !== '') {
                return false;
            }
        }

        return true;
    }

    /** @param  list<mixed>  $header */
    /** @param  list<mixed>  $raw */
    /** @return array{field: string, message: string}|null */
    private function validateImportColumnCount(array $header, array $raw): ?array
    {
        $headerCount = count($header);
        $lastFilled = -1;
        foreach ($raw as $i => $cell) {
            if ($cell !== null && trim((string) $cell) !== '') {
                $lastFilled = $i;
            }
        }
        $filledCount = $lastFilled + 1;
        if ($filledCount > 0 && $filledCount < $headerCount) {
            return [
                'field' => 'columns',
                'message' => "Row has {$filledCount} columns with data but the template expects {$headerCount}. Download the latest template or check for a missing column (often advance before status in older files).",
            ];
        }

        return null;
    }

    /** @param  array<string, mixed>  $row */
    /** @return array{row: array<string, mixed>, fixed: bool} */
    private function repairImportRowAlignment(array $row): array
    {
        $allowedStatuses = ['active', 'inactive', 'retired', 'deceased', 'resigned'];
        $status = mb_strtolower(trim((string) ($row['status'] ?? 'active')));

        if (in_array($status, $allowedStatuses, true)) {
            return ['row' => $row, 'fixed' => false];
        }

        $advance = mb_strtolower(trim((string) ($row['advance'] ?? '')));
        $remarks = trim((string) ($row['remarks'] ?? ''));

        // Older templates missing the advance column: advance=active, status=remarks text, remarks=effective date.
        if (in_array($advance, $allowedStatuses, true)) {
            if ($status !== '' && ! in_array($status, $allowedStatuses, true)) {
                $row['remarks'] = $row['status'];
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $remarks)) {
                $row['effective_from'] = $remarks;
            }
            $row['status'] = $advance;
            $row['advance'] = 0;

            return ['row' => $row, 'fixed' => true];
        }

        if ($status !== '' && str_contains($status, ' ')) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $remarks)) {
                $row['effective_from'] = $remarks;
            }
            $row['remarks'] = $row['status'];
            $row['status'] = 'active';

            return ['row' => $row, 'fixed' => true];
        }

        return ['row' => $row, 'fixed' => false];
    }

    /**
     * @param  list<array{
     *     row: int,
     *     data: array<string, mixed>,
     *     errors: list<array{field: string, message: string, type?: string}>,
     *     warnings: list<array{field: string, message: string, type?: string}>,
     *     valid: bool,
     *     action: string,
     *     existing: ?HrmsPayrollMaster
     * }>  $planRows
     */
    private function flagImportFileDuplicates(array &$planRows): void
    {
        $fields = [
            'employee_code' => fn ($v) => mb_strtolower(trim((string) $v)),
            'email' => fn ($v) => mb_strtolower(trim((string) $v)),
            'phone' => fn ($v) => preg_replace('/\D/', '', (string) $v),
            'aadhaar' => fn ($v) => preg_replace('/\D/', '', (string) $v),
            'pan' => fn ($v) => strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $v)),
            'bank_account_number' => fn ($v) => preg_replace('/\D/', '', (string) $v),
        ];

        /** @var array<string, array<string, list<int>>> $occurrences */
        $occurrences = [];
        foreach ($planRows as $index => $item) {
            foreach ($fields as $field => $normalize) {
                $key = $normalize($item['data'][$field] ?? '');
                if ($key === '') {
                    continue;
                }
                $occurrences[$field][$key][] = $index;
            }
        }

        foreach ($occurrences as $field => $groups) {
            foreach ($groups as $indices) {
                if (count($indices) < 2) {
                    continue;
                }
                $rowNumbers = array_map(fn (int $i) => $planRows[$i]['row'], $indices);
                sort($rowNumbers);
                foreach ($indices as $index) {
                    $others = array_values(array_filter($rowNumbers, fn (int $n) => $n !== $planRows[$index]['row']));
                    $message = $this->duplicateImportFieldMessage($field);
                    if ($others !== []) {
                        $message .= ' (also in row'.(count($others) > 1 ? 's' : '').' '.implode(', ', $others).')';
                    }
                    $planRows[$index]['errors'][] = $this->importIssue($field, $message);
                    $planRows[$index]['valid'] = false;
                }
            }
        }
    }

    /**
     * @param  list<array{
     *     row: int,
     *     data: array<string, mixed>,
     *     errors: list<array{field: string, message: string, type?: string}>,
     *     warnings: list<array{field: string, message: string, type?: string}>,
     *     valid: bool,
     *     action: string,
     *     existing: ?HrmsPayrollMaster
     * }>  $planRows
     */
    private function appendImportRowWarnings(array &$planRows): void
    {
        foreach ($planRows as &$item) {
            if (! $item['valid']) {
                continue;
            }
            $warnings = [];
            if ($item['action'] === 'update') {
                $warnings[] = $this->importIssue('row', 'This row will update an existing payroll master record.', 'warning');
            }
            if (empty($item['data']['date_of_joining'])) {
                $warnings[] = $this->importIssue('date_of_joining', 'Date of joining is empty.', 'warning');
            }
            if (empty($item['data']['department'])) {
                $warnings[] = $this->importIssue('department', 'Department is empty.', 'warning');
            }
            $item['warnings'] = $warnings;
        }
        unset($item);
    }

    /**
     * @param  list<array{
     *     row: int,
     *     data: array<string, mixed>,
     *     errors: list<array{field: string, message: string, type?: string}>,
     *     warnings: list<array{field: string, message: string, type?: string}>,
     *     valid: bool,
     *     action: string,
     *     existing: ?HrmsPayrollMaster
     * }>  $planRows
     * @param  array<string, int>  $summary
     * @return array<string, int>
     */
    private function recountImportPlanSummary(array $planRows, array $summary): array
    {
        $summary['valid_rows'] = 0;
        $summary['invalid_rows'] = 0;
        $summary['warning_rows'] = 0;
        $summary['error_count'] = 0;
        $summary['insert_rows'] = 0;
        $summary['update_rows'] = 0;

        foreach ($planRows as $item) {
            $summary['error_count'] += count($item['errors'] ?? []);
            if (! $item['valid']) {
                $summary['invalid_rows']++;

                continue;
            }
            $summary['valid_rows']++;
            if (($item['warnings'] ?? []) !== []) {
                $summary['warning_rows']++;
            }
            if ($item['action'] === 'update') {
                $summary['update_rows']++;
            } else {
                $summary['insert_rows']++;
            }
        }

        return $summary;
    }

    /** @return array{field: string, message: string, type: string} */
    private function importIssue(string $field, string $message, string $type = 'error'): array
    {
        return ['field' => $field, 'message' => $message, 'type' => $type];
    }

    private function duplicateImportFieldMessage(string $field): string
    {
        return match ($field) {
            'employee_code' => 'Employee Code already exists.',
            'email' => 'Email already exists.',
            'phone' => 'Phone number already exists.',
            'aadhaar' => 'Aadhaar number already exists.',
            'pan' => 'PAN number already exists.',
            'bank_account_number' => 'Bank account number already exists.',
            default => 'Value already exists.',
        };
    }

    /** @param  array<string, mixed>  $row */
    private function importEmployeeLabel(array $row): string
    {
        $name = trim((string) ($row['name'] ?? ''));
        $code = trim((string) ($row['employee_code'] ?? ''));
        $email = trim((string) ($row['email'] ?? ''));

        if ($name !== '' && $code !== '') {
            return $name.' / Employee Code '.$code;
        }
        if ($name !== '') {
            return $name;
        }
        if ($code !== '') {
            return 'Employee Code '.$code;
        }
        if ($email !== '') {
            return $email;
        }

        return 'Unknown employee';
    }

    /** @param  array<string, mixed>  $plan */
    /** @return list<array{rowNumber: int, employeeCode: ?string, employeeName: ?string, employeeLabel: string, field: string, errorType: string, message: string}> */
    private function flattenImportIssues(array $plan): array
    {
        $issues = [];
        foreach ($plan['file_errors'] as $e) {
            $issues[] = [
                'rowNumber' => 0,
                'employeeCode' => null,
                'employeeName' => null,
                'employeeLabel' => 'File',
                'field' => $e['field'],
                'errorType' => 'error',
                'message' => $e['message'],
            ];
        }
        foreach ($plan['rows'] as $item) {
            foreach (array_merge($item['errors'], $item['warnings'] ?? []) as $issue) {
                $issues[] = [
                    'rowNumber' => $item['row'],
                    'employeeCode' => $item['data']['employee_code'] ?? null,
                    'employeeName' => $item['data']['name'] ?? null,
                    'employeeLabel' => $this->importEmployeeLabel($item['data']),
                    'field' => $issue['field'],
                    'errorType' => $issue['type'] ?? 'error',
                    'message' => $issue['message'],
                ];
            }
        }

        return $issues;
    }

    /** @param  array{
     *     row: int,
     *     data: array<string, mixed>,
     *     errors: list<array{field: string, message: string, type?: string}>,
     *     warnings: list<array{field: string, message: string, type?: string}>,
     *     valid: bool,
     *     action: string,
     *     existing: ?HrmsPayrollMaster
     * }  $item
     * @return array<string, mixed>
     */
    private function formatImportPreviewRow(array $item): array
    {
        return [
            'row' => $item['row'],
            'employeeCode' => $item['data']['employee_code'] ?? null,
            'employeeName' => $item['data']['name'] ?? null,
            'employeeLabel' => $this->importEmployeeLabel($item['data']),
            'email' => $item['data']['email'] ?? null,
            'designation' => $item['data']['designation'] ?? null,
            'payLevel' => $item['data']['pay_level'] ?? null,
            'grossBasicPay' => $item['data']['gross_basic_pay'] ?? null,
            'status' => $item['data']['status'] ?? 'active',
            'remarks' => $item['data']['remarks'] ?? null,
            'action' => $item['action'],
            'valid' => $item['valid'],
            'errors' => $item['errors'],
            'warnings' => $item['warnings'] ?? [],
            'willGeneratePassword' => ! empty($item['generated_password']),
        ];
    }

    private function friendlyImportSaveError(\Throwable $e): string
    {
        $message = $e->getMessage();
        $lower = mb_strtolower($message);
        foreach ([
            'employee code' => 'Employee Code already exists.',
            'email' => 'Email already exists.',
            'phone' => 'Phone number already exists.',
            'aadhaar' => 'Aadhaar number already exists.',
            'pan' => 'PAN number already exists.',
            'account' => 'Bank account number already exists.',
            'password' => 'Password is required for new employee login.',
        ] as $needle => $friendly) {
            if (str_contains($lower, $needle)) {
                return $friendly;
            }
        }

        return $message;
    }

    /** @param  list<mixed>  $row */
    private function isImportInstructionRow(array $row): bool
    {
        $first = trim((string) ($row[0] ?? ''));

        return str_starts_with($first, 'Required:') || str_starts_with($first, 'NOTE:');
    }

    /** @param  array<string, mixed>  $row */
    /** @return array<string, mixed> */
    private function normalizeImportRow(array $row): array
    {
        foreach ([
            'employee_code', 'name', 'email', 'designation', 'department', 'division', 'bank_name',
            'uan', 'cpf_no', 'gender', 'user_role', 'status', 'remarks', 'password', 'confirm_password',
        ] as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) {
                $row[$key] = trim((string) $row[$key]);
            }
        }

        if (! empty($row['email'])) {
            $row['email'] = mb_strtolower((string) $row['email']);
        }
        if (! empty($row['pan'])) {
            $row['pan'] = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $row['pan']));
        }
        if (! empty($row['aadhaar'])) {
            $row['aadhaar'] = preg_replace('/\D/', '', (string) $row['aadhaar']);
        }
        if (! empty($row['phone'])) {
            $row['phone'] = preg_replace('/\D/', '', (string) $row['phone']);
        }
        if (! empty($row['bank_account_number'])) {
            $row['bank_account_number'] = preg_replace('/\D/', '', (string) $row['bank_account_number']);
        }
        if (! empty($row['bank_ifsc'])) {
            $row['bank_ifsc'] = strtoupper(preg_replace('/\s+/', '', (string) $row['bank_ifsc']));
        }
        if (array_key_exists('increment_month', $row)) {
            $normalizedMonth = IncrementMonth::normalize((string) ($row['increment_month'] ?? ''));
            $row['increment_month'] = $normalizedMonth;
        }

        return $row;
    }

    private function importRowNeedsNewUser(array $row, ?string $companyId, ?HrmsPayrollMaster $existing): bool
    {
        if ($existing && ($existing->user_id ?? $existing->employee_user_id)) {
            return false;
        }

        return ! $this->resolveLinkedUserId($row, $companyId, null);
    }

    /** @param  array<string, mixed>  $row */
    /** @return list<array{field: string, message: string, type?: string}> */
    private function passwordImportIssues(array $row): array
    {
        if (($row['_import_password_source'] ?? '') === 'generated') {
            return [];
        }

        $issues = [];
        $password = trim((string) ($row['password'] ?? ''));
        $confirm = trim((string) ($row['confirm_password'] ?? $row['confirmPassword'] ?? ''));

        if ($password !== '') {
            if (strlen($password) < 8) {
                $issues[] = $this->importIssue('password', 'Password must be at least 8 characters.');
            } elseif (! preg_match('/[A-Z]/', $password)) {
                $issues[] = $this->importIssue('password', 'Password must include at least one uppercase letter.');
            } elseif (! preg_match('/[a-z]/', $password)) {
                $issues[] = $this->importIssue('password', 'Password must include at least one lowercase letter.');
            } elseif (! preg_match('/[0-9]/', $password)) {
                $issues[] = $this->importIssue('password', 'Password must include at least one number.');
            } elseif (! preg_match('/[^A-Za-z0-9]/', $password)) {
                $issues[] = $this->importIssue('password', 'Password must include at least one special character.');
            } elseif (strlen($password) > 255) {
                $issues[] = $this->importIssue('password', 'Password is too long.');
            }
        }

        if ($password !== '' && $confirm === '') {
            $issues[] = $this->importIssue('confirm_password', 'Please confirm the password.');
        }
        if ($confirm !== '' && $password !== $confirm) {
            $issues[] = $this->importIssue('confirm_password', 'Passwords do not match.');
        }

        return $issues;
    }

    private function isValidImportDate(mixed $value): bool
    {
        if ($value === null || $value === '') {
            return false;
        }
        if (is_numeric($value)) {
            try {
                ExcelDate::excelToDateTimeObject((float) $value);

                return true;
            } catch (\Throwable) {
                return false;
            }
        }
        $s = trim((string) $value);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            return true;
        }

        return strtotime($s) !== false;
    }

    /** @param  array<string, mixed>  $row */
    /** @return list<array{field: string, message: string, type?: string}> */
    private function validateImportRow(array $row, ?string $companyId, ?HrmsPayrollMaster $existing): array
    {
        $errors = [];

        if (empty($row['employee_code'])) {
            $errors[] = $this->importIssue('employee_code', 'Employee code is required.');
        }

        if (empty($row['name'])) {
            $errors[] = $this->importIssue('name', 'Name is required.');
        }

        if (empty($row['email'])) {
            $errors[] = $this->importIssue('email', 'Email is required.');
        } elseif (! filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
            $errors[] = $this->importIssue('email', 'Enter a valid email.');
        }

        if (empty($row['designation'])) {
            $errors[] = $this->importIssue('designation', 'Designation is required.');
        }

        $status = mb_strtolower(trim((string) ($row['status'] ?? 'active')));
        if ($status === '') {
            $status = 'active';
        }
        $allowedStatuses = ['active', 'inactive'];
        if (! in_array($status, $allowedStatuses, true)) {
            $errors[] = $this->importIssue(
                'status',
                'Status must be active or inactive.',
            );
        }

        if (empty($row['pay_level'])) {
            $errors[] = $this->importIssue('pay_level', 'Pay level is required.');
        } else {
            $level = (int) $row['pay_level'];
            if ($level < 1) {
                $errors[] = $this->importIssue('pay_level', 'Pay level must be at least 1.');
            }
        }

        $incrementRaw = trim((string) ($row['increment_month'] ?? ''));
        if ($incrementRaw === '') {
            $errors[] = $this->importIssue('increment_month', 'Increment Month is required.');
        } elseif ($row['increment_month'] === null) {
            $errors[] = $this->importIssue('increment_month', 'Increment month must be January or July.');
        }

        $grossRaw = $row['gross_basic_pay'] ?? null;
        if ($grossRaw === null || trim((string) $grossRaw) === '') {
            $errors[] = $this->importIssue('gross_basic_pay', 'Gross Basic Pay is required.');
        } else {
            $gross = (float) $grossRaw;
            if (! is_finite($gross) || $gross <= 0) {
                $errors[] = $this->importIssue('gross_basic_pay', 'Gross basic pay must be greater than 0.');
            }
        }

        if (! empty($row['effective_from']) && ! $this->isValidImportDate($row['effective_from'])) {
            $errors[] = $this->importIssue('effective_from', 'Enter a valid date for Effective From.');
        }

        if (! empty($row['date_of_birth']) && ! $this->isValidImportDate($row['date_of_birth'])) {
            $errors[] = $this->importIssue('date_of_birth', 'Enter a valid date of birth.');
        }
        if (! empty($row['date_of_joining']) && ! $this->isValidImportDate($row['date_of_joining'])) {
            $errors[] = $this->importIssue('date_of_joining', 'Enter a valid date of joining.');
        }

        $phone = (string) ($row['phone'] ?? '');
        if ($phone !== '') {
            if (! preg_match('/^\d{10}$/', $phone)) {
                $errors[] = $this->importIssue('phone', 'Enter a valid 10-digit phone number.');
            } elseif (! preg_match('/^[6-9]\d{9}$/', $phone)) {
                $errors[] = $this->importIssue('phone', 'Enter a valid 10-digit phone number.');
            }
        }

        $aadhaar = (string) ($row['aadhaar'] ?? '');
        if ($aadhaar === '') {
            $errors[] = $this->importIssue('aadhaar', 'Aadhaar number is required.');
        } elseif (! preg_match('/^\d{12}$/', $aadhaar)) {
            $errors[] = $this->importIssue('aadhaar', 'Enter a valid 12-digit Aadhaar number.');
        }

        $pan = (string) ($row['pan'] ?? '');
        if ($pan === '') {
            $errors[] = $this->importIssue('pan', 'PAN is required.');
        } elseif (! preg_match('/^[A-Z]{5}\d{4}[A-Z]$/', $pan)) {
            $errors[] = $this->importIssue('pan', 'Enter a valid PAN number.');
        }

        $account = (string) ($row['bank_account_number'] ?? '');
        if ($account === '') {
            $errors[] = $this->importIssue('bank_account_number', 'Account number is required.');
        } elseif (! preg_match('/^\d{9,18}$/', $account)) {
            $errors[] = $this->importIssue('bank_account_number', 'Account number must be 9–18 digits.');
        }

        $ifsc = (string) ($row['bank_ifsc'] ?? '');
        if ($ifsc !== '' && ! preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc)) {
            $errors[] = $this->importIssue('bank_ifsc', 'Enter a valid IFSC code.');
        }

        foreach ([
            'da_percent' => 'DA %',
            'hra_percent' => 'HRA %',
            'medical' => 'Medical',
            'professional_tax' => 'Professional Tax',
            'income_tax' => 'Income Tax',
        ] as $field => $label) {
            if (! isset($row[$field]) || trim((string) $row[$field]) === '') {
                continue;
            }
            $n = (float) $row[$field];
            if (! is_finite($n) || $n < 0) {
                $errors[] = $this->importIssue($field, $label.' must be ≥ 0.');
            }
        }

        $role = $this->normalizeImportUserRole((string) ($row['user_role'] ?? ''));
        if ($role === null) {
            $errors[] = $this->importIssue('user_role', 'User role must be Employee or Admin.');
        }

        $errors = array_merge($errors, $this->passwordImportIssues($row));

        $ignoreUserId = $existing?->user_id ?? $existing?->employee_user_id;
        foreach ($this->validatePayloadUniquenessErrors($row, $existing?->id, $companyId, $ignoreUserId, false) as $dup) {
            $errors[] = $this->importIssue($dup['field'], $dup['message']);
        }

        if ($companyId) {
            $customValues = $this->customValuesFromImportRow($companyId, $row);
            foreach ($this->fieldService->validateCustomFieldValues($companyId, $customValues) as $ce) {
                $errors[] = $this->importIssue($ce['field'], $ce['message']);
            }
        }

        return $errors;
    }

    /** @param array<string, mixed> $row */
    /** @return array<string, string> */
    private function customValuesFromImportRow(string $companyId, array $row): array
    {
        $out = [];
        foreach ($this->fieldService->customImportColumns($companyId) as $col) {
            $key = $col['key'];
            $out[$key] = trim((string) ($row[$key] ?? ''));
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function calculateMasterForCompany(
        string $companyId,
        array $input,
        ?float $defaultDa = null,
        ?float $defaultHra = null,
        ?string $masterId = null,
        ?HrmsPayrollMaster $existingMaster = null,
    ): array {
        $master = $existingMaster;
        if (! $master && $masterId) {
            $master = HrmsPayrollMaster::query()->find($masterId);
        }
        $cpfConfig = $this->fieldService->resolveCpfConfigForMaster($companyId, $master, $input);
        $settings = $this->fieldService->getCpfSettingsForCompany($companyId);
        $cpfConfigPayload = [
            'cpf_percentage' => $cpfConfig['cpf_percentage'],
            'cpf_basis_field_keys' => $cpfConfig['cpf_basis_field_keys'],
        ];
        $customValues = $input['custom_field_values'] ?? $input['customFieldValues'] ?? [];
        if ($masterId && $customValues === []) {
            $customValues = $this->fieldService->getCustomFieldValuesForMaster($companyId, $masterId);
        }

        return $this->calculator->calculateMaster(
            $input,
            $defaultDa,
            $defaultHra,
            $cpfConfigPayload,
            $this->fieldService->customEarningsForTotal($companyId, $customValues),
            $this->fieldService->customDeductionsForTotal($companyId, $customValues),
        );
    }

    /** @param array<string, mixed> $payload */
    private function persistCustomFieldsFromPayload(string $companyId, HrmsPayrollMaster $master, array $payload): void
    {
        $customValues = $payload['custom_field_values'] ?? $payload['customFieldValues'] ?? null;
        if (! is_array($customValues)) {
            return;
        }
        $this->fieldService->saveCustomFieldValuesForMaster(
            $companyId,
            $master->id,
            $master->employee_id,
            $customValues,
        );
    }

    /** @param array<string, mixed> $row */
    /** @return array<string, string> */
    private function extractCustomFieldValuesFromImportRow(string $companyId, array $row): array
    {
        $out = [];
        foreach ($this->customValuesFromImportRow($companyId, $row) as $key => $val) {
            if ($val !== '') {
                $out[$key] = $val;
            }
        }

        return $out;
    }

    private function nullableFloat(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }

    /** @return list<string>|null */
    private function normalizeCpfBasisOverride(mixed $value): ?array
    {
        if (! is_array($value) || $value === []) {
            return null;
        }

        return array_values(array_unique(array_map('strval', $value)));
    }

    /** @param array<string, mixed> $data */
    public function updateEmployeeCpfSettings(HrmsPayrollMaster $master, array $data, string $companyId): array
    {
        if ($master->company_id && $master->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        $useCompany = (bool) ($data['cpf_use_company_settings'] ?? $data['cpfUseCompanySettings'] ?? true);
        $pct = $this->nullableFloat($data['cpf_percentage_override'] ?? $data['cpfPercentageOverride'] ?? null);
        $basis = $this->normalizeCpfBasisOverride(
            $data['cpf_basis_field_keys_override'] ?? $data['cpfBasisFieldKeysOverride'] ?? null,
        );

        if (! $useCompany) {
            if ($pct !== null && $pct < 0) {
                abort(422, 'CPF percentage must be ≥ 0.');
            }
            if ($basis === null || $basis === []) {
                abort(422, 'Select at least one earning field for PF/CPF calculation.');
            }
        }

        $master->update([
            'cpf_use_company_settings' => $useCompany,
            'cpf_percentage_override' => $useCompany ? null : $pct,
            'cpf_basis_field_keys_override' => $useCompany ? null : $basis,
        ]);

        $defaults = $this->resolveCompanyPayrollDefaults($companyId);
        $calc = $this->calculateMasterForCompany(
            $companyId,
            $master->toArray(),
            $defaults['da'],
            $defaults['hra'],
            $master->id,
            $master->refresh(),
        );
        $master->update([
            'cpf_effective' => $calc['cpf_effective'],
            'take_home' => $calc['take_home'],
            'total_earnings' => $calc['total_earnings'],
        ]);

        return $this->formatRow($master->refresh());
    }
}
