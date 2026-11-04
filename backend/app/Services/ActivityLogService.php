<?php

namespace App\Services;

use App\Models\HrmsActivityLog;
use App\Models\HrmsCompany;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsMonthlyPayrollAudit;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayrollFieldDefinition;
use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Services\Concerns\AuditsRequests;
use App\Services\Concerns\WritesActivityEntries;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class ActivityLogService
{
    use WritesActivityEntries;
    use AuditsRequests;

    /** Record only actions that materially change payroll, identity, or exported payroll data. */
    public function captureConfigurationSnapshot(Request $request): ?array
    {
        $route = ltrim($request->path(), '/');
        $companyId = $request->user()?->company_id;
        if (! is_string($companyId) || $companyId === '') return null;

        if (preg_match('~payroll/master(?:/([0-9a-f-]{36}))?(?:/(?:recalculate|deactivate))?$~i', $route, $masterMatch)
            && in_array(strtoupper($request->method()), ['POST', 'PUT', 'PATCH'], true)) {
            $employeeId = $request->input('employeeUserId') ?? $request->input('employee_user_id') ?? $request->input('userId');
            if (! is_string($employeeId) && ! empty($masterMatch[1])) {
                $employeeId = DB::table('cirt_payroll_master')->where('company_id', $companyId)->where('id', $masterMatch[1])->value('employee_user_id');
            }

            return $this->currentMasterValues($companyId, is_string($employeeId) ? $employeeId : null);
        }

        if (preg_match('~(?:^|/)company/(?:me|setup)$~', $route)) {
            $keys = [
                'default_da_percent', 'default_hra_percent',
                'transport_allowance_level_9_plus', 'transport_allowance_level_3_8',
                'transport_allowance_level_1_2', 'transport_allowance_level_1_2_enhanced',
                'transport_allowance_basic_threshold', 'transport_allowance_high_min_level',
                'transport_allowance_mid_min_level',
            ];
            $company = HrmsCompany::query()->find($companyId);
            return $company ? array_intersect_key($company->getAttributes(), array_flip($keys)) : null;
        }

        if (preg_match('~settings/payroll-fields(?:/([^/]+))?(?:/deactivate)?$~', $route, $match) && ! empty($match[1])) {
            $field = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->find($match[1]);
            if (! $field) return null;
            return collect($field->getAttributes())->except(['id', 'company_id', 'created_by', 'created_at', 'updated_at'])->all();
        }

        return null;
    }

    /** @return array<string, array<string, mixed>>|null */
    public function captureDraftSnapshot(Request $request): ?array
    {
        if (! str_ends_with(ltrim($request->path(), '/'), 'payroll/drafts') || ! in_array(strtoupper($request->method()), ['POST', 'DELETE'], true)) return null;
        $companyId = $request->user()?->company_id;
        $year = (int) $request->input('year', 0);
        $month = (int) $request->input('month', 0);
        if (! is_string($companyId) || $year < 2000 || $month < 1 || $month > 12) return null;

        $draft = HrmsPayrollDraft::query()->where('company_id', $companyId)
            ->where('payroll_year', $year)->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT)->first();
        if (! $draft) return [];

        return $draft->employees()->get()->mapWithKeys(fn (HrmsPayrollDraftEmployee $row) => [
            (string) $row->employee_user_id => $this->draftRowValues([
                'rowPayload' => $row->row_payload,
                'payDays' => $row->pay_days,
                'grossPay' => $row->gross_pay,
                'totalEarnings' => $row->total_earnings,
                'totalDeductions' => $row->total_deductions,
                'totalArrears' => $row->total_arrears,
                'netPay' => $row->net_pay,
                'remarks' => $row->remarks,
            ]),
        ])->all();
    }

    public function recordRequest(Request $request, Response $response, ?array $configurationBefore = null, ?array $draftBefore = null, ?array $auditBefore = null): void
    {
        $route = ltrim($request->path(), '/');
        $method = strtoupper($request->method());

        // Table-driven audited records (settings, quarters, payroll fields, users, ...): one entry, field-level old -> new.
        if ($auditBefore !== null && isset($auditBefore['match'])) {
            try {
                $this->recordAudited($request, $response, $auditBefore);
            } catch (\Throwable $exception) {
                report($exception);
            }

            return;
        }

        $action = $this->actionFor($method, $route);
        if ($action === null) return;
        if ($this->isPreviewRequest($request)) return;

        $user = $request->user();
        $loginAttempt = str_ends_with($route, 'auth/login');
        $signupAttempt = str_ends_with($route, 'auth/signup');
        $identity = trim((string) $request->input('email', ''));
        $knownUser = $loginAttempt && $identity !== ''
            ? app(AuthService::class)->findUserForLogin($identity)
            : (($signupAttempt && $identity !== '')
                ? \App\Models\HrmsUser::query()->whereRaw('LOWER(email) = ?', [mb_strtolower($identity)])->first()
                : null);
        $success = $response->getStatusCode() < 400;
        if (in_array($action, ['payroll.excel.exported', 'payroll.bank_letter.downloaded'], true) && ! $success) return;
        $companyId = $user?->company_id ?? ($success ? $knownUser?->company_id : null) ?? $knownUser?->company_id;
        if (! $companyId && ($loginAttempt || $signupAttempt)) {
            // This deployment has one fixed CIRT company. Failed unknown identifiers are still audited there.
            $companyId = HrmsCompany::query()->whereRaw('LOWER(code) = ?', ['cirt'])->value('id');
        }
        if (! $companyId) return;

        $rows = $request->input('rows', $request->input('employees', []));
        $targets = is_array($rows)
            ? collect($rows)->map(fn ($row) => is_array($row) ? ($row['employeeUserId'] ?? $row['employee_user_id'] ?? null) : null)->filter()->unique()->values()->all()
            : [];
        if ($targets === []) {
            $single = $request->input('employeeUserId') ?? $request->input('employee_user_id');
            if (is_string($single) && $single !== '') $targets = [$single];
        }
        if (count($targets) > 100) $targets = array_slice($targets, 0, 100);

        $input = $request->except(['password', 'password_confirmation', 'token', 'idToken', 'rowPayload', 'row_payload']);
        $fields = $this->changedFieldNames($input);
        $safeInput = $this->safeValues(array_diff_key($input, array_flip(['rows', 'employees'])));
        $responseData = json_decode($response->getContent() ?: '', true);
        $configurationAfter = $this->captureConfigurationSnapshot($request);
        if ($action === 'payroll.configuration.changed' && $response->getStatusCode() < 400) {
            if (is_array($responseData['field'] ?? null)) {
                $configurationAfter = collect($responseData['field'])->except(['id', 'company_id', 'created_by', 'created_at', 'updated_at'])->all();
            }
            if ($configurationAfter !== null || $configurationBefore !== null) {
                $configurationAfter ??= [];
                $configurationBefore ??= [];
                $fields = array_values(array_filter(
                    array_unique([...array_keys($configurationBefore), ...array_keys($configurationAfter)]),
                    fn (string $key): bool => ($configurationBefore[$key] ?? null) !== ($configurationAfter[$key] ?? null),
                ));
                $safeInput = $configurationAfter;
            }
        }
        $year = (int) ($request->input('year') ?: 0);
        $month = (int) ($request->input('month') ?: 0);
        $periodId = $this->periodId($request, $companyId, $year, $month);
        $correlationId = (string) $request->header('X-Request-ID', Str::uuid());
        if (! preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $correlationId)) $correlationId = (string) Str::uuid();
        $actor = $success ? ($user ?? $knownUser) : $user;
        $actorRole = $actor?->getRawOriginal('role');
        $firstRow = is_array($rows) && isset($rows[0]) && is_array($rows[0]) ? $rows[0] : [];
        $monthlyId = $request->input('monthlyPayrollId') ?? $firstRow['monthlyPayrollId'] ?? $firstRow['monthly_payroll_id'] ?? $request->route('id');
        $monthly = is_string($monthlyId) ? HrmsGovernmentMonthlyPayroll::query()->find($monthlyId) : null;
        if ($monthly) {
            $periodId ??= $monthly->payroll_period_id;
            $targets = $targets ?: [(string) $monthly->employee_user_id];
            $year = $year ?: (int) substr((string) $monthly->month_year, 0, 4);
            $month = $month ?: (int) substr((string) $monthly->month_year, 5, 2);
        }

        $metadata = ['changedFieldCount' => count($fields)];
        if (is_array($rows) && $rows !== []) $metadata['employeeCount'] = count($rows);
        if ($loginAttempt || $signupAttempt) $metadata['identifierHash'] = hash('sha256', mb_strtolower($identity));

        $previousValue = null;
        $newValue = $safeInput ?: null;
        if ($action === 'payroll.configuration.changed' && ($configurationBefore !== null || $configurationAfter !== null)) {
            $previousValue = $configurationBefore ?? [];
            $newValue = $configurationAfter ?? [];
        }

        if ($this->usesEntryModel($action)) {
            try {
                $extra = [];
                if ($action === 'payroll.excel.exported' || $action === 'payroll.bank_letter.downloaded') {
                    if (! $success) return;
                    $extra = ['details' => $this->changesToDetails($this->reportChanges($request), null), 'skipWhenEmpty' => false,
                        'summary' => ['report' => $this->reportChanges($request)[0]['new'] ?? null]];
                } elseif ($action === 'master.increment.applied') {
                    $extra = $this->incrementEntry($request, $responseData);
                } elseif ($action === 'payroll_master.bulk') {
                    $counts = $this->bulkChanges($request, $responseData);
                    $extra = ['details' => $this->changesToDetails($counts, null), 'skipWhenEmpty' => false,
                        'summary' => ['counts' => collect($counts)->mapWithKeys(fn ($c) => [$c['key'] => $c['new']])->all()]];
                } elseif ($action === 'payroll.generated' && $success) {
                    [$gDetails, $gSummary] = $this->generatedSummary($companyId, $year, $month, $periodId, $request);
                    $extra = ['details' => $gDetails, 'summary' => $gSummary, 'skipWhenEmpty' => false];
                }
                $this->writeEntry($extra + [
                    'action' => $action, 'success' => $success, 'companyId' => $companyId, 'actor' => $actor,
                    'year' => $year, 'month' => $month, 'periodId' => $periodId, 'monthly' => $monthly,
                    'targets' => $targets === [] && is_string($configurationBefore['__employee'] ?? $configurationAfter['__employee'] ?? null)
                        ? [(string) ($configurationBefore['__employee'] ?? $configurationAfter['__employee'])] : $targets,
                    'rows' => $rows, 'safeInput' => $safeInput, 'before' => $configurationBefore, 'after' => $configurationAfter,
                    'draftBefore' => $draftBefore, 'requestId' => $correlationId, 'metadata' => $metadata,
                ]);
            } catch (\Throwable $exception) {
                report($exception);
            }

            return;
        }

        try {
            DB::transaction(function () use ($targets, $rows, $safeInput, $companyId, $actor, $actorRole, $action, $success, $year, $month, $periodId, $monthly, $fields, $correlationId, $metadata, $previousValue, $newValue, $draftBefore, $responseData): void {
                foreach ($targets ?: [null] as $targetId) {
                    $newValues = $safeInput;
                    $targetRow = null;
                    $targetMonthly = $monthly;
                    if (is_string($targetId) && is_array($rows)) {
                        $targetRow = collect($rows)->first(fn ($row) => is_array($row) && (string) ($row['employeeUserId'] ?? $row['employee_user_id'] ?? '') === $targetId);
                        if (is_array($targetRow)) $newValues['employeePayrollChanges'] = $this->safeValues($targetRow);
                        if (! $targetMonthly && $periodId) {
                            $targetMonthly = HrmsGovernmentMonthlyPayroll::query()
                                ->where('company_id', $companyId)->where('payroll_period_id', $periodId)
                                ->where('employee_user_id', $targetId)->first();
                        }
                    }
                    $auditId = collect(is_array($responseData['audits'] ?? null) ? $responseData['audits'] : [])
                        ->first(fn ($audit) => is_array($audit) && (string) ($audit['monthlyPayrollId'] ?? '') === (string) ($targetMonthly?->id ?? ''))['id'] ?? null;
                    $amendment = $action === 'payroll.generated.amended' && $targetMonthly
                        ? HrmsMonthlyPayrollAudit::query()->where('monthly_payroll_id', $targetMonthly->id)
                            ->when(is_string($auditId) && $auditId !== '', fn ($query) => $query->whereKey($auditId))
                            ->latest('created_at')->first()
                        : null;
                    $eventMetadata = $metadata;
                    if ($amendment && is_array($targetRow) && is_array($targetRow['directEditedFields'] ?? null)) {
                        $changedNames = collect($amendment->changed_fields ?? [])->map(fn ($change) => is_array($change) ? ($change['field'] ?? null) : null)
                            ->filter(fn ($field) => is_string($field) && $field !== '')
                            ->unique()->values()->all();
                        $direct = collect($targetRow['directEditedFields'])->filter(fn ($field) => is_string($field) && in_array($field, $changedNames, true))->unique()->values()->all();
                        if ($direct !== []) {
                            $eventMetadata['changeClassificationSource'] = 'payroll-ui';
                            $eventMetadata['directEditedFields'] = $direct;
                            $eventMetadata['recalculatedFields'] = array_values(array_diff($changedNames, $direct));
                        }
                    }
                    $eventFields = $fields;
                    $eventPrevious = $previousValue;
                    $eventNew = $newValue;
                    if ($action === 'payroll.draft.saved' && $success && is_array($targetRow) && is_string($targetId)) {
                        $beforeRow = $draftBefore[$targetId] ?? [];
                        $afterRow = $this->draftRowValues($targetRow);
                        [$eventFields, $eventPrevious, $eventNew] = $this->changedPayloadValues($beforeRow, $afterRow);
                    }
                    HrmsActivityLog::query()->create([
                        'company_id' => $companyId,
                        'actor_user_id' => $actor?->id,
                        'actor_role' => is_string($actorRole) ? $actorRole : null,
                        'action' => $action,
                        'outcome' => $success ? 'succeeded' : 'failed',
                        'target_employee_user_id' => is_string($targetId) ? $targetId : null,
                        'payroll_year' => $year > 0 ? $year : null,
                        'payroll_month' => $month > 0 ? $month : null,
                        'payroll_period_id' => $periodId,
                        'monthly_payroll_id' => $targetMonthly?->id,
                        'field_changed' => $amendment && count($amendment->changed_fields ?? []) === 1
                            ? ($amendment->changed_fields[0]['field'] ?? null)
                            : (count($eventFields) === 1 ? $eventFields[0] : null),
                        'changed_fields' => $amendment?->changed_fields ?: ($eventFields ?: null),
                        'previous_value' => $amendment?->before_payload ?? $eventPrevious,
                        'new_value' => $amendment?->after_payload ?? ($action === 'payroll.configuration.changed' || $action === 'payroll.draft.saved' ? $eventNew : ($newValues ?: null)),
                        'request_id' => $correlationId,
                        'metadata' => $eventMetadata,
                    ]);
                }
            });
        } catch (\Throwable $exception) {
            report($exception);
        }
    }

    /** Generate payroll: period, employee count and totals of the run, read back from what was saved. @return array{0: list<array<string, mixed>>, 1: array<string, mixed>} */
    private function generatedSummary(string $companyId, int $year, int $month, ?string $periodId, Request $request): array
    {
        $periodId ??= $this->periodId($request, $companyId, $year, $month);
        $totals = $periodId
            ? DB::table('cirt_monthly_payroll')->where('company_id', $companyId)->where('payroll_period_id', $periodId)
                ->selectRaw('COUNT(*) as employees, COALESCE(SUM(total_earnings),0) as gross, COALESCE(SUM(total_deductions),0) as deductions, COALESCE(SUM(net_salary),0) as net')->first()
            : null;
        $summary = ['period' => sprintf('%02d/%04d', $month, $year), 'employees' => (int) ($totals->employees ?? 0),
            'totalGross' => (float) ($totals->gross ?? 0), 'totalDeductions' => (float) ($totals->deductions ?? 0), 'totalNet' => (float) ($totals->net ?? 0)];
        $changes = [
            $this->change('period', 'Payroll period', null, $summary['period'], 'text'),
            $this->change('employees', 'Employees', null, $summary['employees'], 'text'),
            $this->change('total_gross', 'Total gross', null, $summary['totalGross'], 'money'),
            $this->change('total_deductions', 'Total deductions', null, $summary['totalDeductions'], 'money'),
            $this->change('total_net', 'Total net pay', null, $summary['totalNet'], 'money'),
        ];

        return [$this->changesToDetails($changes, null), $summary];
    }

    private function actionFor(string $method, string $route): ?string
    {
        if (str_ends_with($route, 'auth/login')) return 'auth.login';
        if (str_ends_with($route, 'auth/signup')) return $method === 'POST' ? 'user.created' : null;
        if (preg_match('~employees$~', $route) && $method === 'POST') return 'employee.created';
        if (preg_match('~employees/[^/]+$~', $route) && $method === 'PUT') return 'employee.updated';
        if (preg_match('~payroll/master/(?:import-preview|preview)$~', $route)) return null; // read-only, never an activity
        if (preg_match('~payroll/master/(?:import|recalculate-all|sync-existing-employees)$~', $route) && $method === 'POST') return 'payroll_master.bulk';
        if (preg_match('~payroll/master/resolve-employee-code-conflict$~', $route) && $method === 'POST') return 'payroll_master.changed';
        if (preg_match('~payroll/master(?:/[0-9a-f-]{36}(?:/(?:recalculate|deactivate))?)?$~i', $route) && in_array($method, ['POST', 'PUT', 'PATCH'], true)) return 'payroll_master.changed';
        if (preg_match('~payroll/periods(?:/[^/]+)?$~', $route) && in_array($method, ['POST', 'PUT'], true)) return 'payroll.period.changed';
        if (preg_match('~settings/(?:night-allowance-rates|electricity-tariffs)(?:/[0-9a-f-]{36}(?:/deactivate)?)?$~i', $route) && in_array($method, ['POST', 'PUT'], true)) return 'payroll.rates.changed';
        if (preg_match('~settings/(?:quarters|quarter-types)(?:/[0-9a-f-]{36}(?:/(?:assign|unassign|deactivate|activate))?)?$~i', $route) && in_array($method, ['POST', 'PUT'], true)) return 'payroll.quarters.changed';
        if (str_ends_with($route, 'payroll/drafts') && $method === 'POST') return 'payroll.draft.saved';
        if (str_ends_with($route, 'payroll/drafts') && $method === 'DELETE') return 'payroll.draft.discarded';
        if (str_ends_with($route, 'payroll/run/audit') || preg_match('~payroll/monthly/[^/]+/audit$~', $route)) return 'payroll.generated.amended';
        if (str_ends_with($route, 'payroll/run') && $method === 'POST') return 'payroll.generated';
        if (str_ends_with($route, 'payroll/payslips') && $method === 'POST') return 'payslip.generated';
        if (str_ends_with($route, 'payroll/bank-letter') && $method === 'POST') return 'payroll.bank_letter.downloaded';
        if ($method === 'GET' && (str_ends_with($route, 'payroll/export') || str_contains($route, 'payroll/post-downloads/') || str_contains($route, 'payroll/period-report/') || str_ends_with($route, 'payroll/master/export') || str_ends_with($route, 'payroll/master/export-employee-payroll'))) return 'payroll.excel.exported';
        if (str_ends_with($route, 'settings/salary-increment/apply') && $method === 'POST') return 'master.increment.applied';
        if ($method === 'GET' && str_ends_with($route, 'payslips/employee')) return 'payslip.viewed';
        if (preg_match('~(?:users/[^/]+|users)$~', $route) && in_array($method, ['POST', 'PUT'], true)) return 'user.access.changed';
        if (preg_match('~(?:company/(?:me|setup)|settings/(?:salary-increment/apply|payroll-fields(?:/[^/]+)?(?:/deactivate)?|payroll-calculation-settings))$~', $route) && in_array($method, ['POST', 'PUT', 'DELETE'], true)) return 'payroll.configuration.changed';

        return null;
    }

    /** @return list<string> */
    private function changedFieldNames(array $input): array
    {
        $fields = [];
        $walk = function (array $values) use (&$walk, &$fields): void {
            foreach ($values as $key => $value) {
                if (! is_string($key) || preg_match('/password|token|secret|account_number|ifsc/i', $key)) continue;
                if (is_array($value)) {
                    $walk($value);
                } elseif (! in_array($key, ['year', 'month', 'runDay', 'version', 'reason', 'employeeUserId', 'employee_user_id'], true)) {
                    $fields[$key] = true;
                }
            }
        };
        $walk($input);

        return array_slice(array_keys($fields), 0, 100);
    }

    /** Keep auditable values while omitting identity, bank, and authentication secrets. */
    private function safeValues(array $input): array
    {
        $out = [];
        foreach ($input as $key => $value) {
            if (! is_string($key) || preg_match('/password|token|secret|account|ifsc|bank|email|phone|employee.?name|^name$/i', $key)) continue;
            if (in_array($key, ['rowPayload', 'row_payload'], true)) continue;
            if (is_array($value)) {
                $nested = $this->safeValues($value);
                if ($nested !== []) $out[$key] = $nested;
            } elseif (is_scalar($value) || $value === null) {
                $out[$key] = $value;
            }
            if (count($out) >= 120) break;
        }

        return $out;
    }

    /** The saved draft row of one employee as comparable values, or null when there is none. @return array<string, mixed>|null */
    private function savedDraftValues(string $companyId, int $year, int $month, string $employeeUserId): ?array
    {
        $draft = HrmsPayrollDraft::query()->where('company_id', $companyId)->where('payroll_year', $year)->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT)->first();
        $row = $draft?->employees()->where('employee_user_id', $employeeUserId)->first();
        if (! $row) return null;

        return $this->draftRowValues([
            'rowPayload' => $row->row_payload, 'payDays' => $row->pay_days, 'grossPay' => $row->gross_pay, 'totalEarnings' => $row->total_earnings,
            'totalDeductions' => $row->total_deductions, 'totalArrears' => $row->total_arrears, 'netPay' => $row->net_pay, 'remarks' => $row->remarks,
        ]);
    }

    /**
     * First save of a draft: the previous value is the row as calculated from Payroll Master (and live Quarters) before the
     * operator touched it, built by the same service that builds the draft. It is only a comparison point, never an audit entry.
     * @param array<string, mixed> $baselineRow
     * @return array<string, mixed>
     */
    private function firstSaveBaselineValues(string $companyId, int $year, int $month, string $employeeUserId, array $baselineRow): array
    {
        $payload = is_array($baselineRow['rowPayload'] ?? null) ? $baselineRow['rowPayload'] : $baselineRow;
        $built = app(PayrollDraftService::class)->baselineSnapshot($companyId, $year, $month, $employeeUserId, $payload);
        $gm = is_array($built['governmentMonthly'] ?? null) ? $built['governmentMonthly'] : [];

        return $this->draftRowValues([
            'rowPayload' => $built,
            'payDays' => $baselineRow['payDays'] ?? $built['payDays'] ?? null,
            'grossPay' => $built['grossPay'] ?? $baselineRow['grossPay'] ?? null,
            'totalEarnings' => $gm['totalEarnings'] ?? $baselineRow['totalEarnings'] ?? null,
            'totalDeductions' => $gm['totalDeductions'] ?? $baselineRow['totalDeductions'] ?? null,
            'totalArrears' => $baselineRow['totalArrears'] ?? null,
            'netPay' => $gm['netSalary'] ?? $baselineRow['netPay'] ?? null,
            'remarks' => $baselineRow['remarks'] ?? null,
        ]);
    }

    /** @return array<string, mixed> */
    private function draftRowValues(array $row): array
    {
        $payload = $row['rowPayload'] ?? $row['row_payload'] ?? null;
        $values = is_array($payload) ? $this->safeValues($payload) : [];
        foreach (['payDays', 'grossPay', 'totalEarnings', 'totalDeductions', 'totalArrears', 'netPay', 'remarks'] as $key) {
            if (array_key_exists($key, $row)) $values[$key] = $row[$key];
        }
        return $values;
    }

    /** @return array{list<string>, array<string, mixed>, array<string, mixed>} */
    private function changedPayloadValues(array $before, array $after): array
    {
        $flatten = function (array $values, string $prefix = '') use (&$flatten): array {
            $out = [];
            foreach ($values as $key => $value) {
                if (! is_string($key) || preg_match('/password|token|secret|credential|account|ifsc|bank|email|phone|employee.?name/i', $key)) continue;
                $path = $prefix === '' ? $key : $prefix.'.'.$key;
                if (is_array($value) && ! array_is_list($value)) {
                    $out += $flatten($value, $path);
                } elseif (! preg_match('/(^|\.)(id|[^.]*id|[^.]*uuid)$/i', $path)) {
                    $out[$path] = $value;
                }
            }
            return $out;
        };
        $beforeFlat = $flatten($before);
        $afterFlat = $flatten($after);
        $fields = [];
        $beforeChanged = [];
        $afterChanged = [];
        foreach (array_unique([...array_keys($beforeFlat), ...array_keys($afterFlat)]) as $field) {
            $old = $beforeFlat[$field] ?? null;
            $new = $afterFlat[$field] ?? null;
            // Numbers compare as numbers (30 vs "30"), and 0 / null / "" / "—" are all "nothing", so they never count as a change.
            $nothing = static fn ($v): bool => $v === null || $v === '' || $v === '—' || (is_numeric($v) && (float) $v === 0.0);
            $same = ($nothing($old) && $nothing($new)) || ((is_numeric($old) && is_numeric($new)) ? (float) $old === (float) $new : $old === $new);
            if ($same) continue;
            $fields[] = $field;
            $beforeChanged[$field] = $old;
            $afterChanged[$field] = $new;
        }
        return [$fields, $beforeChanged, $afterChanged];
    }

    private function periodId(Request $request, string $companyId, int $year, int $month): ?string
    {
        $id = $request->input('payrollPeriodId') ?? $request->input('payroll_period_id');
        if (is_string($id) && $id !== '') return $id;
        if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) return null;

        $start = sprintf('%04d-%02d-01', $year, $month);

        return HrmsPayrollPeriod::query()->where('company_id', $companyId)->whereDate('period_start', $start)->value('id');
    }
}
