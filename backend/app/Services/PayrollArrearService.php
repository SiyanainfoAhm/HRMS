<?php

namespace App\Services;

use App\Models\HrmsDaRevisionEvent;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollArrearBatch;
use App\Models\HrmsPayrollArrearLine;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * DA + transport DA arrears when institute DA% is revised retroactively.
 * Excel formula: ROUND(basic * DA% / 100), ROUND(transport_base + transport_base * DA% / 100).
 */
final class PayrollArrearService
{
    public const DEFAULT_CPF_RATE = 0.12;

    public function __construct(
        private readonly PayrollCalculationService $calculator,
    ) {}

    public function createRevisionEvent(
        string $companyId,
        float $oldDa,
        float $newDa,
        string $effectiveFrom,
        ?string $reason,
        ?string $createdBy,
    ): HrmsDaRevisionEvent {
        return HrmsDaRevisionEvent::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'old_da_percent' => $oldDa,
            'new_da_percent' => $newDa,
            'effective_from' => $effectiveFrom,
            'revision_reason' => $reason,
            'created_by' => $createdBy,
        ]);
    }

    /**
     * @return list<HrmsDaRevisionEvent>
     */
    public function detectPendingDaArrears(string $companyId, int $runYear, int $runMonth): array
    {
        $runStart = Carbon::create($runYear, $runMonth, 1)->startOfDay();

        $candidates = HrmsDaRevisionEvent::query()
            ->where('company_id', $companyId)
            ->whereDate('effective_from', '<', $runStart->toDateString())
            ->orderByDesc('created_at')
            ->get()
            ->filter(fn (HrmsDaRevisionEvent $e) => $this->arrearPeriodForRevision(
                $e->effective_from->format('Y-m-d'),
                $runYear,
                $runMonth,
            ) !== null);

        return $this->dedupeRevisionEventsByTransition($candidates);
    }

    /**
     * When DA settings are saved repeatedly, only the latest revision event per
     * effective-from + old/new DA transition should drive draft arrears.
     *
     * @param  iterable<object>  $events
     * @return list<object>
     */
    public function dedupeRevisionEventsByTransition(iterable $events): array
    {
        $list = is_array($events) ? $events : iterator_to_array($events);
        usort($list, static function ($a, $b): int {
            $aTime = $a->created_at ?? null;
            $bTime = $b->created_at ?? null;
            if ($aTime == $bTime) {
                return 0;
            }

            return ($aTime < $bTime) ? 1 : -1;
        });

        $byTransition = [];

        foreach ($list as $event) {
            $key = sprintf(
                '%s|%s|%s',
                $event->effective_from->format('Y-m-d'),
                number_format((float) $event->old_da_percent, 2, '.', ''),
                number_format((float) $event->new_da_percent, 2, '.', ''),
            );

            if (! isset($byTransition[$key])) {
                $byTransition[$key] = $event;
            }
        }

        return array_values($byTransition);
    }

    /**
     * DA arrears are always scoped to the selected payroll run month (Run Payroll screen),
     * never the real-world calendar month.
     *
     * @return array{from: Carbon, to: Carbon}|null
     */
    public function arrearPeriodForRevision(string $effectiveFrom, int $selectedPayrollYear, int $selectedPayrollMonth): ?array
    {
        if ($selectedPayrollYear < 2000 || $selectedPayrollMonth < 1 || $selectedPayrollMonth > 12) {
            return null;
        }

        $selectedPayrollStart = Carbon::create($selectedPayrollYear, $selectedPayrollMonth, 1)->startOfDay();
        $effectiveStart = Carbon::parse($effectiveFrom)->startOfMonth();

        if ($effectiveStart->greaterThanOrEqualTo($selectedPayrollStart)) {
            return null;
        }

        return [
            'from' => $effectiveStart,
            'to' => $selectedPayrollStart->copy()->subMonth()->endOfMonth(),
        ];
    }

    /**
     * True when arrear month is on/after DA effective month and strictly before selected payroll month.
     */
    public function isArrearMonthEligible(
        int $arrearYear,
        int $arrearMonth,
        Carbon $effectiveStart,
        int $selectedPayrollYear,
        int $selectedPayrollMonth,
    ): bool {
        $arrearMonthStart = Carbon::create($arrearYear, $arrearMonth, 1)->startOfMonth();
        $selectedPayrollStart = Carbon::create($selectedPayrollYear, $selectedPayrollMonth, 1)->startOfMonth();

        return $arrearMonthStart->greaterThanOrEqualTo($effectiveStart)
            && $arrearMonthStart->lessThan($selectedPayrollStart);
    }

    /**
     * @return list<Carbon>
     */
    public function monthsInArrearPeriod(Carbon $from, Carbon $to): array
    {
        $months = [];
        $cursor = $from->copy()->startOfMonth();
        $end = $to->copy()->startOfMonth();

        while ($cursor->lessThanOrEqualTo($end)) {
            $months[] = $cursor->copy();
            $cursor->addMonth();
        }

        return $months;
    }

    /**
     * Finalized payroll periods between DA effective month and the month before selected payroll.
     *
     * @return list<HrmsPayrollPeriod>
     */
    public function eligiblePayrollPeriodsInArrearRange(
        string $companyId,
        Carbon $arrearFrom,
        Carbon $arrearTo,
    ): array {
        return HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereDate('period_start', '>=', $arrearFrom->copy()->startOfMonth()->toDateString())
            ->whereDate('period_start', '<=', $arrearTo->copy()->startOfMonth()->toDateString())
            ->orderBy('period_start')
            ->get()
            ->all();
    }

    public function countEligibleArrearMonths(Carbon $from, Carbon $to): int
    {
        return count($this->monthsInArrearPeriod($from, $to));
    }

    /**
     * @return array{
     *   basic: float,
     *   transport_base: float,
     *   old_da_percent: float,
     *   new_da_percent: float,
     *   old_da_amount: float,
     *   new_da_amount: float,
     *   da_arrear: float,
     *   old_transport_amount: float,
     *   new_transport_amount: float,
     *   transport_arrear: float,
     *   gross_arrear: float,
     *   cpf_rate: float,
     *   cpf_arrear: float,
     *   net_arrear: float,
     * }
     */
    public function calculateMonthArrear(
        float $basic,
        float $transportBase,
        float $oldDaPercent,
        float $newDaPercent,
        float $cpfRate = self::DEFAULT_CPF_RATE,
    ): array {
        $oldDa = round($basic * $oldDaPercent / 100, 0);
        $newDa = round($basic * $newDaPercent / 100, 0);
        $daArrear = $newDa - $oldDa;

        $oldTrpt = round($transportBase + ($transportBase * $oldDaPercent / 100), 0);
        $newTrpt = round($transportBase + ($transportBase * $newDaPercent / 100), 0);
        $trptArrear = $newTrpt - $oldTrpt;

        $grossArrear = $daArrear + $trptArrear;
        $cpfArrear = $grossArrear * $cpfRate;
        $netArrear = $grossArrear - $cpfArrear;

        return [
            'basic' => $basic,
            'transport_base' => $transportBase,
            'old_da_percent' => $oldDaPercent,
            'new_da_percent' => $newDaPercent,
            'old_da_amount' => (float) $oldDa,
            'new_da_amount' => (float) $newDa,
            'da_arrear' => (float) $daArrear,
            'old_transport_amount' => (float) $oldTrpt,
            'new_transport_amount' => (float) $newTrpt,
            'transport_arrear' => (float) $trptArrear,
            'gross_arrear' => (float) $grossArrear,
            'cpf_rate' => $cpfRate * 100,
            'cpf_arrear' => (float) $cpfArrear,
            'net_arrear' => (float) $netArrear,
        ];
    }

    /**
     * @return array{
     *   lines: list<array<string, mixed>>,
     *   warnings: list<string>,
     *   totals: array<string, float>,
     * }
     */
    public function calculateDaArrearsForRevision(
        HrmsDaRevisionEvent $event,
        string $companyId,
        int $runYear,
        int $runMonth,
    ): array {
        $period = $this->arrearPeriodForRevision($event->effective_from->format('Y-m-d'), $runYear, $runMonth);
        if ($period === null) {
            return ['lines' => [], 'warnings' => [], 'totals' => $this->emptyTotals()];
        }

        $lines = [];
        $warnings = [];
        $totals = $this->emptyTotals();

        $eligiblePeriods = $this->eligiblePayrollPeriodsInArrearRange(
            $companyId,
            $period['from'],
            $period['to'],
        );

        $employeeIds = $this->collectEmployeeUserIdsForArrearCalculation($companyId, $eligiblePeriods);
        $newDaPercent = (float) $event->new_da_percent;
        $revisionOldDa = (float) $event->old_da_percent;

        foreach ($employeeIds as $employeeUserId) {
            foreach ($eligiblePeriods as $payrollPeriod) {
                $periodStart = $payrollPeriod->period_start;
                if ($periodStart === null) {
                    continue;
                }

                $y = (int) $periodStart->format('Y');
                $m = (int) $periodStart->format('n');

                if (! $this->isArrearMonthEligible($y, $m, $period['from'], $runYear, $runMonth)) {
                    continue;
                }

                if ($this->isArrearMonthAlreadyPaid(
                    (string) $employeeUserId,
                    $m,
                    $y,
                    $revisionOldDa,
                    $newDaPercent,
                )) {
                    continue;
                }

                $source = $this->resolveHistoricalMonthData(
                    $companyId,
                    (string) $employeeUserId,
                    $payrollPeriod,
                    $event,
                );
                if ($source === null) {
                    $warnings[] = sprintf(
                        'No finalized payroll for %s in %s-%02d — arrear skipped.',
                        $this->employeeLabel((string) $employeeUserId),
                        $y,
                        $m,
                    );
                    continue;
                }

                $oldDa = (float) ($source['old_da_percent'] ?? $revisionOldDa);
                if ($oldDa >= $newDaPercent - 0.001) {
                    continue;
                }

                $calc = $this->calculateMonthArrear(
                    (float) $source['basic'],
                    (float) $source['transport_base'],
                    $oldDa,
                    $newDaPercent,
                    (float) $source['cpf_rate'],
                );

                if (abs($calc['gross_arrear']) < 0.001) {
                    continue;
                }

                $line = array_merge($calc, [
                    'employee_user_id' => $employeeUserId,
                    'arrear_month' => $m,
                    'arrear_year' => $y,
                    'da_revision_event_id' => $event->id,
                    'source_monthly_payroll_id' => $source['monthly_payroll_id'] ?? null,
                    'old_payroll_master_id' => $source['payroll_master_id'] ?? null,
                    'new_payroll_master_id' => $source['new_payroll_master_id'] ?? null,
                    'used_fallback' => $source['used_fallback'] ?? false,
                ]);

                if ($source['used_fallback'] ?? false) {
                    $warnings[] = sprintf(
                        'Arrear for %s %s-%02d used payroll master fallback (no finalized monthly detail).',
                        $this->employeeLabel((string) $employeeUserId),
                        $y,
                        $m,
                    );
                }

                $lines[] = $line;
                $totals['total_da_arrear'] += $calc['da_arrear'];
                $totals['total_transport_arrear'] += $calc['transport_arrear'];
                $totals['total_gross_arrear'] += $calc['gross_arrear'];
                $totals['total_cpf_arrear'] += $calc['cpf_arrear'];
                $totals['total_net_arrear'] += $calc['net_arrear'];
            }
        }

        return ['lines' => $lines, 'warnings' => $warnings, 'totals' => $totals];
    }

    /**
     * @param  list<HrmsPayrollPeriod>  $eligiblePeriods
     * @return list<string>
     */
    private function collectEmployeeUserIdsForArrearCalculation(string $companyId, array $eligiblePeriods): array
    {
        $ids = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->whereNull('effective_end_date')
            ->get()
            ->map(fn (HrmsPayrollMaster $m) => $m->employee_user_id ?? $m->user_id)
            ->filter();

        foreach ($eligiblePeriods as $period) {
            $ids = $ids->merge(
                HrmsPayslip::query()
                    ->where('payroll_period_id', $period->id)
                    ->where('company_id', $companyId)
                    ->pluck('employee_user_id'),
            );
        }

        return $ids->unique()->filter()->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function generateOrUpdateDraftArrearBatch(
        string $companyId,
        int $runYear,
        int $runMonth,
        ?string $payrollPeriodId = null,
    ): array {
        return DB::transaction(function () use ($companyId, $runYear, $runMonth, $payrollPeriodId) {
            $events = $this->detectPendingDaArrears($companyId, $runYear, $runMonth);
            $activeRevisionIds = array_map(static fn (HrmsDaRevisionEvent $e) => $e->id, $events);

            $this->purgeSupersededDraftBatches($companyId, $runYear, $runMonth, $activeRevisionIds);
            $this->purgeDuplicateDraftLinesForRun($companyId, $runYear, $runMonth);

            $batches = [];
            $allWarnings = [];
            $employeeTotals = [];

            foreach ($events as $event) {
                $period = $this->arrearPeriodForRevision($event->effective_from->format('Y-m-d'), $runYear, $runMonth);
                if ($period === null) {
                    continue;
                }

                $calc = $this->calculateDaArrearsForRevision($event, $companyId, $runYear, $runMonth);
                $allWarnings = array_merge($allWarnings, $calc['warnings']);

                $existingBatch = HrmsPayrollArrearBatch::query()
                    ->where('company_id', $companyId)
                    ->where('da_revision_event_id', $event->id)
                    ->where('run_year', $runYear)
                    ->where('run_month', $runMonth)
                    ->lockForUpdate()
                    ->first();

                if ($existingBatch?->isFinalized()) {
                    $existingBatch->load(['revisionEvent', 'lines']);
                    $batches[] = $existingBatch;
                    $employeeTotals = $this->mergeEmployeeTotals(
                        $employeeTotals,
                        $this->aggregateLinesToEmployeeTotals($existingBatch->lines->all()),
                    );

                    continue;
                }

                if ($existingBatch) {
                    HrmsPayrollArrearLine::where('arrear_batch_id', $existingBatch->id)->delete();
                    $existingBatch->update([
                        'payroll_period_id' => $payrollPeriodId,
                        'arrear_from' => $period['from']->toDateString(),
                        'arrear_to' => $period['to']->toDateString(),
                        'status' => 'draft',
                        'total_da_arrear' => $calc['totals']['total_da_arrear'],
                        'total_transport_arrear' => $calc['totals']['total_transport_arrear'],
                        'total_gross_arrear' => $calc['totals']['total_gross_arrear'],
                        'total_cpf_arrear' => $calc['totals']['total_cpf_arrear'],
                        'total_net_arrear' => $calc['totals']['total_net_arrear'],
                    ]);
                    $batch = $existingBatch;
                } else {
                    $batch = HrmsPayrollArrearBatch::create([
                        'id' => (string) Str::uuid(),
                        'company_id' => $companyId,
                        'payroll_period_id' => $payrollPeriodId,
                        'da_revision_event_id' => $event->id,
                        'run_month' => $runMonth,
                        'run_year' => $runYear,
                        'arrear_from' => $period['from']->toDateString(),
                        'arrear_to' => $period['to']->toDateString(),
                        'status' => 'draft',
                        'total_da_arrear' => $calc['totals']['total_da_arrear'],
                        'total_transport_arrear' => $calc['totals']['total_transport_arrear'],
                        'total_gross_arrear' => $calc['totals']['total_gross_arrear'],
                        'total_cpf_arrear' => $calc['totals']['total_cpf_arrear'],
                        'total_net_arrear' => $calc['totals']['total_net_arrear'],
                    ]);
                }

                foreach ($calc['lines'] as $line) {
                    $this->upsertArrearLine($batch->id, (string) $event->id, $payrollPeriodId, $line);
                    $employeeTotals = $this->mergeCalcLineIntoEmployeeTotals($employeeTotals, $line);
                }

                $batches[] = $batch->load('revisionEvent');
            }

            return [
                'batches' => $batches,
                'warnings' => array_values(array_unique($allWarnings)),
                'employeeTotals' => $this->dedupeEmployeeTotals($employeeTotals),
            ];
        });
    }

  /**
   * @return array<string, mixed>
   */
    public function getEmployeeArrearTotalsForRun(
        string $companyId,
        int $runYear,
        int $runMonth,
        ?string $payrollPeriodId = null,
    ): array {
        $finalized = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('run_year', $runYear)
            ->where('run_month', $runMonth)
            ->when($payrollPeriodId, fn ($q) => $q->where('payroll_period_id', $payrollPeriodId))
            ->where('status', 'finalized')
            ->with('lines')
            ->get();

        if ($finalized->isNotEmpty()) {
            return $this->aggregateLinesToEmployeeTotals(
                $finalized->flatMap(fn ($b) => $b->lines)->all(),
            );
        }

        return $this->generateOrUpdateDraftArrearBatch($companyId, $runYear, $runMonth, $payrollPeriodId)['employeeTotals'];
    }

    public function attachArrearsToPayrollRun(HrmsPayrollPeriod $period): void
    {
        HrmsPayrollArrearBatch::query()
            ->where('company_id', $period->company_id)
            ->where('run_year', (int) $period->period_start?->year)
            ->where('run_month', (int) $period->period_start?->month)
            ->where('status', 'draft')
            ->update(['payroll_period_id' => $period->id]);

        HrmsPayrollArrearLine::query()
            ->whereIn('arrear_batch_id', HrmsPayrollArrearBatch::query()
                ->where('payroll_period_id', $period->id)
                ->pluck('id'))
            ->update(['payroll_period_id' => $period->id]);
    }

    public function finalizeArrears(HrmsPayrollPeriod $period): void
    {
        $batches = HrmsPayrollArrearBatch::query()
            ->where('payroll_period_id', $period->id)
            ->where('status', 'draft')
            ->get();

        foreach ($batches as $batch) {
            $batch->update(['status' => 'finalized']);
            HrmsPayrollArrearLine::where('arrear_batch_id', $batch->id)
                ->update(['is_locked' => true, 'payroll_period_id' => $period->id]);
        }
    }

    public function deleteDraftArrearsIfPayrollRunRegenerated(string $companyId, int $runYear, int $runMonth): void
    {
        $draftBatches = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('run_year', $runYear)
            ->where('run_month', $runMonth)
            ->where('status', 'draft')
            ->pluck('id');

        if ($draftBatches->isEmpty()) {
            return;
        }

        HrmsPayrollArrearLine::whereIn('arrear_batch_id', $draftBatches)->delete();
        HrmsPayrollArrearBatch::whereIn('id', $draftBatches)->delete();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function arrearHistoryForEmployee(string $employeeUserId): array
    {
        $lines = HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->with(['batch.revisionEvent', 'batch.payrollPeriod'])
            ->orderByDesc('arrear_year')
            ->orderByDesc('arrear_month')
            ->get();

        $grouped = [];
        foreach ($lines as $line) {
            $batch = $line->batch;
            if (! $batch) {
                continue;
            }
            $key = $batch->id;
            if (! isset($grouped[$key])) {
                $rev = $batch->revisionEvent;
                $grouped[$key] = [
                    'batchId' => $batch->id,
                    'revisionEffectiveFrom' => $rev?->effective_from?->format('Y-m-d'),
                    'oldDaPercent' => $rev?->old_da_percent,
                    'newDaPercent' => $rev?->new_da_percent,
                    'arrearFrom' => $batch->arrear_from?->format('Y-m-d'),
                    'arrearTo' => $batch->arrear_to?->format('Y-m-d'),
                    'includedInPayrollMonth' => $batch->payrollPeriod
                        ? sprintf('%04d-%02d', $batch->run_year, $batch->run_month)
                        : null,
                    'daArrear' => 0.0,
                    'transportArrear' => 0.0,
                    'grossArrear' => 0.0,
                    'cpfArrear' => 0.0,
                    'netArrear' => 0.0,
                    'status' => $batch->status,
                    'monthLines' => [],
                ];
            }
            $grouped[$key]['daArrear'] += (float) $line->da_arrear;
            $grouped[$key]['transportArrear'] += (float) $line->transport_arrear;
            $grouped[$key]['grossArrear'] += (float) $line->gross_arrear;
            $grouped[$key]['cpfArrear'] += (float) $line->cpf_arrear;
            $grouped[$key]['netArrear'] += (float) $line->net_arrear;
            $grouped[$key]['monthLines'][] = [
                'month' => sprintf('%04d-%02d', $line->arrear_year, $line->arrear_month),
                'basic' => $line->basic,
                'oldDaPercent' => $line->old_da_percent,
                'newDaPercent' => $line->new_da_percent,
                'oldDaAmount' => $line->old_da_amount,
                'newDaAmount' => $line->new_da_amount,
                'daArrear' => $line->da_arrear,
                'oldTransportAmount' => $line->old_transport_amount,
                'newTransportAmount' => $line->new_transport_amount,
                'transportArrear' => $line->transport_arrear,
                'grossArrear' => $line->gross_arrear,
                'cpfArrear' => $line->cpf_arrear,
                'netArrear' => $line->net_arrear,
            ];
        }

        return array_values($grouped);
    }

    /**
     * @return array<string, float>
     */
    private function emptyTotals(): array
    {
        return [
            'total_da_arrear' => 0.0,
            'total_transport_arrear' => 0.0,
            'total_gross_arrear' => 0.0,
            'total_cpf_arrear' => 0.0,
            'total_net_arrear' => 0.0,
        ];
    }

    /** @return array<string, mixed> */
    private function emptyEmployeeArrear(): array
    {
        return [
            'daArrear' => 0.0,
            'transportArrear' => 0.0,
            'grossArrear' => 0.0,
            'cpfArrear' => 0.0,
            'netArrear' => 0.0,
            'lines' => [],
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $base
     * @param  array<string, array<string, mixed>>  $add
     * @return array<string, array<string, mixed>>
     */
    private function mergeEmployeeTotals(array $base, array $add): array
    {
        foreach ($add as $uid => $totals) {
            if (! isset($base[$uid])) {
                $base[$uid] = $this->emptyEmployeeArrear();
            }
            $base[$uid]['daArrear'] += (float) ($totals['daArrear'] ?? 0);
            $base[$uid]['transportArrear'] += (float) ($totals['transportArrear'] ?? 0);
            $base[$uid]['grossArrear'] += (float) ($totals['grossArrear'] ?? 0);
            $base[$uid]['cpfArrear'] += (float) ($totals['cpfArrear'] ?? 0);
            $base[$uid]['netArrear'] += (float) ($totals['netArrear'] ?? 0);
            if (! empty($totals['lines']) && is_array($totals['lines'])) {
                $base[$uid]['lines'] = array_merge($base[$uid]['lines'], $totals['lines']);
            }
        }

        return $base;
    }

    /**
     * @param  array<string, array<string, mixed>>  $employeeTotals
     * @param  array<string, mixed>  $line
     * @return array<string, array<string, mixed>>
     */
    private function mergeCalcLineIntoEmployeeTotals(array $employeeTotals, array $line): array
    {
        $uid = (string) $line['employee_user_id'];
        if (! isset($employeeTotals[$uid])) {
            $employeeTotals[$uid] = $this->emptyEmployeeArrear();
        }
        $employeeTotals[$uid]['daArrear'] += $line['da_arrear'];
        $employeeTotals[$uid]['transportArrear'] += $line['transport_arrear'];
        $employeeTotals[$uid]['grossArrear'] += $line['gross_arrear'];
        $employeeTotals[$uid]['cpfArrear'] += $line['cpf_arrear'];
        $employeeTotals[$uid]['netArrear'] += $line['net_arrear'];
        $employeeTotals[$uid]['lines'][] = $line;

        return $employeeTotals;
    }

    /** @param  array<string, mixed>  $line */
    private function upsertArrearLine(
        string $batchId,
        string $revisionEventId,
        ?string $payrollPeriodId,
        array $line,
    ): HrmsPayrollArrearLine {
        $employeeUserId = (string) $line['employee_user_id'];
        $arrearYear = (int) $line['arrear_year'];
        $arrearMonth = (int) $line['arrear_month'];

        $existing = HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_year', $arrearYear)
            ->where('arrear_month', $arrearMonth)
            ->where('da_revision_event_id', $revisionEventId)
            ->first();

        if ($existing?->is_locked) {
            return $existing;
        }

        $attributes = [
            'arrear_batch_id' => $batchId,
            'da_revision_event_id' => $revisionEventId,
            'payroll_period_id' => $payrollPeriodId,
            'basic' => $line['basic'],
            'transport_base' => $line['transport_base'],
            'old_da_percent' => $line['old_da_percent'],
            'new_da_percent' => $line['new_da_percent'],
            'old_da_amount' => $line['old_da_amount'],
            'new_da_amount' => $line['new_da_amount'],
            'da_arrear' => $line['da_arrear'],
            'old_transport_amount' => $line['old_transport_amount'],
            'new_transport_amount' => $line['new_transport_amount'],
            'transport_arrear' => $line['transport_arrear'],
            'gross_arrear' => $line['gross_arrear'],
            'cpf_rate' => $line['cpf_rate'],
            'cpf_arrear' => $line['cpf_arrear'],
            'net_arrear' => $line['net_arrear'],
            'source_monthly_payroll_id' => $line['source_monthly_payroll_id'],
            'old_payroll_master_id' => $line['old_payroll_master_id'],
            'new_payroll_master_id' => $line['new_payroll_master_id'],
            'is_locked' => false,
        ];

        if ($existing) {
            $existing->update($attributes);

            return $existing->refresh();
        }

        return HrmsPayrollArrearLine::create(array_merge($attributes, [
            'id' => (string) Str::uuid(),
            'employee_user_id' => $employeeUserId,
            'arrear_month' => $arrearMonth,
            'arrear_year' => $arrearYear,
        ]));
    }

    /**
     * @param  list<string>  $activeRevisionIds
     */
    private function purgeSupersededDraftBatches(
        string $companyId,
        int $runYear,
        int $runMonth,
        array $activeRevisionIds,
    ): void {
        $query = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('run_year', $runYear)
            ->where('run_month', $runMonth)
            ->where('status', 'draft');

        if ($activeRevisionIds !== []) {
            $query->whereNotIn('da_revision_event_id', $activeRevisionIds);
        }

        $staleIds = $query->pluck('id');
        if ($staleIds->isEmpty()) {
            return;
        }

        HrmsPayrollArrearLine::whereIn('arrear_batch_id', $staleIds)->delete();
        HrmsPayrollArrearBatch::whereIn('id', $staleIds)->delete();
    }

    private function purgeDuplicateDraftLinesForRun(string $companyId, int $runYear, int $runMonth): void
    {
        $draftBatchIds = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('run_year', $runYear)
            ->where('run_month', $runMonth)
            ->where('status', 'draft')
            ->pluck('id');

        if ($draftBatchIds->isEmpty()) {
            return;
        }

        $lines = HrmsPayrollArrearLine::query()
            ->whereIn('arrear_batch_id', $draftBatchIds)
            ->where('is_locked', false)
            ->orderByDesc('created_at')
            ->get();

        $seen = [];
        foreach ($lines as $line) {
            $key = $this->arrearLineBusinessKey(
                (string) $line->employee_user_id,
                (int) $line->arrear_year,
                (int) $line->arrear_month,
                (float) $line->old_da_percent,
                (float) $line->new_da_percent,
            );

            if (isset($seen[$key])) {
                $line->delete();

                continue;
            }

            $seen[$key] = true;
        }
    }

    private function arrearLineBusinessKey(
        string $employeeUserId,
        int $arrearYear,
        int $arrearMonth,
        float $oldDaPercent,
        float $newDaPercent,
        string $revisionEventId = '',
    ): string {
        if ($revisionEventId !== '') {
            return sprintf(
                '%s|%d|%d|%s',
                $employeeUserId,
                $arrearYear,
                $arrearMonth,
                $revisionEventId,
            );
        }

        return sprintf(
            '%s|%d|%d|%s|%s',
            $employeeUserId,
            $arrearYear,
            $arrearMonth,
            number_format($oldDaPercent, 2, '.', ''),
            number_format($newDaPercent, 2, '.', ''),
        );
    }

    /**
     * @param  array<string, array<string, mixed>>  $employeeTotals
     * @return array<string, array<string, mixed>>
     */
    private function dedupeEmployeeTotals(array $employeeTotals): array
    {
        foreach ($employeeTotals as $uid => $totals) {
            $lines = is_array($totals['lines'] ?? null) ? $totals['lines'] : [];
            if ($lines === []) {
                continue;
            }

            $deduped = [];
            $sums = $this->emptyEmployeeArrear();

            foreach ($lines as $line) {
                $key = $this->arrearLineBusinessKey(
                    (string) ($line['employee_user_id'] ?? $uid),
                    (int) $line['arrear_year'],
                    (int) $line['arrear_month'],
                    (float) $line['old_da_percent'],
                    (float) $line['new_da_percent'],
                );

                if (isset($deduped[$key])) {
                    continue;
                }

                $deduped[$key] = $line;
                $sums['daArrear'] += (float) $line['da_arrear'];
                $sums['transportArrear'] += (float) $line['transport_arrear'];
                $sums['grossArrear'] += (float) $line['gross_arrear'];
                $sums['cpfArrear'] += (float) $line['cpf_arrear'];
                $sums['netArrear'] += (float) $line['net_arrear'];
            }

            $employeeTotals[$uid] = array_merge($sums, ['lines' => array_values($deduped)]);
        }

        return $employeeTotals;
    }

    private function isArrearMonthAlreadyPaid(
        string $employeeUserId,
        int $month,
        int $year,
        float $oldDaPercent,
        float $newDaPercent,
    ): bool {
        return HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_month', $month)
            ->where('arrear_year', $year)
            ->where('is_locked', true)
            ->whereBetween('old_da_percent', [$oldDaPercent - 0.01, $oldDaPercent + 0.01])
            ->whereBetween('new_da_percent', [$newDaPercent - 0.01, $newDaPercent + 0.01])
            ->whereHas('batch', fn ($q) => $q->where('status', 'finalized'))
            ->exists();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function resolveHistoricalMonthData(
        string $companyId,
        string $employeeUserId,
        HrmsPayrollPeriod $payrollPeriod,
        HrmsDaRevisionEvent $event,
    ): ?array {
        $periodStart = $payrollPeriod->period_start?->format('Y-m-d');
        if ($periodStart === null) {
            return null;
        }

        $hasPayslip = HrmsPayslip::query()
            ->where('payroll_period_id', $payrollPeriod->id)
            ->where('employee_user_id', $employeeUserId)
            ->exists();

        if (! $hasPayslip) {
            return null;
        }

        $gov = HrmsGovernmentMonthlyPayroll::query()
            ->where('payroll_period_id', $payrollPeriod->id)
            ->where('employee_user_id', $employeeUserId)
            ->first();

        $historicalMaster = null;
        if ($gov?->payroll_master_id) {
            $historicalMaster = HrmsPayrollMaster::find($gov->payroll_master_id);
        }

        if ($gov) {
            $basic = (float) ($gov->basic_paid ?: $gov->basic_actual ?: 0);
            $payLevel = (int) ($gov->pay_level ?? 0);
            $oldDaPercent = $this->resolveOldDaPercentForArrearMonth($gov, $basic, $historicalMaster, $event);
            $cpfRate = $this->resolveCpfRate($gov->payroll_master_id, $employeeUserId, $companyId, $periodStart);

            $newMaster = $this->masterForDate($employeeUserId, $companyId, $periodStart);
            if ($payLevel < 1) {
                $payLevel = (int) ($newMaster?->pay_level ?? $historicalMaster?->pay_level ?? 1);
            }

            return [
                'basic' => $basic,
                'transport_base' => $this->transportBaseFromPayLevel($payLevel, $newMaster, $employeeUserId),
                'old_da_percent' => $oldDaPercent,
                'cpf_rate' => $cpfRate,
                'monthly_payroll_id' => $gov->id,
                'payroll_master_id' => $gov->payroll_master_id,
                'new_payroll_master_id' => $newMaster?->id,
                'used_fallback' => false,
            ];
        }

        $master = $historicalMaster ?? $this->masterForDate($employeeUserId, $companyId, $periodStart);
        if (! $master) {
            return null;
        }

        $payLevel = (int) ($master->pay_level ?? 1);
        $basic = (float) ($master->gross_basic_pay ?? $master->gross_basic ?? 0);
        $oldDaPercent = $this->resolveOldDaPercentForArrearMonth(null, $basic, $master, $event);

        return [
            'basic' => $basic,
            'transport_base' => $this->transportBaseFromPayLevel($payLevel, $master, $employeeUserId),
            'old_da_percent' => $oldDaPercent,
            'cpf_rate' => $this->resolveCpfRate($master->id, $employeeUserId, $companyId, $periodStart),
            'monthly_payroll_id' => null,
            'payroll_master_id' => $master->id,
            'new_payroll_master_id' => $master->id,
            'used_fallback' => true,
        ];
    }

    private function resolveOldDaPercentForArrearMonth(
        ?HrmsGovernmentMonthlyPayroll $gov,
        float $basic,
        ?HrmsPayrollMaster $historicalMaster,
        HrmsDaRevisionEvent $event,
    ): float {
        $newDa = (float) $event->new_da_percent;
        $revisionOld = (float) $event->old_da_percent;

        if ($gov && $basic > 0) {
            $daPaid = (float) ($gov->da_paid ?: $gov->da_actual ?: 0);
            if ($daPaid > 0) {
                $paidPct = round($daPaid / $basic * 100, 2);
                if ($paidPct < $newDa - 0.001) {
                    return $paidPct;
                }
            }
        }

        if ($historicalMaster && $historicalMaster->da_percent !== null) {
            $masterDa = (float) $historicalMaster->da_percent;
            if ($masterDa < $newDa - 0.001) {
                return $masterDa;
            }
        }

        if ($revisionOld < $newDa - 0.001) {
            return $revisionOld;
        }

        return $newDa;
    }

    private function deriveDaPercentFromMonthly(HrmsGovernmentMonthlyPayroll $gov, float $basic): float
    {
        if ($basic > 0) {
            $daPaid = (float) ($gov->da_paid ?: $gov->da_actual ?: 0);
            if ($daPaid > 0) {
                return round($daPaid / $basic * 100, 2);
            }
        }

        if ($gov->payroll_master_id) {
            $master = HrmsPayrollMaster::find($gov->payroll_master_id);
            if ($master && $master->da_percent !== null) {
                return (float) $master->da_percent;
            }
        }

        return 53.0;
    }

    private function resolveCpfRate(?string $masterId, string $employeeUserId, string $companyId, string $asOfDate): float
    {
        $master = $masterId
            ? HrmsPayrollMaster::find($masterId)
            : $this->masterForDate($employeeUserId, $companyId, $asOfDate);

        $cpfDefault = (float) ($master?->cpf_default ?? 0);
        if ($cpfDefault > 0 && $master) {
            $totalEarnings = (float) ($master->total_earnings ?? 0);
            if ($totalEarnings > 0) {
                return $cpfDefault / $totalEarnings;
            }
        }

        return self::DEFAULT_CPF_RATE;
    }

    private function masterForDate(string $employeeUserId, string $companyId, string $date): ?HrmsPayrollMaster
    {
        return HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->where(function ($q) use ($employeeUserId) {
                $q->where('employee_user_id', $employeeUserId)
                    ->orWhere('user_id', $employeeUserId);
            })
            ->where(function ($q) use ($date) {
                $q->whereNull('effective_start_date')
                    ->orWhereDate('effective_start_date', '<=', $date);
            })
            ->where(function ($q) use ($date) {
                $q->whereNull('effective_end_date')
                    ->orWhereDate('effective_end_date', '>=', $date);
            })
            ->orderByDesc('effective_start_date')
            ->first();
    }

    private function transportBaseFromPayLevel(int $payLevel, ?HrmsPayrollMaster $master, string $employeeUserId): float
    {
        if ($payLevel >= 1) {
            return $this->calculator->getTransportBaseByPayLevel($payLevel);
        }
        if ($master) {
            return $this->calculator->getTransportBaseByPayLevel((int) ($master->pay_level ?? 1));
        }

        return 3600.0;
    }

    private function transportBaseFromMaster(?HrmsPayrollMaster $master, string $employeeUserId): float
    {
        if ($master) {
            return $this->calculator->getTransportBaseByPayLevel((int) ($master->pay_level ?? 1));
        }

        return 3600.0;
    }

    private function employeeLabel(string $employeeUserId): string
    {
        return HrmsUser::find($employeeUserId)?->name ?? $employeeUserId;
    }

    /**
     * @param  list<HrmsPayrollArrearLine>  $lines
     * @return array<string, array<string, mixed>>
     */
    private function aggregateLinesToEmployeeTotals(array $lines): array
    {
        $deduped = [];

        foreach ($lines as $line) {
            $revisionEventId = (string) ($line->da_revision_event_id ?? $line->batch?->da_revision_event_id ?? '');
            $key = $this->arrearLineBusinessKey(
                (string) $line->employee_user_id,
                (int) $line->arrear_year,
                (int) $line->arrear_month,
                (float) $line->old_da_percent,
                (float) $line->new_da_percent,
            );

            if (! isset($deduped[$key])) {
                $deduped[$key] = $line;

                continue;
            }

            $existing = $deduped[$key];
            if ($line->is_locked && ! $existing->is_locked) {
                $deduped[$key] = $line;
            }
        }

        $employeeTotals = [];
        foreach ($deduped as $line) {
            $uid = (string) $line->employee_user_id;
            if (! isset($employeeTotals[$uid])) {
                $employeeTotals[$uid] = $this->emptyEmployeeArrear();
            }
            $employeeTotals[$uid]['daArrear'] += (float) $line->da_arrear;
            $employeeTotals[$uid]['transportArrear'] += (float) $line->transport_arrear;
            $employeeTotals[$uid]['grossArrear'] += (float) $line->gross_arrear;
            $employeeTotals[$uid]['cpfArrear'] += (float) $line->cpf_arrear;
            $employeeTotals[$uid]['netArrear'] += (float) $line->net_arrear;
        }

        return $employeeTotals;
    }
}
