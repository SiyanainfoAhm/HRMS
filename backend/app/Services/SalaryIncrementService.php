<?php

namespace App\Services;

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsSalaryIncrement;
use App\Support\IncrementMonth;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class SalaryIncrementService
{
    public function __construct(
        private readonly PayrollMasterService $payrollMasterService,
    ) {}

    /**
     * @return array{
     *   employees: list<array<string, mixed>>,
     *   payrollPeriodExists: bool,
     *   payrollPeriodWarning: string|null
     * }
     */
    public function listEligibleEmployees(
        string $companyId,
        string $incrementMonth,
        int $year,
        string $effectiveStartDate,
        ?float $defaultIncrementPercentage = null,
    ): array {
        $month = $this->assertIncrementMonth($incrementMonth);
        $this->assertEffectiveDateMatchesMonth($month, $effectiveStartDate, $year);

        $employees = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->where('increment_month', $month)
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', 'active');
            })
            ->orderBy('employee_code')
            ->orderBy('name')
            ->get()
            ->map(function (HrmsPayrollMaster $master) use ($defaultIncrementPercentage, $effectiveStartDate) {
                $userId = $master->user_id ?? $master->employee_user_id;
                $currentGross = (float) ($master->gross_basic_pay ?? $master->gross_basic ?? $master->gross_salary ?? 0);
                $pct = $defaultIncrementPercentage;
                $newGross = $pct !== null && $pct > 0
                    ? IncrementMonth::calculateNewGrossBasic($currentGross, $pct)
                    : null;
                $alreadyApplied = $this->hasExistingIncrement($master->company_id, $userId, $effectiveStartDate);

                return [
                    'masterId' => $master->id,
                    'employeeId' => $master->employee_id,
                    'employeeUserId' => $userId,
                    'employeeCode' => $master->employee_code,
                    'name' => $master->name,
                    'designation' => $master->designation,
                    'department' => $master->department,
                    'incrementMonth' => $master->increment_month ?? IncrementMonth::DEFAULT,
                    'currentGrossBasic' => $currentGross,
                    'incrementPercentage' => $pct,
                    'incrementAmount' => $newGross !== null ? round($newGross - $currentGross) : null,
                    'newGrossBasic' => $newGross,
                    'effectiveStartDate' => $effectiveStartDate,
                    'alreadyApplied' => $alreadyApplied,
                    'duplicateMessage' => $alreadyApplied
                        ? 'Increment already applied for this employee and effective date.'
                        : null,
                ];
            })
            ->values()
            ->all();

        $payrollPeriodExists = $this->payrollExistsForDate($companyId, $effectiveStartDate);

        return [
            'employees' => $employees,
            'payrollPeriodExists' => $payrollPeriodExists,
            'payrollPeriodWarning' => $payrollPeriodExists
                ? 'Payroll for this period already exists. Applying increment may require regeneration.'
                : null,
        ];
    }

    /**
     * @param  list<array{employeeUserId?: string|null, masterId?: string|null, incrementPercentage?: float|null}>  $selectedEmployees
     * @return array{
     *   applied: int,
     *   skipped: int,
     *   failed: int,
     *   results: list<array<string, mixed>>,
     *   payrollPeriodWarning: string|null
     * }
     */
    public function applyIncrement(
        string $companyId,
        string $appliedBy,
        string $incrementMonth,
        int $year,
        string $effectiveStartDate,
        float $defaultIncrementPercentage,
        array $selectedEmployees,
        bool $confirmPayrollOverwrite = false,
    ): array {
        $month = $this->assertIncrementMonth($incrementMonth);
        $this->assertEffectiveDateMatchesMonth($month, $effectiveStartDate, $year);

        if ($defaultIncrementPercentage <= 0) {
            throw ValidationException::withMessages([
                'defaultIncrementPercentage' => ['Increment percentage must be greater than 0.'],
            ]);
        }

        if ($selectedEmployees === []) {
            throw ValidationException::withMessages([
                'employees' => ['Select at least one employee.'],
            ]);
        }

        $payrollPeriodExists = $this->payrollExistsForDate($companyId, $effectiveStartDate);
        if ($payrollPeriodExists && ! $confirmPayrollOverwrite) {
            throw ValidationException::withMessages([
                'confirmPayrollOverwrite' => [
                    'Payroll for this period already exists. Applying increment may require regeneration.',
                ],
            ]);
        }

        $applied = 0;
        $skipped = 0;
        $failed = 0;
        $results = [];

        foreach ($selectedEmployees as $entry) {
            $masterId = $entry['masterId'] ?? null;
            $employeeUserId = $entry['employeeUserId'] ?? null;
            $pct = isset($entry['incrementPercentage']) && $entry['incrementPercentage'] !== null
                ? (float) $entry['incrementPercentage']
                : $defaultIncrementPercentage;

            if ($pct <= 0) {
                $failed++;
                $results[] = [
                    'employeeUserId' => $employeeUserId,
                    'status' => 'failed',
                    'message' => 'Increment percentage must be greater than 0.',
                ];
                continue;
            }

            try {
                DB::transaction(function () use (
                    $companyId,
                    $appliedBy,
                    $month,
                    $year,
                    $effectiveStartDate,
                    $masterId,
                    $employeeUserId,
                    $pct,
                    &$applied,
                    &$skipped,
                    &$failed,
                    &$results,
                ) {
                    $master = null;
                    if ($masterId) {
                        $master = HrmsPayrollMaster::query()
                            ->where('company_id', $companyId)
                            ->where('id', $masterId)
                            ->whereNull('effective_to')
                            ->lockForUpdate()
                            ->first();
                    }
                    if (! $master && $employeeUserId) {
                        $master = HrmsPayrollMaster::query()
                            ->where('company_id', $companyId)
                            ->whereNull('effective_to')
                            ->where(function ($q) use ($employeeUserId) {
                                $q->where('employee_user_id', $employeeUserId)->orWhere('user_id', $employeeUserId);
                            })
                            ->lockForUpdate()
                            ->first();
                    }

                    if (! $master) {
                        $failed++;
                        $results[] = [
                            'employeeUserId' => $employeeUserId,
                            'status' => 'failed',
                            'message' => 'Employee payroll master not found.',
                        ];

                        return;
                    }

                    $userId = $master->user_id ?? $master->employee_user_id;
                    if ($this->hasExistingIncrement($companyId, $userId, $effectiveStartDate)) {
                        $skipped++;
                        $results[] = [
                            'employeeUserId' => $userId,
                            'employeeCode' => $master->employee_code,
                            'status' => 'skipped',
                            'message' => IncrementMonth::duplicateMessage($month, $year),
                        ];

                        return;
                    }

                    $oldGross = (float) ($master->gross_basic_pay ?? $master->gross_basic ?? $master->gross_salary ?? 0);
                    if ($oldGross <= 0) {
                        $failed++;
                        $results[] = [
                            'employeeUserId' => $userId,
                            'status' => 'failed',
                            'message' => 'Gross basic pay must be greater than 0.',
                        ];

                        return;
                    }

                    $newGross = IncrementMonth::calculateNewGrossBasic($oldGross, $pct);
                    $incrementAmount = round($newGross - $oldGross);

                    $reason = sprintf('Salary increment %.2f%% effective %s', $pct, $effectiveStartDate);
                    $revisionPayload = [
                        'gross_basic_pay' => $newGross,
                        'grossBasicPay' => $newGross,
                        'effective_from' => $effectiveStartDate,
                        'effectiveFrom' => $effectiveStartDate,
                        'reason_for_change' => $reason,
                        'reasonForChange' => $reason,
                        'increment_month' => $master->increment_month ?? IncrementMonth::DEFAULT,
                        'incrementMonth' => $master->increment_month ?? IncrementMonth::DEFAULT,
                    ];

                    $this->payrollMasterService->reviseMasterRecord(
                        $master,
                        $revisionPayload,
                        $companyId,
                        $appliedBy,
                        $reason,
                    );

                    if (Schema::hasTable('cirt_salary_increments')) {
                        HrmsSalaryIncrement::create([
                            'id' => (string) Str::uuid(),
                            'company_id' => $companyId,
                            'employee_id' => $master->employee_id,
                            'employee_user_id' => $userId,
                            'employee_code' => $master->employee_code,
                            'increment_month' => $month,
                            'effective_start_date' => $effectiveStartDate,
                            'old_gross_basic' => $oldGross,
                            'increment_percentage' => $pct,
                            'increment_amount' => $incrementAmount,
                            'new_gross_basic' => $newGross,
                            'applied_by' => $appliedBy,
                            'applied_at' => now(),
                            'status' => 'applied',
                            'notes' => $reason,
                        ]);
                    }

                    $applied++;
                    $results[] = [
                        'employeeUserId' => $userId,
                        'employeeCode' => $master->employee_code,
                        'status' => 'applied',
                        'oldGrossBasic' => $oldGross,
                        'newGrossBasic' => $newGross,
                        'incrementPercentage' => $pct,
                    ];
                });
            } catch (QueryException $e) {
                $failed++;
                $results[] = [
                    'employeeUserId' => $employeeUserId,
                    'status' => 'failed',
                    'message' => $this->friendlyIncrementFailureMessage($e),
                ];
            } catch (Throwable $e) {
                $failed++;
                $results[] = [
                    'employeeUserId' => $employeeUserId,
                    'status' => 'failed',
                    'message' => $this->friendlyIncrementFailureMessage($e),
                ];
            }
        }

        return [
            'applied' => $applied,
            'skipped' => $skipped,
            'failed' => $failed,
            'results' => $results,
            'message' => $failed > 0 && $applied === 0
                ? ($results[0]['message'] ?? 'Failed to apply salary increment.')
                : null,
            'payrollPeriodWarning' => $payrollPeriodExists
                ? 'Payroll for this period already exists. Applying increment may require regeneration.'
                : null,
        ];
    }

    private function friendlyIncrementFailureMessage(Throwable $e): string
    {
        $raw = $e->getMessage();
        if (
            str_contains($raw, 'ux_cirt_payroll_master_one_current')
            || str_contains($raw, 'SQLSTATE[23505]')
            || str_contains($raw, 'duplicate key')
        ) {
            return 'Could not apply increment for this employee because an active payroll master already exists. Please refresh and try again.';
        }

        if (str_contains($raw, 'SQLSTATE[')) {
            return 'Could not apply salary increment for this employee. Please try again or contact support.';
        }

        $clean = trim($raw);
        if ($clean === '' || strlen($clean) > 180) {
            return 'Could not apply salary increment for this employee. Please try again or contact support.';
        }

        return $clean;
    }

    /**
     * @return array{increments: list<array<string, mixed>>}
     */
    public function listHistory(
        string $companyId,
        ?string $incrementMonth = null,
        ?int $year = null,
        ?string $employeeUserId = null,
    ): array {
        if (! Schema::hasTable('cirt_salary_increments')) {
            return ['increments' => []];
        }

        $query = HrmsSalaryIncrement::query()
            ->where('company_id', $companyId)
            ->orderByDesc('effective_start_date')
            ->orderByDesc('applied_at');

        if ($incrementMonth) {
            $month = $this->assertIncrementMonth($incrementMonth);
            $query->where('increment_month', $month);
        }

        if ($year !== null) {
            $query->whereYear('effective_start_date', $year);
        }

        if ($employeeUserId) {
            $query->where('employee_user_id', $employeeUserId);
        }

        $increments = $query->get()->map(fn (HrmsSalaryIncrement $row) => [
            'id' => $row->id,
            'employeeId' => $row->employee_id,
            'employeeUserId' => $row->employee_user_id,
            'employeeCode' => $row->employee_code,
            'incrementMonth' => $row->increment_month,
            'effectiveStartDate' => $row->effective_start_date?->toDateString(),
            'oldGrossBasic' => (float) $row->old_gross_basic,
            'incrementPercentage' => (float) $row->increment_percentage,
            'incrementAmount' => (float) $row->increment_amount,
            'newGrossBasic' => (float) $row->new_gross_basic,
            'appliedBy' => $row->applied_by,
            'appliedAt' => $row->applied_at?->toIso8601String(),
            'status' => $row->status,
            'notes' => $row->notes,
        ])->values()->all();

        return ['increments' => $increments];
    }

    private function assertIncrementMonth(string $month): string
    {
        $normalized = IncrementMonth::normalize($month);
        if ($normalized === null) {
            throw ValidationException::withMessages([
                'incrementMonth' => ['Increment month must be January or July.'],
            ]);
        }

        return $normalized;
    }

    private function assertEffectiveDateMatchesMonth(string $month, string $effectiveStartDate, int $year): void
    {
        if (! IncrementMonth::effectiveDateMatchesMonth($month, $effectiveStartDate)) {
            throw ValidationException::withMessages([
                'effectiveStartDate' => ['Effective date must be in the selected increment month.'],
            ]);
        }

        $parsedYear = (int) Carbon::parse($effectiveStartDate)->year;
        if ($parsedYear !== $year) {
            throw ValidationException::withMessages([
                'year' => ['Effective date year must match the selected year.'],
            ]);
        }
    }

    private function hasExistingIncrement(?string $companyId, ?string $employeeUserId, string $effectiveStartDate): bool
    {
        if (! $companyId || ! $employeeUserId || ! Schema::hasTable('cirt_salary_increments')) {
            return false;
        }

        return HrmsSalaryIncrement::query()
            ->where('company_id', $companyId)
            ->where('employee_user_id', $employeeUserId)
            ->whereDate('effective_start_date', $effectiveStartDate)
            ->exists();
    }

    private function payrollExistsForDate(string $companyId, string $date): bool
    {
        if (! Schema::hasTable('cirt_payroll_periods')) {
            return false;
        }

        return HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereDate('period_start', '<=', $date)
            ->whereDate('period_end', '>=', $date)
            ->exists();
    }
}
