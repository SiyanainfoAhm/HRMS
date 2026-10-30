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
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class ActivityLogService
{
    /** Record only actions that materially change payroll, identity, or exported payroll data. */
    public function captureConfigurationSnapshot(Request $request): ?array
    {
        $route = ltrim($request->path(), '/');
        $companyId = $request->user()?->company_id;
        if (! is_string($companyId) || $companyId === '') return null;

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
        if (! str_ends_with(ltrim($request->path(), '/'), 'payroll/drafts') || strtoupper($request->method()) !== 'POST') return null;
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

    public function recordRequest(Request $request, Response $response, ?array $configurationBefore = null, ?array $draftBefore = null): void
    {
        $route = ltrim($request->path(), '/');
        $method = strtoupper($request->method());
        $action = $this->actionFor($method, $route);
        if ($action === null) return;

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

    private function actionFor(string $method, string $route): ?string
    {
        if (str_ends_with($route, 'auth/login')) return 'auth.login';
        if (str_ends_with($route, 'auth/signup')) return $method === 'POST' ? 'user.created' : null;
        if (preg_match('~employees$~', $route) && $method === 'POST') return 'employee.created';
        if (preg_match('~employees/[^/]+$~', $route) && $method === 'PUT') return 'employee.updated';
        if (preg_match('~payroll/master(?:/[^/]+)?$~', $route) && in_array($method, ['POST', 'PUT', 'PATCH'], true)) return 'payroll_master.changed';
        if (str_ends_with($route, 'payroll/drafts') && $method === 'POST') return 'payroll.draft.saved';
        if (str_ends_with($route, 'payroll/drafts') && $method === 'DELETE') return 'payroll.draft.discarded';
        if (str_ends_with($route, 'payroll/run/audit') || preg_match('~payroll/monthly/[^/]+/audit$~', $route)) return 'payroll.generated.amended';
        if (str_ends_with($route, 'payroll/run') && $method === 'POST') return 'payroll.generated';
        if (str_ends_with($route, 'payroll/payslips') && $method === 'POST') return 'payslip.generated';
        if ($method === 'GET' && (str_ends_with($route, 'payroll/export') || str_ends_with($route, 'payroll/master/export') || str_ends_with($route, 'payroll/master/export-employee-payroll'))) return 'payroll.excel.exported';
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
            $same = (is_numeric($old) && is_numeric($new)) ? (float) $old === (float) $new : $old === $new;
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
