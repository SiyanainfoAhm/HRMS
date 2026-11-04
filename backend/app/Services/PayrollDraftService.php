<?php

namespace App\Services;

use App\Models\HrmsPayrollDraft;
use App\Exceptions\PayrollConcurrencyException;
use App\Models\HrmsPayrollDraftEmployee;
use App\Models\HrmsPayrollDraftAudit;
use App\Models\HrmsPayslip;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayrollFieldDefinition;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollMasterHistory;
use App\Services\QuarterService;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PayrollDraftService
{
    public function __construct(
        private readonly ?QuarterService $quarterService = null,
        private readonly ?PayrollCalculationService $payrollCalculationService = null,
        private readonly ?ElectricityTariffService $electricityTariffService = null,
    ) {}
    /**
     * @return array{
     *   exists: bool,
     *   draft: ?array<string, mixed>,
     *   employees: list<array<string, mixed>>,
     *   finalized: bool
     * }
     */
    public function getDraft(string $companyId, int $year, int $month): array
    {
        $this->assertPeriod($year, $month);
        $finalized = $this->isMonthFinalized($companyId, $year, $month);

        $draft = HrmsPayrollDraft::query()
            ->where('company_id', $companyId)
            ->where('payroll_year', $year)
            ->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT)
            ->first();

        if (! $draft) {
            return [
                'exists' => false,
                'draft' => null,
                'employees' => [],
                'finalized' => $finalized,
            ];
        }

        $quarterPayrollFieldDefinitions = ! $finalized
            ? HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('is_active', true)
                ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all()
            : [];
        $employees = $draft->employees()
            ->orderBy('employee_code')
            ->get()
            ->map(function (HrmsPayrollDraftEmployee $row) use ($companyId, $year, $month, $finalized, $quarterPayrollFieldDefinitions) {
                if (! $finalized && is_array($row->row_payload)) {
                    $meta = ($this->quarterService ?? app(QuarterService::class))->quarterMetaForDraft($companyId, (string) $row->employee_user_id, $year, $month);
                    $master = $this->resolvePayrollMasterForPeriod($companyId, (string) $row->employee_user_id, $year, $month);
                    $row->row_payload = $this->applyAuthoritativeQuarterValues($row->row_payload, $meta, $year, $month, $quarterPayrollFieldDefinitions, $master);
                    $row->row_payload = $this->reconcileDraftElectricity($row->row_payload, $companyId, $year, $month, [], $master, $quarterPayrollFieldDefinitions);
                    $row->gross_pay = $row->row_payload['grossPay'] ?? $row->gross_pay;
                    $gm = $row->row_payload['governmentMonthly'] ?? [];
                    $row->total_earnings = $gm['totalEarnings'] ?? $row->total_earnings;
                    $row->total_deductions = $gm['totalDeductions'] ?? $row->total_deductions;
                    $row->net_pay = $gm['netSalary'] ?? $row->net_pay;
                }

                return $this->formatEmployee($row);
            })
            ->values()
            ->all();

        return [
            'exists' => true,
            'draft' => $this->formatDraft($draft),
            'employees' => $employees,
            'finalized' => $finalized,
        ];
    }

    /**
     * Upsert draft header + employee payloads.
     *
     * @param  list<array<string, mixed>>  $employeeRows
     * @return array{draft: array<string, mixed>, employees: list<array<string, mixed>>, saved: int}
     */
    public function saveDraft(
        string $companyId,
        int $year,
        int $month,
        string $userId,
        array $employeeRows,
        ?int $expectedVersion = null,
        bool $replaceAllEmployees = true,
    ): array {
        $this->assertPeriod($year, $month);

        if ($this->isMonthFinalized($companyId, $year, $month)) {
            throw ValidationException::withMessages([
                'period' => ['This payroll month is already finalized. Drafts cannot be saved.'],
            ]);
        }

        if ($employeeRows === []) {
            throw ValidationException::withMessages([
                'employees' => ['Select at least one employee row to save.'],
            ]);
        }

        return DB::transaction(function () use (
            $companyId,
            $year,
            $month,
            $userId,
            $employeeRows,
            $expectedVersion,
            $replaceAllEmployees,
        ) {
            $draft = HrmsPayrollDraft::query()
                ->where('company_id', $companyId)
                ->where('payroll_year', $year)
                ->where('payroll_month', $month)
                ->where('status', HrmsPayrollDraft::STATUS_DRAFT)
                ->lockForUpdate()
                ->first();

            if ($draft && $expectedVersion === null) {
                throw new PayrollConcurrencyException((int) $draft->version, 'draft', (string) $draft->id);
            }
            if ($draft && (int) $draft->version !== (int) $expectedVersion) {
                throw new PayrollConcurrencyException((int) $draft->version, 'draft', (string) $draft->id);
            }
            $isExistingDraft = $draft !== null;
            if ($isExistingDraft && $replaceAllEmployees) {
                throw ValidationException::withMessages([
                    'replaceAllEmployees' => ['Existing drafts accept field-level patches only. Reload and save explicitly edited fields.'],
                ]);
            }

            if (! $draft) {
                $draft = HrmsPayrollDraft::create([
                    'id' => (string) Str::uuid(),
                    'company_id' => $companyId,
                    'payroll_month' => $month,
                    'payroll_year' => $year,
                    'status' => HrmsPayrollDraft::STATUS_DRAFT,
                    'version' => 1,
                    'created_by' => $userId,
                    'updated_by' => $userId,
                ]);
            } else {
                $draft->update([
                    'version' => (int) $draft->version + 1,
                    'updated_by' => $userId,
                ]);
                $draft->refresh();
            }

            $payrollFieldDefinitions = HrmsPayrollFieldDefinition::query()
                ->where('company_id', $companyId)->where('is_active', true)
                ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all();

            $seenUserIds = [];
            $saved = 0;

            foreach ($employeeRows as $row) {
                $employeeUserId = (string) ($row['employeeUserId'] ?? $row['employee_user_id'] ?? '');
                if ($employeeUserId === '') {
                    continue;
                }
                $seenUserIds[] = $employeeUserId;

                $payload = is_array($row['rowPayload'] ?? null)
                    ? $row['rowPayload']
                    : (is_array($row['row_payload'] ?? null) ? $row['row_payload'] : $row);

                $remarks = $payload['govRecalc']['leaveRemarks']
                    ?? $payload['gov_recalc']['leave_remarks']
                    ?? $payload['gov_recalc']['leaveRemarks']
                    ?? $payload['leaveRemarks']
                    ?? $payload['leave_remarks']
                    ?? $row['remarks']
                    ?? null;
                if (is_string($remarks) && mb_strlen($remarks) > 2000) {
                    throw ValidationException::withMessages([
                        'remarks' => ['Remarks cannot exceed 2000 characters.'],
                    ]);
                }

                $existing = HrmsPayrollDraftEmployee::query()
                    ->where('payroll_draft_id', $draft->id)
                    ->where('employee_user_id', $employeeUserId)
                    ->lockForUpdate()
                    ->first();

                $beforePayload = is_array($existing?->row_payload) ? $existing->row_payload : [];
                $changedFields = [];
                if ($isExistingDraft) {
                    $changedFields = $row['changedFields'] ?? $row['changed_fields'] ?? null;
                    if (! $existing || ! is_array($changedFields) || $changedFields === []) {
                        throw ValidationException::withMessages([
                            'employees' => ['Existing drafts accept patches for existing employees with explicit changedFields only. Reload and retry.'],
                        ]);
                    }
                    if (in_array('leaveLines', $changedFields, true)) $this->assertLeaveLinesValid($payload, (string) ($row['employeeCode'] ?? $employeeUserId));
                    $payload = $this->applyChangedFields($beforePayload, $payload, $changedFields);
                    $payload = $this->recalculateDraftTotals($payload, $payrollFieldDefinitions);
                } else {
                    $payload = $existing ? $this->mergeSnapshot($beforePayload, $payload) : $payload;
                }
                $master = $this->resolvePayrollMasterForPeriod($companyId, $employeeUserId, $year, $month);
                $payload = $this->reconcileDraftElectricity($payload, $companyId, $year, $month, $changedFields, $master, $payrollFieldDefinitions);
                $quarterMeta = ($this->quarterService ?? app(QuarterService::class))->quarterMetaForDraft($companyId, $employeeUserId, $year, $month);
                $payload = $this->applyAuthoritativeQuarterValues($payload, $quarterMeta, $year, $month, $payrollFieldDefinitions, $master);

                $attrs = [
                    'employee_code' => $row['employeeCode'] ?? $row['employee_code'] ?? ($payload['employeeCode'] ?? $payload['employee_code'] ?? $existing?->employee_code),
                    'payroll_master_id' => $row['payrollMasterId'] ?? $row['payroll_master_id'] ?? ($payload['payrollMasterId'] ?? $payload['payroll_master_id'] ?? $existing?->payroll_master_id),
                    'pay_days' => $this->num($row['payDays'] ?? $row['pay_days'] ?? ($payload['payDays'] ?? $payload['pay_days'] ?? $existing?->pay_days)),
                    'gross_pay' => $this->num($row['grossPay'] ?? $row['gross_pay'] ?? ($payload['grossPay'] ?? $payload['gross_pay'] ?? $existing?->gross_pay)),
                    'total_earnings' => $this->num($row['totalEarnings'] ?? $row['total_earnings'] ?? data_get($payload, 'governmentMonthly.totalEarnings') ?? $existing?->total_earnings),
                    'total_deductions' => $this->num($row['totalDeductions'] ?? $row['total_deductions'] ?? ($payload['deductions'] ?? data_get($payload, 'governmentMonthly.totalDeductions') ?? $existing?->total_deductions)),
                    'total_arrears' => $this->num($row['totalArrears'] ?? $row['total_arrears'] ?? $existing?->total_arrears),
                    'net_pay' => $this->num($row['netPay'] ?? $row['net_pay'] ?? ($payload['netPay'] ?? data_get($payload, 'governmentMonthly.netSalary') ?? $existing?->net_pay)),
                    'remarks' => is_string($remarks) ? $remarks : $existing?->remarks,
                    'row_payload' => $payload,
                    'version' => $existing ? ((int) $existing->version + 1) : 1,
                ];
                if ($isExistingDraft) {
                    $attrs['pay_days'] = $this->num($payload['payDays'] ?? $payload['pay_days'] ?? $existing->pay_days);
                    $attrs['gross_pay'] = $this->num($payload['grossPay'] ?? $payload['gross_pay'] ?? $existing->gross_pay);
                    $attrs['total_earnings'] = $this->num(data_get($payload, 'governmentMonthly.totalEarnings', $existing->total_earnings));
                    $attrs['total_deductions'] = $this->num(data_get($payload, 'governmentMonthly.totalDeductions', $existing->total_deductions));
                    $attrs['net_pay'] = $this->num(data_get($payload, 'governmentMonthly.netSalary', $existing->net_pay));
                    $attrs['total_arrears'] = $existing->total_arrears;
                    if (array_intersect($changedFields, ['daArrear', 'transportArrear', 'grossArrear', 'cpfArrear', 'netArrear']) !== []) {
                        $attrs['total_arrears'] = \App\Support\PayrollTotals::arrearsTotal(is_array($payload['governmentMonthly'] ?? null) ? $payload['governmentMonthly'] : []);
                    }
                    if (! in_array('leaveRemarks', $changedFields, true)) $remarks = $existing->remarks;
                    $attrs['remarks'] = is_string($remarks) ? $remarks : $existing->remarks;
                }

                // Prefer government monthly totals when present (camel or snake keys).
                $gm = $payload['governmentMonthly'] ?? $payload['government_monthly'] ?? null;
                if (is_array($gm)) {
                    $attrs['total_earnings'] = $this->num($gm['totalEarnings'] ?? $gm['total_earnings'] ?? $attrs['total_earnings'] ?? $attrs['gross_pay']);
                    $attrs['total_deductions'] = $this->num($gm['totalDeductions'] ?? $gm['total_deductions'] ?? $attrs['total_deductions']);
                    $attrs['net_pay'] = $this->num($gm['netSalary'] ?? $gm['net_salary'] ?? $attrs['net_pay']);
                    $attrs['total_arrears'] = \App\Support\PayrollTotals::arrearsTotal($gm);
                } elseif ($attrs['total_earnings'] === null && $attrs['gross_pay'] !== null) {
                    $attrs['total_earnings'] = $attrs['gross_pay'];
                }

                if ($attrs['total_arrears'] === null) {
                    $attrs['total_arrears'] = \App\Support\PayrollTotals::arrearsTotal([
                        'daArrearsPaid' => $payload['daArrear'] ?? $payload['da_arrear'] ?? 0,
                        'transportArrearsPaid' => $payload['transportArrear'] ?? $payload['transport_arrear'] ?? 0,
                        'grossArrear' => $payload['grossArrear'] ?? $payload['gross_arrear'] ?? 0,
                    ]);
                }

                if ($existing) {
                    $changes = $this->diffSnapshot($beforePayload, $payload);
                    $existing->update($attrs);
                    if ($changes !== []) {
                        HrmsPayrollDraftAudit::create([
                            'id' => (string) Str::uuid(),
                            'company_id' => $companyId,
                            'payroll_draft_id' => $draft->id,
                            'payroll_year' => $year,
                            'payroll_month' => $month,
                            'action' => 'employee_updated',
                            'employee_count' => 1,
                            'employee_snapshot' => [[
                                'employeeUserId' => $employeeUserId,
                                'employeeCode' => $attrs['employee_code'],
                                'changes' => $changes,
                                'reason' => $row['reason'] ?? $row['changeReason'] ?? 'Payroll draft edit',
                            ]],
                            'performed_by' => $userId,
                        ]);
                    }
                } else {
                    HrmsPayrollDraftEmployee::create([
                        'id' => (string) Str::uuid(),
                        'payroll_draft_id' => $draft->id,
                        'employee_user_id' => $employeeUserId,
                        ...$attrs,
                    ]);
                }
                $saved++;
            }

            if (! $isExistingDraft && $replaceAllEmployees && $seenUserIds !== []) {
                HrmsPayrollDraftEmployee::query()
                    ->where('payroll_draft_id', $draft->id)
                    ->whereNotIn('employee_user_id', $seenUserIds)
                    ->delete();
            }

            $expectedCount = count($employeeRows);
            $distinctCount = count(array_values(array_unique($seenUserIds)));
            if ($saved !== $expectedCount || $distinctCount !== $expectedCount) {
                throw ValidationException::withMessages([
                    'employees' => [
                        "Draft save incomplete: expected {$expectedCount} employees, saved {$saved} (distinct {$distinctCount}).",
                    ],
                ]);
            }

            $draft->refresh();
            $employees = $draft->employees()
                ->orderBy('employee_code')
                ->get()
                ->map(fn (HrmsPayrollDraftEmployee $row) => $this->formatEmployee($row))
                ->values()
                ->all();

            if ((! $isExistingDraft && count($employees) !== $expectedCount) || ($isExistingDraft && count($employees) < $expectedCount)) {
                throw ValidationException::withMessages([
                    'employees' => [
                        'Draft save incomplete: stored employee count does not match the request.',
                    ],
                ]);
            }

            return [
                'draft' => $this->formatDraft($draft),
                'employees' => $employees,
                'saved' => $saved,
                'expectedEmployeeCount' => count($employees),
                'savedEmployeeCount' => $saved,
                'distinctEmployeeCount' => $distinctCount,
            ];
        });
    }

    /**
     * Discard draft (soft status) or delete for reset.
     */
    public function resetDraft(string $companyId, int $year, int $month, string $userId, ?int $expectedVersion = null): array
    {
        $this->assertPeriod($year, $month);

        if ($this->isMonthFinalized($companyId, $year, $month)) {
            throw ValidationException::withMessages([
                'period' => ['This payroll month is already finalized.'],
            ]);
        }

        return DB::transaction(function () use ($companyId, $year, $month, $userId, $expectedVersion) {
            $draft = HrmsPayrollDraft::query()
                ->where('company_id', $companyId)
                ->where('payroll_year', $year)
                ->where('payroll_month', $month)
                ->where('status', HrmsPayrollDraft::STATUS_DRAFT)
                ->lockForUpdate()
                ->first();

            if (! $draft) {
                return ['deleted' => false, 'message' => 'No draft to reset.'];
            }
            if ($expectedVersion === null || (int) $draft->version !== $expectedVersion) {
                throw new PayrollConcurrencyException((int) $draft->version, 'draft', (string) $draft->id);
            }

            $employees = $draft->employees()
                ->orderBy('employee_code')
                ->get(['employee_user_id', 'employee_code']);

            HrmsPayrollDraftAudit::create([
                'id' => (string) Str::uuid(),
                'company_id' => $companyId,
                'payroll_draft_id' => $draft->id,
                'payroll_year' => $year,
                'payroll_month' => $month,
                'action' => 'reset',
                'employee_count' => $employees->count(),
                'employee_snapshot' => $employees->map(fn (HrmsPayrollDraftEmployee $employee) => [
                    'employeeUserId' => $employee->employee_user_id,
                    'employeeCode' => $employee->employee_code,
                ])->values()->all(),
                'performed_by' => $userId,
            ]);

            $draft->update([
                'status' => HrmsPayrollDraft::STATUS_DISCARDED,
                'updated_by' => $userId,
                'version' => (int) $draft->version + 1,
            ]);

            return ['deleted' => true, 'message' => 'Draft discarded.'];
        });
    }

    /** @return list<array<string, mixed>> */
    public function resetAuditLogs(string $companyId): array
    {
        return HrmsPayrollDraftAudit::query()
            ->where('company_id', $companyId)
            ->with('performedBy:id,name,email')
            ->latest('created_at')
            ->limit(250)
            ->get()
            ->map(fn (HrmsPayrollDraftAudit $audit) => [
                'id' => $audit->id,
                'action' => $audit->action,
                'payrollMonth' => (int) $audit->payroll_month,
                'payrollYear' => (int) $audit->payroll_year,
                'employeeCount' => (int) $audit->employee_count,
                'performedBy' => $audit->performedBy?->name ?? $audit->performedBy?->email ?? 'Unknown user',
                'performedAt' => $audit->created_at?->toIso8601String(),
                'employees' => $audit->employee_snapshot ?? [],
            ])
            ->values()
            ->all();
    }

    public function markFinalized(string $companyId, int $year, int $month, ?string $periodId, string $userId): void
    {
        $draft = HrmsPayrollDraft::query()
            ->where('company_id', $companyId)
            ->where('payroll_year', $year)
            ->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT)
            ->first();

        if (! $draft) {
            return;
        }

        $draft->update([
            'status' => HrmsPayrollDraft::STATUS_FINALIZED,
            'finalized_at' => now(),
            'finalized_period_id' => $periodId,
            'updated_by' => $userId,
            'version' => (int) $draft->version + 1,
        ]);
    }

    /**
     * Re-derive the values of ONE stored draft row that the application derives
     * from its inputs (tariff-billed Electricity, the stored arrears total) and
     * report what differs. Typed values, overrides and every other field are left
     * as stored. Used by `payroll:repair-data`; never called for finalized months.
     *
     * @return array{changed: bool, changes: array<string, array{from: mixed, to: mixed}>}
     */
    public function repairStoredDraftRow(string $companyId, int $year, int $month, HrmsPayrollDraftEmployee $row, bool $apply): array
    {
        $before = is_array($row->row_payload) ? $row->row_payload : [];
        if (! is_array($before['governmentMonthly'] ?? $before['government_monthly'] ?? null)) {
            return ['changed' => false, 'changes' => []];
        }
        $definitions = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('is_active', true)
            ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all();
        $master = $this->resolvePayrollMasterForPeriod($companyId, (string) $row->employee_user_id, $year, $month);
        $after = $this->reconcileDraftElectricity($before, $companyId, $year, $month, [], $master, $definitions);
        $nda = app(\App\Services\NightAllowanceRateService::class);
        $periodEnd = \Illuminate\Support\Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
        $ndaFix = $nda->normalizeDraftPayloadToDuty($after, $nda->listForCompany($companyId, true), $periodEnd);
        $after = $ndaFix['payload'];

        $gmBefore = $before['governmentMonthly'] ?? $before['government_monthly'];
        $gmAfter = $after['governmentMonthly'] ?? $after['government_monthly'];
        $changes = [];
        $watch = [
            'electricity' => [data_get($gmBefore, 'deductions.electricity'), data_get($gmAfter, 'deductions.electricity')],
            'totalDeductions' => [$gmBefore['totalDeductions'] ?? null, $gmAfter['totalDeductions'] ?? null],
            'netSalary' => [$gmBefore['netSalary'] ?? null, $gmAfter['netSalary'] ?? null],
        ];
        if ($ndaFix['changed']) {
            $watch['night_allowance_basis'] = [$ndaFix['from']['basis'] ?? 'hour', 'duty'];
            $watch['night_allowance_rate'] = [$ndaFix['from']['rate'], $ndaFix['to']['rate']];
            $watch['night_allowance_amount'] = [$ndaFix['from']['amount'], $ndaFix['to']['amount']];
        }
        $arrears = \App\Support\PayrollTotals::arrearsTotal($gmAfter);
        $watch['total_arrears'] = [$row->total_arrears, $arrears];
        foreach ($watch as $name => [$from, $to]) {
            if (is_numeric($from) && is_numeric($to) ? abs((float) $from - (float) $to) > 0.004 : $from !== $to) {
                $changes[$name] = ['from' => $from, 'to' => $to];
            }
        }
        if ($changes === []) return ['changed' => false, 'changes' => []];

        if ($apply) {
            $row->update([
                'row_payload' => $after,
                'gross_pay' => $this->num($after['grossPay'] ?? $row->gross_pay),
                'total_earnings' => $this->num($gmAfter['totalEarnings'] ?? $row->total_earnings),
                'total_deductions' => $this->num($gmAfter['totalDeductions'] ?? $row->total_deductions),
                'net_pay' => $this->num($gmAfter['netSalary'] ?? $row->net_pay),
                'total_arrears' => $arrears,
                'version' => (int) $row->version + 1,
            ]);
        }

        return ['changed' => true, 'changes' => $changes];
    }

    public function isMonthFinalized(string $companyId, int $year, int $month): bool
    {
        $start = sprintf('%04d-%02d-01', $year, $month);
        $period = HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereDate('period_start', $start)
            ->first();

        if (! $period) {
            return false;
        }

        return HrmsPayslip::query()
            ->where('payroll_period_id', $period->id)
            ->exists();
    }

    private function assertPeriod(int $year, int $month): void
    {
        if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
            throw ValidationException::withMessages([
                'period' => ['Invalid payroll month/year.'],
            ]);
        }
    }

    private function num(mixed $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (! is_numeric($v)) {
            return null;
        }

        return \App\Support\Money::roundMoney($v);
    }

    /** @param array<string, mixed> $bag @return array<string, mixed> */
    private function roundNumericBag(array $bag): array
    {
        foreach ($bag as $key => $value) {
            if (is_numeric($value) && ! is_int($value)) $bag[$key] = \App\Support\Money::roundMoney($value);
        }

        return $bag;
    }

    /**
     * Rounds every money line of a stored monthly snapshot to the whole rupee (paid/actual lines, arrears,
     * deduction lines, custom bags). Days, percentages and unit counts are left alone.
     *
     * @param array<string, mixed> $gm
     * @return array<string, mixed>
     */
    private function normalizeMoneyLines(array $gm): array
    {
        $lineKeys = array_merge(
            \App\Support\PayrollTotals::EARNING_KEYS,
            ['grossArrear', 'gross_arrear', 'cpfArrear', 'cpf_arrear', 'netArrear', 'net_arrear', 'quarterRent', 'quarter_rent'],
        );
        foreach ($gm as $key => $value) {
            $isActual = is_string($key) && preg_match('/^(basic|da|hra|medical|transport|spPay|extraWorkAllowance|nightAllowance|uniformAllowance|educationAllowance)Actual$/', $key) === 1;
            if ((in_array($key, $lineKeys, true) || $isActual) && is_numeric($value) && ! is_int($value)) {
                $gm[$key] = \App\Support\Money::roundMoney($value);
            }
        }
        foreach (['deductions', 'customEarnings', 'custom_earnings', 'customDeductions', 'custom_deductions'] as $bag) {
            if (is_array($gm[$bag] ?? null)) $gm[$bag] = $this->roundNumericBag($gm[$bag]);
        }
        // The one arrears chain: Gross Arrears = DA + TR, Net Arrears = Gross - CPF Arr (a stored value is replaced).
        $chain = \App\Support\PayrollTotals::arrearChain(
            $gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? 0,
            $gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? 0,
            $gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? 0,
        );
        $gm['grossArrear'] = $gm['gross_arrear'] = $chain['grossArrear'];
        $gm['netArrear'] = $gm['net_arrear'] = $chain['netArrear'];

        return $gm;
    }

    /**
     * Apply operator field tokens to the stored row snapshot. Missing values in
     * rowPayload are never interpreted as edits; an explicitly edited 0 is.
     * @param list<string> $fields
     */
    private function recalculateDraftTotals(array $payload, array $definitions): array
    {
        $gm = $payload['governmentMonthly'] ?? $payload['government_monthly'] ?? null;
        if (! is_array($gm)) return $payload;
        // Open drafts: every stored money line (also one saved under the old paise rule) is put on the
        // whole-rupee grid first, so the displayed lines are what is stored and the totals are their exact sum.
        $gm = $this->normalizeMoneyLines($gm);
        if (isset($payload['govRecalc']) && is_array($payload['govRecalc'])) {
            foreach (['earningPaidOverrides', 'deductionPaidOverrides'] as $bag) {
                if (is_array($payload['govRecalc'][$bag] ?? null)) {
                    $payload['govRecalc'][$bag] = $this->roundNumericBag($payload['govRecalc'][$bag]);
                }
            }
        }

        $amount = static fn (mixed $value): float => is_numeric($value) ? max(0, \App\Support\Money::roundMoney($value)) : 0.0;
        $earningKeys = ['basicPaid', 'spPayPaid', 'daPaid', 'transportPaid', 'hraPaid', 'medicalPaid', 'extraWorkAllowancePaid', 'nightAllowancePaid', 'uniformAllowancePaid', 'educationAllowancePaid', 'daArrearsPaid', 'transportArrearsPaid', 'encashmentPaid', 'encashmentDaPaid', 'incentive', 'prBonus', 'reimbursement'];
        $earningTotal = 0.0;
        foreach ($earningKeys as $key) $earningTotal += $amount($gm[$key] ?? 0);
        // Gross Arrears = DA + TR is already inside the two arrear earning lines above: counted once.

        $ded = $gm['deductions'] ?? [];
        $deductionKeys = ['incomeTax', 'pt', 'lic', 'cpf', 'daCpf', 'vpf', 'pfLoan', 'postOffice', 'creditSociety', 'stdLicenceFee', 'electricity', 'water', 'mess', 'loanRecovery', 'welfare', 'hpl', 'eol', 'vehCharge', 'other', 'quarterRent'];
        $deductionTotal = 0.0;
        foreach ($deductionKeys as $key) $deductionTotal += $amount(is_array($ded) ? ($ded[$key] ?? 0) : 0);
        $deductionTotal += $amount($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? 0);

        $sumCustom = static function (mixed $values, string $group) use ($definitions, $amount): float {
            if (! is_array($values)) return 0.0;
            $sum = 0.0;
            $canonical = static function (string $key): string {
                if (str_contains($key, '_')) return strtolower($key);
                return strtolower((string) preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $key));
            };
            foreach ($values as $key => $value) {
                $normalizedKey = $canonical((string) $key);
                $definition = null;
                foreach ($definitions as $candidate) {
                    if ($canonical((string) ($candidate->field_key ?? '')) === $normalizedKey) {
                        $definition = $candidate;
                        break;
                    }
                }
                // Like the TypeScript sheet calculator, saved historical custom
                // values without a current definition remain part of the total.
                if ($definition) {
                    $fieldGroup = $definition->field_group ?? null;
                    if ($group === 'earnings') {
                        if ($fieldGroup !== 'earnings' || ! ($definition->include_in_total_earnings ?? false)) continue;
                    } else {
                        $numericDeduction = in_array($fieldGroup, ['statutory', 'deductions'], true) && ($definition->field_type ?? null) === 'number';
                        if (! in_array($fieldGroup, ['deductions', 'statutory'], true) || (! ($definition->include_in_total_deductions ?? false) && ! $numericDeduction)) continue;
                    }
                }
                $sum += $amount($value);
            }
            return $sum;
        };
        $earningTotal += $sumCustom($gm['customEarnings'] ?? $gm['custom_earnings'] ?? null, 'earnings');
        $deductionTotal += $sumCustom($gm['customDeductions'] ?? $gm['custom_deductions'] ?? null, 'deductions');
        $earningTotal = \App\Support\Money::roundMoney($earningTotal);
        $deductionTotal = \App\Support\Money::roundMoney($deductionTotal);
        $net = \App\Support\Money::roundMoney($earningTotal - $deductionTotal);
        $gm['totalEarnings'] = $gm['total_earnings'] = $earningTotal;
        $gm['totalDeductions'] = $gm['total_deductions'] = $deductionTotal;
        $gm['netSalary'] = $gm['net_salary'] = $net;
        if (is_array($ded) && array_key_exists('quarterRent', $ded)) $gm['quarterRent'] = $gm['quarter_rent'] = $amount($ded['quarterRent']);
        $payload['governmentMonthly'] = $gm;
        $payload['grossPay'] = $earningTotal;
        $payload['deductions'] = $deductionTotal;
        $payload['netPay'] = $net;
        $payload['takeHome'] = $net;
        return $payload;
    }

    /**
     * Reconcile a saved Electricity bill only when its inputs require it. Unit
     * edits, missing bill snapshots, and changed effective tariffs are the
     * documented recalculation triggers. Explicit amount edits (including 0)
     * remain manual overrides; unrelated component saves preserve the bill.
     *
     * @param list<string> $changedFields
     */
    public function reconcileDraftElectricity(
        array $payload,
        string $companyId,
        int $year,
        int $month,
        array $changedFields = [],
        ?HrmsPayrollMaster $master = null,
        array $fieldDefinitions = [],
    ): array {
        $gmKey = is_array($payload['governmentMonthly'] ?? null) ? 'governmentMonthly' : 'government_monthly';
        $gm = $payload[$gmKey] ?? null;
        if (! is_array($gm)) return $payload;
        $grKey = is_array($payload['govRecalc'] ?? null) ? 'govRecalc' : 'gov_recalc';
        $gr = is_array($payload[$grKey] ?? null) ? $payload[$grKey] : [];
        $dedKey = is_array($gm['deductions'] ?? null) ? 'deductions' : 'deductions';
        $deductions = is_array($gm[$dedKey] ?? null) ? $gm[$dedKey] : [];
        $paidOverrides = is_array($gr['deductionPaidOverrides'] ?? $gr['deduction_paid_overrides'] ?? null)
            ? ($gr['deductionPaidOverrides'] ?? $gr['deduction_paid_overrides']) : [];
        $bill = is_array($gm['electricityBill'] ?? $gm['electricity_bill'] ?? null)
            ? ($gm['electricityBill'] ?? $gm['electricity_bill'])
            : (is_array($gr['electricityBill'] ?? $gr['electricity_bill'] ?? null) ? ($gr['electricityBill'] ?? $gr['electricity_bill']) : []);

        $amount = $deductions['electricity'] ?? $gm['electricityTotal'] ?? $gm['electricity_total'] ?? null;
        // Null/blank legacy bill fields are missing; numeric 0 is a valid saved amount.
        $amountExists = is_numeric($amount) && (float) $amount >= 0;
        $unitsRaw = $gm['electricityUnitsConsumed'] ?? $gm['electricity_units_consumed']
            ?? $gr['electricityUnitsConsumed'] ?? $gr['electricity_units_consumed'] ?? null;
        $units = is_numeric($unitsRaw) ? max(0, (float) $unitsRaw) : null;
        $unitsEdited = in_array('electricityUnitsConsumed', $changedFields, true)
            || in_array('electricity_units_consumed', $changedFields, true);
        $amountEdited = in_array('govDeduction_electricity', $changedFields, true)
            || in_array('govDeduction_electricity_amount', $changedFields, true);
        if ($amountEdited && (! is_numeric($amount) || (float) $amount < 0)) {
            throw ValidationException::withMessages(['employees' => ['An edited Electricity amount must contain a non-negative numeric value.']]);
        }

        $mode = (string) ($bill['mode'] ?? $gm['electricityMode'] ?? $gm['electricity_mode'] ?? $gr['electricityMode'] ?? $gr['electricity_mode'] ?? $master?->electricity_mode ?? 'manual_fixed');
        $applicable = (bool) ($gm['electricityApplicable'] ?? $gm['electricity_applicable'] ?? $gr['electricityApplicable'] ?? $gr['electricity_applicable'] ?? $master?->electricity_applicable ?? true);
        $manualOverride = (bool) ($gr['electricityManualOverride'] ?? $gr['electricity_manual_override'] ?? $gm['electricityManualOverride'] ?? $gm['electricity_manual_override'] ?? $bill['manualOverride'] ?? false);
        if ($unitsEdited) {
            // Entering units explicitly opts this month into tariff billing.
            $mode = 'unit_based';
            $manualOverride = false;
            unset($paidOverrides['electricity']);
        } elseif ($amountEdited) {
            $manualOverride = true;
            $paidOverrides['electricity'] = (float) $amount;
        }
        if (! $manualOverride && $applicable && ($units ?? 0) > 0) {
            // Units without an approved manual amount are always tariff-billed.
            // A stored manual_fixed mode (seeded from Payroll Master) or a stale
            // flat amount such as 49 must never win over recorded consumption.
            $mode = 'unit_based';
        }
        $staleElectricityOverride = $mode === 'unit_based' && ! $manualOverride
            && array_key_exists('electricity', $paidOverrides);
        if ($mode === 'unit_based' && ! $manualOverride) {
            // An old calculated value in the override map is only a cache unless
            // the explicit manual flag/bill marker approves it.
            unset($paidOverrides['electricity']);
        }
        $electricityTotalConflict = $mode === 'unit_based' && is_numeric($amount)
            && ((is_numeric($bill['total'] ?? null) && (float) $amount !== (float) $bill['total'])
                || (is_numeric($gm['electricityTotal'] ?? $gm['electricity_total'] ?? null)
                    && (float) $amount !== (float) ($gm['electricityTotal'] ?? $gm['electricity_total'])));

        $periodEnd = Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
        $tariffService = $this->electricityTariffService ?? app(ElectricityTariffService::class);
        $tariffModel = $tariffService->resolveForDate($companyId, $periodEnd);
        $tariff = $tariffModel ? $tariffService->formatTariff($tariffModel) : null;
        $savedTariffId = $gm['electricityTariffId'] ?? $gm['electricity_tariff_id'] ?? null;
        $savedTariffSnapshot = $gr['electricityTariff'] ?? $gr['electricity_tariff'] ?? null;
        $tariffChanged = $mode === 'unit_based' && $applicable && (
            (string) ($savedTariffId ?? '') !== (string) ($tariff['id'] ?? '')
            || ! is_array($savedTariffSnapshot)
            || $this->electricityTariffFingerprint($savedTariffSnapshot) !== $this->electricityTariffFingerprint($tariff)
        );
        // A derived (tariff) bill is cheap and deterministic: always rebuild it so
        // a cached amount can never disagree with units x effective tariff.
        $derivedBill = $mode === 'unit_based' && ! $manualOverride && $applicable;
        $needsRecalculation = $derivedBill || $this->draftElectricityNeedsRecalculation(
            $unitsEdited, $amountExists, $amount, $units, $manualOverride, $mode,
            $tariffChanged || $electricityTotalConflict || $staleElectricityOverride,
        );
        if (! $needsRecalculation && ! $amountEdited) return $payload;

        if ($units === null) $units = 0.0;
        $manualAmount = $amountEdited ? (float) $amount : ($paidOverrides['electricity'] ?? $bill['manualAmount'] ?? $amount);
        if ($this->requiresElectricityTariff($applicable, $mode, $units, $tariff, $manualOverride)) {
            throw ValidationException::withMessages(['electricity' => ["No active electricity tariff is effective for {$year}-{$month}; draft was not saved."]]);
        }
        $bill = $tariffService->calculateBill(
            $units,
            $tariff,
            $applicable,
            $mode === 'unit_based' ? 'unit_based' : 'manual_fixed',
            (float) ($gm['electricityUnitRate'] ?? $gm['electricity_unit_rate'] ?? 0),
            (float) ($master?->electricity ?? $master?->electricity_default ?? 0),
            $manualOverride,
            $manualOverride && is_numeric($manualAmount) ? (float) $manualAmount : null,
        );

        $deductions['electricity'] = $bill['total'];
        $gm = array_merge($gm, [
            'electricityUnitsConsumed' => $units,
            'electricityTariffId' => $bill['tariffId'],
            'electricitySthirAakar' => $bill['sthirAakar'],
            'electricityConsumptionCharge' => $bill['consumptionCharge'],
            'electricityVahanAakar' => $bill['vahanAakar'],
            'electricityFuelCharge' => $bill['fuelCharge'],
            'electricityDuty' => $bill['dutyAmount'],
            'electricityTotal' => $bill['total'],
            'electricityBill' => $bill,
            'electricityApplicable' => $applicable,
            'electricityMode' => $mode,
            'deductions' => $deductions,
        ]);
        $gr = array_merge($gr, [
            'electricityUnitsConsumed' => $units,
            'electricityTariff' => $tariff,
            'electricityApplicable' => $applicable,
            'electricityMode' => $mode,
            'electricityManualOverride' => $manualOverride,
            'deductionDefaults' => array_merge(is_array($gr['deductionDefaults'] ?? null) ? $gr['deductionDefaults'] : [], ['electricity' => $bill['total']]),
            'deductionPaidOverrides' => $paidOverrides,
        ]);
        $payload[$gmKey] = $gm;
        $payload[$grKey] = $gr;
        $payload = $this->recalculateDraftTotals($payload, $fieldDefinitions);
        return $payload;
    }

    /** Zero with positive unit-based consumption is uncalculated unless an explicit manual override says otherwise. */
    public function draftElectricityNeedsRecalculation(
        bool $unitsEdited,
        bool $amountExists,
        mixed $amount,
        ?float $units,
        bool $manualOverride,
        string $mode,
        bool $tariffChanged,
    ): bool {
        $uncalculatedZero = $mode === 'unit_based'
            && ! $manualOverride
            && ($units ?? 0) > 0
            && is_numeric($amount)
            && (float) $amount === 0.0;

        return $unitsEdited || ! $amountExists || $tariffChanged || $uncalculatedZero;
    }

    /** Positive applicable unit billing cannot be saved without a tariff unless amount is explicitly overridden. */
    public function requiresElectricityTariff(bool $applicable, string $mode, float $units, ?array $tariff, bool $manualOverride): bool
    {
        return $applicable && $mode === 'unit_based' && $units > 0 && $tariff === null && ! $manualOverride;
    }

    /** @param array<string, mixed>|null $tariff */
    private function electricityTariffFingerprint(?array $tariff): string
    {
        if ($tariff === null) return 'none';
        $slabs = is_array($tariff['slabs'] ?? null) ? $tariff['slabs'] : [];
        $normalizedSlabs = array_map(static fn (array $slab): array => [
            'from' => (int) ($slab['fromUnit'] ?? $slab['from_unit'] ?? 0),
            'to' => ($slab['toUnit'] ?? $slab['to_unit'] ?? null) === null ? null : (int) ($slab['toUnit'] ?? $slab['to_unit']),
            'rate' => (float) ($slab['ratePerUnit'] ?? $slab['rate_per_unit'] ?? 0),
            'fuel' => (float) ($slab['fuelChargePerUnit'] ?? $slab['fuel_charge_per_unit'] ?? 0),
            'order' => (int) ($slab['sortOrder'] ?? $slab['sort_order'] ?? 0),
        ], $slabs);
        usort($normalizedSlabs, static fn (array $a, array $b): int => $a['order'] <=> $b['order']);
        $inputs = [
            'id' => (string) ($tariff['id'] ?? ''),
            'effectiveFrom' => (string) ($tariff['effectiveFrom'] ?? $tariff['effective_from'] ?? ''),
            'sthirAakar' => (float) ($tariff['sthirAakar'] ?? $tariff['sthir_aakar'] ?? 0),
            'vahanAakarPerUnit' => (float) ($tariff['vahanAakarPerUnit'] ?? $tariff['vahan_aakar_per_unit'] ?? 0),
            'fuelCharge' => (float) ($tariff['fuelCharge'] ?? $tariff['fuel_charge'] ?? 0),
            'dutyPercentage' => (float) ($tariff['dutyPercentage'] ?? $tariff['duty_percentage'] ?? 0),
            'slabs' => $normalizedSlabs,
        ];
        return hash('sha256', json_encode($inputs, JSON_THROW_ON_ERROR));
    }

    /**
     * Apply date-effective assignment context while keeping every unrelated
     * draft component and override. HRA entitlement remains in Payroll Master;
     * only the period's payable HRA is zeroed for an assigned quarter.
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $quarterMeta
     * @return array<string, mixed>
     */
    /**
     * CPF = configured % of the PAID basis lines (default: Basic + DA + HRA + Medical + Transport as paid), exactly as the
     * Run Payroll calculation does. A quarter holder's HRA is 0, so it is not in the basis. Left alone when the
     * operator typed CPF (manual override / paid override), when the mode is a fixed amount, or when no CPF config is stored.
     *
     * @param array<string, mixed> $gm
     * @param array<string, mixed> $gr
     * @return array<string, mixed>
     */
    public function rederiveCpfFromPaidLines(array $gm, array $gr): array
    {
        if (($gr['cpfManualOverride'] ?? false) === true) return $gm;
        if (is_array($gr['deductionPaidOverrides'] ?? null) && array_key_exists('cpf', $gr['deductionPaidOverrides'])) return $gm;
        $cfg = $gr['cpfConfig'] ?? null;
        if (! is_array($cfg) || ($cfg['cpfCalculationMode'] ?? 'percentage') !== 'percentage') return $gm;
        $keys = $cfg['cpfBasisFieldKeys'] ?? null;
        if (! is_array($keys) || $keys === []) return $gm;

        $lines = [
            'gross_basic' => 'basicPaid', 'da' => 'daPaid', 'hra' => 'hraPaid', 'medical' => 'medicalPaid', 'transport' => 'transportPaid',
            'sp_pay' => 'spPayPaid', 'extra_work_allowance' => 'extraWorkAllowancePaid', 'night_allowance' => 'nightAllowancePaid',
            'uniform_allowance' => 'uniformAllowancePaid', 'education_allowance' => 'educationAllowancePaid',
            'da_arrears' => 'daArrearsPaid', 'transport_arrears' => 'transportArrearsPaid',
        ];
        $custom = is_array($gm['customEarnings'] ?? null) ? $gm['customEarnings'] : [];
        $basis = 0.0;
        foreach ($keys as $key) {
            if (isset($custom[$key])) $basis += (float) $custom[$key];
            elseif (isset($lines[$key])) $basis += (float) ($gm[$lines[$key]] ?? 0);
        }
        if ($basis <= 0) return $gm;

        // CIRT rule (confirmed against FoxPro): whenever TR arrears are paid, CPF = % of (basis + TR arrears) rounded UP to the next
        // rupee. Without TR arrears the configured basis and normal rounding apply.
        $trArrears = (float) ($gm['transportArrearsPaid'] ?? 0);
        $pct = (float) ($cfg['cpfPercentage'] ?? 12);
        $cpf = $trArrears > 0
            ? \App\Support\Money::percentOfCeil($basis + (in_array('transport_arrears', $keys, true) ? 0.0 : $trArrears), $pct)
            : \App\Support\Money::percentOf($basis, $pct);
        $deductions = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
        if (abs((float) ($deductions['cpf'] ?? 0) - $cpf) < 0.004) return $gm;
        $deductions['cpf'] = $cpf;
        $gm['deductions'] = $deductions;

        return $gm;
    }

    /**
     * One stored draft row: re-derive CPF from its paid lines and report what changed (Total Deductions / Net follow).
     * Writes only when $apply; never touches a finalized month.
     *
     * @return array{changed: bool, before: array<string, float>, after: array<string, float>}
     */
    public function repairStoredDraftCpf(string $companyId, HrmsPayrollDraftEmployee $row, bool $apply, ?string $userId = null, ?string $reason = null): array
    {
        $before = is_array($row->row_payload) ? $row->row_payload : [];
        $gmBefore = $before['governmentMonthly'] ?? $before['government_monthly'] ?? null;
        if (! is_array($gmBefore)) return ['changed' => false, 'before' => [], 'after' => []];
        $gr = is_array($before['govRecalc'] ?? null) ? $before['govRecalc'] : [];
        $gmAfter = $this->rederiveCpfFromPaidLines($gmBefore, $gr);
        $pick = static fn (array $gm): array => [
            'cpf' => (float) ($gm['deductions']['cpf'] ?? 0), 'totalDeductions' => (float) ($gm['totalDeductions'] ?? 0), 'net' => (float) ($gm['netSalary'] ?? 0),
        ];
        if ((float) ($gmAfter['deductions']['cpf'] ?? 0) === (float) ($gmBefore['deductions']['cpf'] ?? 0)) {
            return ['changed' => false, 'before' => $pick($gmBefore), 'after' => $pick($gmBefore)];
        }
        $definitions = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('is_active', true)
            ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all();
        $after = $this->recalculateDraftTotals(['governmentMonthly' => $gmAfter] + $before, $definitions);
        $gmAfter = $after['governmentMonthly'];
        $after['grossPay'] = $gmAfter['totalEarnings'] ?? ($after['grossPay'] ?? 0);
        $after['deductions'] = $gmAfter['totalDeductions'] ?? ($after['deductions'] ?? 0);
        $after['netPay'] = $after['takeHome'] = $gmAfter['netSalary'] ?? ($after['netPay'] ?? 0);
        $result = ['changed' => true, 'before' => $pick($gmBefore), 'after' => $pick($gmAfter)];
        if ($apply) {
            $changes = $this->diffSnapshot($before, $after);
            $row->update([
                'row_payload' => $after,
                'total_deductions' => $this->num($gmAfter['totalDeductions'] ?? $row->total_deductions),
                'net_pay' => $this->num($gmAfter['netSalary'] ?? $row->net_pay),
                'version' => (int) $row->version + 1,
            ]);
            HrmsPayrollDraftAudit::create([
                'id' => (string) Str::uuid(), 'company_id' => $companyId, 'payroll_draft_id' => $row->payroll_draft_id,
                'payroll_year' => (int) HrmsPayrollDraft::query()->whereKey($row->payroll_draft_id)->value('payroll_year'),
                'payroll_month' => (int) HrmsPayrollDraft::query()->whereKey($row->payroll_draft_id)->value('payroll_month'),
                'action' => 'employee_updated', 'employee_count' => 1,
                'employee_snapshot' => [[
                    'employeeUserId' => (string) $row->employee_user_id, 'employeeCode' => $row->employee_code, 'changes' => $changes,
                    'reason' => $reason ?? 'CPF re-derived from paid lines',
                ]],
                'performed_by' => $userId,
            ]);
        }

        return $result;
    }

    public function applyAuthoritativeQuarterValues(
        array $payload,
        array $quarterMeta,
        int $year,
        int $month,
        array $definitions = [],
        ?HrmsPayrollMaster $master = null,
    ): array
    {
        $hasQuarter = (bool) ($quarterMeta['hasQuarter'] ?? false);
        $rent = $hasQuarter ? max(0, \App\Support\Money::roundMoney($quarterMeta['quarterRent'] ?? 0)) : 0.0;
        $gm = $payload['governmentMonthly'] ?? $payload['government_monthly'] ?? null;
        if (! is_array($gm)) return $payload;
        $gr = $payload['govRecalc'] ?? $payload['gov_recalc'] ?? [];
        if (! is_array($gr)) $gr = [];
        // The quarter state recorded in the draft before this reconciliation.
        $wasQuarter = (bool) ($gm['hasQuarter'] ?? $gr['hasQuarter'] ?? false);
        $previousQuarterId = $gm['quarterId'] ?? $gr['quarterId'] ?? null;
        // A rent typed for this month stays exactly as entered while the same
        // quarter remains assigned; a different/new assignment re-derives rent.
        $typedRent = $gr['deductionPaidOverrides']['quarterRent'] ?? null;
        $keepTypedRent = $hasQuarter && ($gr['quarterRentManualOverride'] ?? false) === true
            && is_numeric($typedRent) && $previousQuarterId !== null
            && (string) $previousQuarterId === (string) ($quarterMeta['quarterId'] ?? '');
        if ($keepTypedRent) $rent = max(0, \App\Support\Money::roundMoney($typedRent));
        $grossBasic = max(0, (float) ($gr['grossBasic'] ?? $gr['gross_basic'] ?? $gm['grossBasic'] ?? $master?->gross_basic_pay ?? $master?->gross_basic ?? 0));
        $hraPercent = (float) ($gr['hraPercent'] ?? $gr['hra_percent'] ?? $master?->hra_percent ?? 0);
        $fullHra = ($this->payrollCalculationService ?? app(PayrollCalculationService::class))->calculateMaster([
            'gross_basic_pay' => $grossBasic,
            'hra_percent' => $hraPercent,
            'has_quarter' => $hasQuarter,
        ])['hra_amount'];
        $daysInMonth = Carbon::create($year, $month, 1)->daysInMonth;
        $payDays = max(0, min($daysInMonth, (int) ($payload['payDays'] ?? $payload['pay_days'] ?? $daysInMonth)));
        $hraPaid = $hasQuarter ? 0.0 : \App\Support\Money::proportion((float) $fullHra, $payDays, $daysInMonth);
        // HRA is only re-derived when the quarter state changes (or was never
        // stored). Otherwise the stored figures stand: they already include leave
        // cuts and anything the operator typed, which this pro-rata would discard.
        $rederiveHra = $hasQuarter || $wasQuarter || ! array_key_exists('hraPaid', $gm);
        if (! $rederiveHra) {
            $fullHra = (float) ($gm['hraActual'] ?? $fullHra);
            $hraPaid = (float) $gm['hraPaid'];
        }

        $deductions = $gm['deductions'] ?? [];
        if (! is_array($deductions)) $deductions = [];
        $gm = array_merge($gm, [
            'hasQuarter' => $hasQuarter,
            'quarterId' => $hasQuarter ? ($quarterMeta['quarterId'] ?? null) : null,
            'quarterName' => $hasQuarter ? ($quarterMeta['quarterName'] ?? null) : null,
            'quarterType' => $hasQuarter ? ($quarterMeta['quarterType'] ?? null) : null,
            'quarterTypeId' => $hasQuarter ? ($quarterMeta['quarterTypeId'] ?? null) : null,
            'quarterRent' => $rent,
            'quarter_rent' => $rent,
            'hraActual' => $hasQuarter ? 0.0 : (float) $fullHra,
            'hraPaid' => $hraPaid,
            'deductions' => array_merge($deductions, ['quarterRent' => $rent]),
        ]);
        // CPF follows the lines actually paid (a quarter holder's HRA is 0), the same rule the Run Payroll screen and Generate use.
        $gm = $this->rederiveCpfFromPaidLines($gm, $gr);
        $recalculated = $this->recalculateDraftTotals(['governmentMonthly' => $gm], $definitions);
        $gm = $recalculated['governmentMonthly'] ?? $gm;

        $earningOverrides = $gr['earningPaidOverrides'] ?? [];
        $deductionOverrides = $gr['deductionPaidOverrides'] ?? [];
        if (is_array($earningOverrides) && $rederiveHra) unset($earningOverrides['hraPaid']);
        if (is_array($deductionOverrides) && ! $keepTypedRent) unset($deductionOverrides['quarterRent']);
        $deductionDefaults = is_array($gr['deductionDefaults'] ?? null) ? $gr['deductionDefaults'] : [];
        $deductionDefaults['quarterRent'] = $rent;
        $gr = array_merge($gr, [
            'hasQuarter' => $hasQuarter,
            'quarterId' => $hasQuarter ? ($quarterMeta['quarterId'] ?? null) : null,
            'quarterName' => $hasQuarter ? ($quarterMeta['quarterName'] ?? null) : null,
            'quarterType' => $hasQuarter ? ($quarterMeta['quarterType'] ?? null) : null,
            'quarterRent' => $rent,
            'quarterRentManualOverride' => $keepTypedRent,
            'earningPaidOverrides' => $earningOverrides,
            'deductionPaidOverrides' => $deductionOverrides,
            'deductionDefaults' => $deductionDefaults,
        ]);
        $payload['governmentMonthly'] = $gm;
        $payload['govRecalc'] = $gr;
        $payload['hasQuarter'] = $payload['quarterAssigned'] = $hasQuarter;
        $payload['quarterContextVersion'] = 1;
        $payload['quarterId'] = $hasQuarter ? ($quarterMeta['quarterId'] ?? null) : null;
        $payload['quarterName'] = $hasQuarter ? ($quarterMeta['quarterName'] ?? null) : null;
        $payload['quarterType'] = $hasQuarter ? ($quarterMeta['quarterType'] ?? null) : null;
        $payload['quarterRent'] = $rent;
        $payload['grossPay'] = $payload['governmentMonthly']['totalEarnings'] ?? $payload['grossPay'] ?? 0;
        $payload['deductions'] = $payload['governmentMonthly']['totalDeductions'] ?? $payload['deductions'] ?? 0;
        $payload['netPay'] = $payload['takeHome'] = $payload['governmentMonthly']['netSalary'] ?? $payload['netPay'] ?? 0;

        return $payload;
    }

    /**
     * The row exactly as a first save would build it from the calculated (pre-edit) values: same electricity reconciliation and
     * the same Payroll Master / live Quarters context, with no operator edits. Used only as the audit comparison point.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function baselineSnapshot(string $companyId, int $year, int $month, string $employeeUserId, array $payload): array
    {
        $definitions = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('is_active', true)
            ->get(['field_key', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions'])->all();
        $master = $this->resolvePayrollMasterForPeriod($companyId, $employeeUserId, $year, $month);
        $payload = $this->reconcileDraftElectricity($payload, $companyId, $year, $month, [], $master, $definitions);
        $quarterMeta = ($this->quarterService ?? app(QuarterService::class))->quarterMetaForDraft($companyId, $employeeUserId, $year, $month);

        return $this->applyAuthoritativeQuarterValues($payload, $quarterMeta, $year, $month, $definitions, $master);
    }

    private function resolvePayrollMasterForPeriod(string $companyId, string $employeeUserId, int $year, int $month): ?HrmsPayrollMaster
    {
        $asOf = Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
        $matches = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->where(fn ($query) => $query->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId))
            ->where(fn ($query) => $query->whereDate('effective_from', '<=', $asOf)
                ->orWhere(fn ($fallback) => $fallback->whereNull('effective_from')->whereDate('effective_start_date', '<=', $asOf)))
            ->where(fn ($query) => $query->whereNull('effective_to')->orWhereDate('effective_to', '>=', $asOf))
            ->get();
        if ($matches->count() > 1) {
            throw ValidationException::withMessages(['payrollMaster' => ["Multiple Payroll Master rows match employee {$employeeUserId} for {$year}-{$month}; quarter HRA resolution stopped."]]);
        }
        if ($matches->isNotEmpty()) return $matches->first();

        $history = HrmsPayrollMasterHistory::query()
            ->where('company_id', $companyId)->where('is_superseded', false)
            ->where(fn ($query) => $query->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId))
            ->where(fn ($query) => $query->whereDate('effective_from', '<=', $asOf)
                ->orWhere(fn ($fallback) => $fallback->whereNull('effective_from')->whereDate('effective_start_date', '<=', $asOf)))
            ->where(fn ($query) => $query->whereNull('effective_to')->orWhereDate('effective_to', '>=', $asOf))
            ->get();
        if ($history->count() > 1) {
            throw ValidationException::withMessages(['payrollMaster' => ["Multiple historical Payroll Master rows match employee {$employeeUserId} for {$year}-{$month}; quarter HRA resolution stopped."]]);
        }
        if ($history->isNotEmpty()) return app(PayrollMasterService::class)->historyToMasterModel($history->first());

        $current = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->where(fn ($query) => $query->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId))
            ->whereNull('effective_to')->get();
        if ($current->count() > 1) {
            throw ValidationException::withMessages(['payrollMaster' => ["Multiple current Payroll Master rows exist for employee {$employeeUserId}; quarter HRA resolution stopped."]]);
        }
        if ($current->isNotEmpty()) return $current->first();

        return null;
    }

    /** Leave lines must have whole days from 1 up to the days of their month; a capped value is never stored. */
    private function assertLeaveLinesValid(array $payload, string $who): void
    {
        $lines = $payload['govRecalc']['leaveLines'] ?? null;
        if (! is_array($lines)) return;
        foreach ($lines as $line) {
            $days = is_array($line) ? ($line['days'] ?? null) : null;
            $month = (int) ($line['month'] ?? 0);
            $year = (int) ($line['year'] ?? 0);
            $max = ($month >= 1 && $month <= 12 && $year > 0) ? (int) date('t', mktime(0, 0, 0, $month, 1, $year)) : 0;
            if (! is_numeric($days) || (float) $days != floor((float) $days) || $days < 1 || $days > $max) {
                throw ValidationException::withMessages([
                    'leaveLines' => ["Fix leave lines for {$who} before saving: days must be a whole number from 1 to the days in that month."],
                ]);
            }
        }
    }

    private function applyChangedFields(array $saved, array $incoming, array $fields): array
    {
        $paths = [];
        $removePaths = [];
        $totals = [
            'governmentMonthly.totalEarnings', 'governmentMonthly.total_earnings',
            'governmentMonthly.totalDeductions', 'governmentMonthly.total_deductions',
            'governmentMonthly.netSalary', 'governmentMonthly.net_salary',
            'grossPay', 'deductions', 'netPay', 'takeHome',
        ];
        foreach (array_unique($fields) as $field) {
            if (! is_string($field) || $field === '') continue;
            if (str_starts_with($field, 'govDeduction_')) {
                $key = substr($field, strlen('govDeduction_'));
                $paths = [...$paths, "governmentMonthly.deductions.$key", "govRecalc.deductionPaidOverrides.$key", ...$totals];
                if ($key === 'quarterRent') $paths = [...$paths, 'governmentMonthly.quarterRent', 'governmentMonthly.quarter_rent', 'govRecalc.quarterRent'];
                $flag = ['electricity' => 'electricityManualOverride', 'quarterRent' => 'quarterRentManualOverride', 'cpf' => 'cpfManualOverride', 'hpl' => 'hplDeductionManualOverride', 'eol' => 'eolDeductionManualOverride'][$key] ?? null;
                if ($flag) $paths[] = "govRecalc.$flag";
                continue;
            }
            if (str_starts_with($field, 'govEarning_')) {
                $key = substr($field, strlen('govEarning_'));
                $paths = [...$paths, "governmentMonthly.$key", "govRecalc.earningPaidOverrides.$key", ...$totals];
                if (str_ends_with($key, 'Paid')) {
                    $actual = substr($key, 0, -4).'Actual';
                    $paths[] = "governmentMonthly.$actual";
                }
                if ($key === 'nightAllowancePaid') $paths[] = 'govRecalc.nightAllowanceManualOverride';
                continue;
            }
            if (str_starts_with($field, 'govCustom_') || str_starts_with($field, 'govCustomDeduction_')) {
                $isDeduction = str_starts_with($field, 'govCustomDeduction_');
                $key = substr($field, strlen($isDeduction ? 'govCustomDeduction_' : 'govCustom_'));
                $bag = $isDeduction ? 'customDeductions' : 'customEarnings';
                $paths = [...$paths, "governmentMonthly.$bag.$key", "govRecalc.$bag.$key", ...$totals];
                continue;
            }

            if ($field === 'electricityUnitsConsumed') {
                $paths = [...$paths,
                    'govRecalc.electricityUnitsConsumed', 'govRecalc.electricityMode', 'govRecalc.electricityApplicable', 'govRecalc.electricityManualOverride',
                    'governmentMonthly.electricityUnitsConsumed', 'governmentMonthly.electricityUnitRate', 'governmentMonthly.electricityTariffId',
                    'governmentMonthly.electricitySthirAakar', 'governmentMonthly.electricityConsumptionCharge', 'governmentMonthly.electricityVahanAakar',
                    'governmentMonthly.electricityFuelCharge', 'governmentMonthly.electricityDuty', 'governmentMonthly.electricityTotal',
                    'governmentMonthly.electricityBill', 'governmentMonthly.electricityApplicable', 'governmentMonthly.electricityMode',
                    'governmentMonthly.electricity', 'governmentMonthly.deductions.electricity', ...$totals];
                $removePaths[] = 'govRecalc.deductionPaidOverrides.electricity';
                continue;
            }
            if (in_array($field, ['nightHours', 'nightAllowanceRate'], true)) {
                $paths = [...$paths, "govRecalc.$field", 'govRecalc.nightAllowanceManualOverride',
                    'governmentMonthly.nightHours', 'governmentMonthly.nightAllowanceRate', 'governmentMonthly.nightAllowanceSlabNo',
                    'governmentMonthly.nightAllowanceWarning', 'governmentMonthly.nightAllowanceEligible', 'governmentMonthly.nightAllowanceBasicCeiling',
                    'governmentMonthly.nightAllowanceAmount', 'governmentMonthly.nightAllowancePaid', 'governmentMonthly.nightAllowanceActual', ...$totals];
                $removePaths[] = 'govRecalc.earningPaidOverrides.nightAllowancePaid';
                continue;
            }
            if (in_array($field, ['incentive', 'prBonus', 'reimbursement', 'tds', 'takeHome', 'ctc'], true)) {
                $paths = [...$paths, $field, "governmentMonthly.$field", ...$totals];
                continue;
            }
            if ($field === 'leaveRemarks') {
                $paths = [...$paths, 'govRecalc.leaveRemarks', 'governmentMonthly.leaveRemarks', 'governmentMonthly.leave_remarks', ...$totals];
                continue;
            }
            if (in_array($field, ['payDays', 'unpaidLeaveDays', 'hplDays', 'eolDays', 'leaveLines', 'hplReferenceMonth', 'hplReferenceYear', 'eolReferenceMonth', 'eolReferenceYear'], true)) {
                // These are calculation drivers. The resolved row contains the
                // documented dependent monthly recalculation; unrelated employee
                // rows and record membership remain untouched.
                $paths = [...$paths, $field, 'governmentMonthly', "govRecalc.$field",
                    'govRecalc.earningPaidOverrides', 'govRecalc.deductionPaidOverrides',
                    'govRecalc.cpfManualOverride', 'govRecalc.hplDeductionManualOverride', 'govRecalc.eolDeductionManualOverride',
                    'govRecalc.electricityManualOverride', 'govRecalc.quarterRentManualOverride', 'govRecalc.nightAllowanceManualOverride', ...$totals];
                $removePaths = [...$removePaths, 'govRecalc.earningPaidOverrides', 'govRecalc.deductionPaidOverrides'];
                // The leave lines (HPL / EOL, month, days) travel with their day totals.
                if ($field === 'leaveLines') $paths = [...$paths, 'govRecalc.hplDays', 'govRecalc.eolDays'];
                continue;
            }
            if (in_array($field, ['daArrear', 'transportArrear', 'grossArrear', 'cpfArrear', 'netArrear'], true)) {
                $snake = strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $field));
                $paths = [...$paths, $field, $snake, "governmentMonthly.$field", "governmentMonthly.$snake", ...$totals];
                // The sheet stores DA / transport arrears as the *Paid earning lines and
                // derives gross / CPF / net arrear from them as one unit. Patching only
                // governmentMonthly.daArrear (a key that does not exist) dropped the typed
                // arrear from the line, and therefore from gross, on every patch save.
                foreach (['daArrear', 'transportArrear', 'grossArrear', 'cpfArrear', 'netArrear'] as $unit) {
                    $unitSnake = strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $unit));
                    $paths = [...$paths, $unit, $unitSnake, "governmentMonthly.$unit", "governmentMonthly.$unitSnake"];
                }
                $paths = [...$paths,
                    'governmentMonthly.daArrearsPaid', 'governmentMonthly.da_arrears_paid', 'governmentMonthly.daArrearsActual',
                    'governmentMonthly.transportArrearsPaid', 'governmentMonthly.transport_arrears_paid', 'governmentMonthly.transportArrearsActual',
                ];
                continue;
            }
            if (in_array($field, ['grossPay', 'deductions', 'netPay', 'pfEmployee', 'pfEmployer', 'esicEmployee', 'esicEmployer', 'profTax'], true)) {
                $paths = [...$paths, $field];
                continue;
            }
            throw ValidationException::withMessages([
                'changedFields' => ["Unsupported payroll draft field: {$field}. Reload and update a supported field."],
            ]);
        }

        foreach (array_unique($removePaths) as $path) Arr::forget($saved, $path);
        foreach (array_unique($paths) as $path) {
            if (Arr::has($incoming, $path)) Arr::set($saved, $path, Arr::get($incoming, $path));
        }
        return $saved;
    }

    private function mergeSnapshot(array $saved, array $incoming): array
    {
        foreach ($incoming as $key => $value) {
            if ($value === null) continue;
            if (is_array($value) && ! array_is_list($value) && is_array($saved[$key] ?? null) && ! array_is_list($saved[$key])) {
                $saved[$key] = $this->mergeSnapshot($saved[$key], $value);
            } else {
                $saved[$key] = $value;
            }
        }
        return $saved;
    }

    private function diffSnapshot(array $before, array $after, string $path = ''): array
    {
        $changes = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            $name = $path === '' ? (string) $key : $path.'.'.$key;
            $old = $before[$key] ?? null;
            $new = $after[$key] ?? null;
            if (is_array($old) && is_array($new) && ! array_is_list($old) && ! array_is_list($new)) {
                $changes += $this->diffSnapshot($old, $new, $name);
            } elseif ($old !== $new) {
                $changes[$name] = ['previous' => $old, 'new' => $new];
            }
        }
        return $changes;
    }

    /** @return array<string, mixed> */
    private function formatDraft(HrmsPayrollDraft $draft): array
    {
        return [
            'id' => $draft->id,
            'companyId' => $draft->company_id,
            'payrollMonth' => (int) $draft->payroll_month,
            'payrollYear' => (int) $draft->payroll_year,
            'status' => $draft->status,
            'version' => (int) $draft->version,
            'createdBy' => $draft->created_by,
            'updatedBy' => $draft->updated_by,
            'createdAt' => $draft->created_at?->toIso8601String(),
            'updatedAt' => $draft->updated_at?->toIso8601String(),
            'finalizedAt' => $draft->finalized_at?->toIso8601String(),
            'finalizedPeriodId' => $draft->finalized_period_id,
            'employeeCount' => $draft->employees()->count(),
        ];
    }

    /** @return array<string, mixed> */
    private function formatEmployee(HrmsPayrollDraftEmployee $row): array
    {
        return [
            'id' => $row->id,
            'payrollDraftId' => $row->payroll_draft_id,
            'employeeUserId' => $row->employee_user_id,
            'employeeCode' => $row->employee_code,
            'payrollMasterId' => $row->payroll_master_id,
            'payDays' => $row->pay_days,
            'grossPay' => $row->gross_pay,
            'totalEarnings' => $row->total_earnings,
            'totalDeductions' => $row->total_deductions,
            'totalArrears' => $row->total_arrears,
            'netPay' => $row->net_pay,
            'remarks' => $row->remarks,
            'rowPayload' => $row->row_payload,
            'version' => (int) $row->version,
            'updatedAt' => $row->updated_at?->toIso8601String(),
        ];
    }
}
