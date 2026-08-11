<?php

namespace App\Services;

use App\Models\HrmsPayrollDraft;
use App\Models\HrmsPayrollDraftEmployee;
use App\Models\HrmsPayslip;
use App\Models\HrmsPayrollPeriod;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PayrollDraftService
{
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

        $employees = $draft->employees()
            ->orderBy('employee_code')
            ->get()
            ->map(fn (HrmsPayrollDraftEmployee $row) => $this->formatEmployee($row))
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

            if ($draft && $expectedVersion !== null && (int) $draft->version !== (int) $expectedVersion) {
                throw ValidationException::withMessages([
                    'version' => [
                        'Draft was updated by another session (version conflict). Reload and try again.',
                    ],
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

                $attrs = [
                    'employee_code' => $row['employeeCode'] ?? $row['employee_code'] ?? ($payload['employeeCode'] ?? $payload['employee_code'] ?? null),
                    'payroll_master_id' => $row['payrollMasterId'] ?? $row['payroll_master_id'] ?? ($payload['payrollMasterId'] ?? $payload['payroll_master_id'] ?? null),
                    'pay_days' => $this->num($row['payDays'] ?? $row['pay_days'] ?? ($payload['payDays'] ?? $payload['pay_days'] ?? null)),
                    'gross_pay' => $this->num($row['grossPay'] ?? $row['gross_pay'] ?? ($payload['grossPay'] ?? $payload['gross_pay'] ?? null)),
                    'total_earnings' => $this->num($row['totalEarnings'] ?? $row['total_earnings'] ?? null),
                    'total_deductions' => $this->num($row['totalDeductions'] ?? $row['total_deductions'] ?? ($payload['deductions'] ?? null)),
                    'total_arrears' => $this->num($row['totalArrears'] ?? $row['total_arrears'] ?? null),
                    'net_pay' => $this->num($row['netPay'] ?? $row['net_pay'] ?? ($payload['netPay'] ?? $payload['net_pay'] ?? null)),
                    'remarks' => is_string($remarks) ? $remarks : null,
                    'row_payload' => $payload,
                    'version' => $existing ? ((int) $existing->version + 1) : 1,
                ];

                // Prefer government monthly totals when present (camel or snake keys).
                $gm = $payload['governmentMonthly'] ?? $payload['government_monthly'] ?? null;
                if (is_array($gm)) {
                    $attrs['total_earnings'] = $this->num($gm['totalEarnings'] ?? $gm['total_earnings'] ?? $attrs['total_earnings'] ?? $attrs['gross_pay']);
                    $attrs['total_deductions'] = $this->num($gm['totalDeductions'] ?? $gm['total_deductions'] ?? $attrs['total_deductions']);
                    $attrs['net_pay'] = $this->num($gm['netSalary'] ?? $gm['net_salary'] ?? $attrs['net_pay']);
                    $daArr = (float) ($gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? 0);
                    $trArr = (float) ($gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? 0);
                    $grossArr = (float) ($gm['grossArrear'] ?? $gm['gross_arrear'] ?? 0);
                    $attrs['total_arrears'] = round($daArr + $trArr + $grossArr, 2);
                } elseif ($attrs['total_earnings'] === null && $attrs['gross_pay'] !== null) {
                    $attrs['total_earnings'] = $attrs['gross_pay'];
                }

                if ($attrs['total_arrears'] === null) {
                    $daArr = (float) ($payload['daArrear'] ?? $payload['da_arrear'] ?? 0);
                    $trArr = (float) ($payload['transportArrear'] ?? $payload['transport_arrear'] ?? 0);
                    $grossArr = (float) ($payload['grossArrear'] ?? $payload['gross_arrear'] ?? 0);
                    $attrs['total_arrears'] = round($daArr + $trArr + $grossArr, 2);
                }

                if ($existing) {
                    $existing->update($attrs);
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

            if ($replaceAllEmployees && $seenUserIds !== []) {
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

            if (count($employees) !== $expectedCount) {
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
                'expectedEmployeeCount' => $expectedCount,
                'savedEmployeeCount' => $saved,
                'distinctEmployeeCount' => $distinctCount,
            ];
        });
    }

    /**
     * Discard draft (soft status) or delete for reset.
     */
    public function resetDraft(string $companyId, int $year, int $month, string $userId): array
    {
        $this->assertPeriod($year, $month);

        if ($this->isMonthFinalized($companyId, $year, $month)) {
            throw ValidationException::withMessages([
                'period' => ['This payroll month is already finalized.'],
            ]);
        }

        $draft = HrmsPayrollDraft::query()
            ->where('company_id', $companyId)
            ->where('payroll_year', $year)
            ->where('payroll_month', $month)
            ->where('status', HrmsPayrollDraft::STATUS_DRAFT)
            ->first();

        if (! $draft) {
            return ['deleted' => false, 'message' => 'No draft to reset.'];
        }

        $draft->update([
            'status' => HrmsPayrollDraft::STATUS_DISCARDED,
            'updated_by' => $userId,
            'version' => (int) $draft->version + 1,
        ]);

        return ['deleted' => true, 'message' => 'Draft discarded.'];
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

        return round((float) $v, 2);
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
