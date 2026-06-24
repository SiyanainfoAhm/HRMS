<?php

namespace App\Services;

use App\Models\HrmsCompany;
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
use Illuminate\Support\Facades\Log;
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
        private readonly PayrollMasterService $masterService,
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
        if (! HrmsDaRevisionEvent::query()->where('company_id', $companyId)->exists()) {
            return [];
        }

        $runStart = Carbon::create($runYear, $runMonth, 1)->startOfDay();

        $candidates = HrmsDaRevisionEvent::query()
            ->where('company_id', $companyId)
            ->whereDate('effective_from', '<', $runStart->toDateString())
            ->orderByDesc('created_at')
            ->get()
            ->filter(fn (HrmsDaRevisionEvent $e) => $this->isActiveRevisionEvent($e, $companyId))
            ->filter(fn (HrmsDaRevisionEvent $e) => $this->arrearPeriodForRevision(
                $e->effective_from->format('Y-m-d'),
                $runYear,
                $runMonth,
            ) !== null);

        return $this->dedupeRevisionEventsByTransition($candidates);
    }

    /**
     * Revision events that still have at least one unsettled arrear month for this payroll run.
     *
     * @return list<HrmsDaRevisionEvent>
     */
    public function detectPendingDaArrearsForRun(string $companyId, int $runYear, int $runMonth): array
    {
        $events = $this->detectPendingDaArrears($companyId, $runYear, $runMonth);

        return array_values(array_filter(
            $events,
            fn (HrmsDaRevisionEvent $event) => count(
                $this->calculateDaArrearsForRevision($event, $companyId, $runYear, $runMonth)['lines'],
            ) > 0,
        ));
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

                if ($this->isArrearMonthSettled($companyId, (string) $employeeUserId, $y, $m, $newDaPercent)) {
                    $this->debugArrear('skip settled calendar month', [
                        'payroll_run' => sprintf('%04d-%02d', $runYear, $runMonth),
                        'employee_user_id' => $employeeUserId,
                        'arrear_year' => $y,
                        'arrear_month' => $m,
                        'target_da_percent' => $newDaPercent,
                        'reason' => 'settled',
                    ]);
                    continue;
                }

                $effectiveOldDa = $this->resolveEffectiveOldDaForArrearMonth(
                    (string) $employeeUserId,
                    $m,
                    $y,
                    $revisionOldDa,
                    $newDaPercent,
                    $companyId,
                );
                if ($effectiveOldDa === null) {
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

                $oldDa = (float) ($source['old_da_percent'] ?? $effectiveOldDa);
                if ($oldDa >= $newDaPercent - 0.001) {
                    $this->debugArrear('skip month already paid at target DA', [
                        'payroll_run' => sprintf('%04d-%02d', $runYear, $runMonth),
                        'employee_user_id' => $employeeUserId,
                        'arrear_year' => $y,
                        'arrear_month' => $m,
                        'actual_paid_da_percent' => $oldDa,
                        'target_da_percent' => $newDaPercent,
                        'reason' => 'paid_at_target',
                    ]);
                    continue;
                }

                $calc = $this->calculateMonthArrear(
                    (float) $source['basic'],
                    (float) $source['transport_base'],
                    $effectiveOldDa,
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

                $this->debugArrear('include arrear month', [
                    'payroll_run' => sprintf('%04d-%02d', $runYear, $runMonth),
                    'employee_user_id' => $employeeUserId,
                    'arrear_year' => $y,
                    'arrear_month' => $m,
                    'old_da_percent' => $effectiveOldDa,
                    'new_da_percent' => $newDaPercent,
                    'gross_arrear' => $calc['gross_arrear'],
                    'reason' => 'included',
                ]);

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
     * Read-only arrear preview for Run Payroll — never inserts batches or lines.
     *
     * @return array{batches: list<array<string, mixed>>, warnings: list<string>, employeeTotals: array<string, mixed>}
     */
    public function previewArrearsForRun(
        string $companyId,
        int $runYear,
        int $runMonth,
    ): array {
        $this->purgeOrphanArrearArtifacts($companyId);
        $this->purgeSettledUnpaidArrearLines($companyId);

        $events = $this->detectPendingDaArrearsForRun($companyId, $runYear, $runMonth);
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

            foreach ($calc['lines'] as $line) {
                $line['da_revision_event_id'] = $event->id;
                $employeeTotals = $this->mergeCalcLineIntoEmployeeTotals($employeeTotals, $line);
            }

            if ($calc['lines'] !== []) {
                $batches[] = [
                    'revisionEventId' => $event->id,
                    'da_revision_event_id' => $event->id,
                    'arrear_from' => $period['from'],
                    'arrear_to' => $period['to'],
                    'status' => 'preview',
                ];
            }
        }

        $employeeTotals = $this->dedupeEmployeeTotals($employeeTotals);

        $previewLineIds = [];
        foreach ($employeeTotals as $totals) {
            foreach ($totals['arrearLineIds'] ?? [] as $lineId) {
                $previewLineIds[] = $lineId;
            }
        }

        $this->debugArrear('preview arrear totals', [
            'payroll_run' => sprintf('%04d-%02d', $runYear, $runMonth),
            'active_revision_count' => count($events),
            'employee_count' => count($employeeTotals),
            'arrear_line_ids' => array_values(array_unique($previewLineIds)),
        ]);

        return [
            'batches' => $batches,
            'warnings' => array_values(array_unique($allWarnings)),
            'employeeTotals' => $employeeTotals,
        ];
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
            $this->purgeOrphanArrearArtifacts($companyId);
            $this->purgeSettledUnpaidArrearLines($companyId);
            $events = $this->detectPendingDaArrearsForRun($companyId, $runYear, $runMonth);
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
                        $this->aggregateLinesToEmployeeTotals($existingBatch->lines->all(), $companyId),
                    );

                    continue;
                }

                if ($existingBatch) {
                    HrmsPayrollArrearLine::query()
                        ->where('arrear_batch_id', $existingBatch->id)
                        ->where('is_locked', false)
                        ->where(function ($q) {
                            $q->whereNull('status')
                                ->orWhereIn(DB::raw('UPPER(COALESCE(status, \'UNPAID\'))'), ['UNPAID', 'DRAFT']);
                        })
                        ->delete();
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
                    $stored = $this->upsertArrearLine($batch->id, (string) $event->id, $payrollPeriodId, $line, $companyId);
                    $line['id'] = $stored->id;
                    $employeeTotals = $this->mergeCalcLineIntoEmployeeTotals($employeeTotals, $line);
                }

                if ($calc['lines'] === []) {
                    HrmsPayrollArrearLine::where('arrear_batch_id', $batch->id)->delete();
                    $batch->delete();
                    continue;
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
            $unpaidLines = $finalized->flatMap(
                fn ($b) => $b->lines->filter(fn (HrmsPayrollArrearLine $line) => $line->isUnpaid()),
            )->all();

            if ($unpaidLines !== []) {
                return $this->aggregateLinesToEmployeeTotals($unpaidLines, $companyId);
            }
        }

        return $this->previewArrearsForRun($companyId, $runYear, $runMonth)['employeeTotals'];
    }

    /**
     * Persist draft arrear batches/lines when payroll is confirmed (not during preview).
     *
     * @return array<string, mixed>
     */
    public function persistArrearLinesForPayrollConfirm(
        string $companyId,
        int $runYear,
        int $runMonth,
        string $payrollPeriodId,
    ): array {
        $preview = $this->previewArrearsForRun($companyId, $runYear, $runMonth);
        if ($preview['employeeTotals'] === []) {
            $this->purgeOrphanArrearArtifacts($companyId);

            return ['batches' => [], 'employeeTotals' => []];
        }

        return $this->generateOrUpdateDraftArrearBatch($companyId, $runYear, $runMonth, $payrollPeriodId);
    }

    public function attachArrearsToPayrollRun(HrmsPayrollPeriod $period): void
    {
        $year = (int) $period->period_start?->year;
        $month = (int) $period->period_start?->month;

        HrmsPayrollArrearBatch::query()
            ->where('company_id', $period->company_id)
            ->where('run_year', $year)
            ->where('run_month', $month)
            ->where('status', 'draft')
            ->update(['payroll_period_id' => $period->id]);

        HrmsPayrollArrearLine::query()
            ->whereIn('arrear_batch_id', HrmsPayrollArrearBatch::query()
                ->where('payroll_period_id', $period->id)
                ->pluck('id'))
            ->where(function ($q) {
                $q->whereNull('status')
                    ->orWhereIn(DB::raw('UPPER(COALESCE(status, \'UNPAID\'))'), ['UNPAID', 'DRAFT']);
            })
            ->update(['payroll_period_id' => $period->id]);
    }

    /**
     * Mark draft arrear lines as paid when payroll is confirmed. Idempotent for already-paid lines.
     *
     * @param  array<string, string>  $monthlyPayrollIdsByEmployee  employee_user_id => cirt_monthly_payroll id
     * @param  array<string, list<string>>  $arrearLineIdsByEmployee
     */
    public function markArrearLinesAsPaidForPayrollRun(
        HrmsPayrollPeriod $period,
        ?string $paidBy,
        array $monthlyPayrollIdsByEmployee = [],
        array $arrearLineIdsByEmployee = [],
    ): void {
        $this->attachArrearsToPayrollRun($period);

        $year = (int) $period->period_start?->year;
        $month = (int) $period->period_start?->month;
        $paidInMonth = ($year >= 2000 && $month >= 1 && $month <= 12)
            ? sprintf('%04d-%02d-01', $year, $month)
            : null;

        $explicitIds = [];
        foreach ($arrearLineIdsByEmployee as $ids) {
            foreach ($ids as $id) {
                if (is_string($id) && $id !== '') {
                    $explicitIds[] = $id;
                }
            }
        }
        $explicitIds = array_values(array_unique($explicitIds));

        if ($explicitIds !== []) {
            $this->markArrearLineIdsPaid(
                $explicitIds,
                $period,
                $paidBy,
                $year,
                $month,
                $paidInMonth,
                $monthlyPayrollIdsByEmployee,
            );
        }

        $batches = HrmsPayrollArrearBatch::query()
            ->where('payroll_period_id', $period->id)
            ->where('status', 'draft')
            ->lockForUpdate()
            ->get();

        foreach ($batches as $batch) {
            $lines = HrmsPayrollArrearLine::query()
                ->where('arrear_batch_id', $batch->id)
                ->lockForUpdate()
                ->get();

            foreach ($lines as $line) {
                if ($line->isPaid()) {
                    continue;
                }

                $employeeUserId = (string) $line->employee_user_id;
                $this->applyPaidStatusToLine(
                    $line,
                    $period,
                    $paidBy,
                    $year,
                    $month,
                    $paidInMonth,
                    $monthlyPayrollIdsByEmployee[$employeeUserId] ?? null,
                );
            }

            $batch->update([
                'status' => 'finalized',
                'paid_at' => now(),
            ]);
        }
    }

    /** @deprecated Use markArrearLinesAsPaidForPayrollRun() */
    public function finalizeArrears(HrmsPayrollPeriod $period): void
    {
        $this->markArrearLinesAsPaidForPayrollRun($period, null);
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
            'arrearLineIds' => [],
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
        if (! empty($line['id'])) {
            $employeeTotals[$uid]['arrearLineIds'][] = (string) $line['id'];
        }

        return $employeeTotals;
    }

    /** @param  array<string, mixed>  $line */
    private function upsertArrearLine(
        string $batchId,
        string $revisionEventId,
        ?string $payrollPeriodId,
        array $line,
        ?string $companyId = null,
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

        if ($existing?->isPaid()) {
            return $existing;
        }

        $paidDuplicate = HrmsPayrollArrearLine::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_year', $arrearYear)
            ->where('arrear_month', $arrearMonth)
            ->whereBetween('old_da_percent', [(float) $line['old_da_percent'] - 0.01, (float) $line['old_da_percent'] + 0.01])
            ->whereBetween('new_da_percent', [(float) $line['new_da_percent'] - 0.01, (float) $line['new_da_percent'] + 0.01])
            ->where(fn ($q) => $this->applyPaidLineScope($q))
            ->first();

        if ($paidDuplicate) {
            return $paidDuplicate;
        }

        $unpaidDuplicate = HrmsPayrollArrearLine::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_year', $arrearYear)
            ->where('arrear_month', $arrearMonth)
            ->whereBetween('old_da_percent', [(float) $line['old_da_percent'] - 0.01, (float) $line['old_da_percent'] + 0.01])
            ->whereBetween('new_da_percent', [(float) $line['new_da_percent'] - 0.01, (float) $line['new_da_percent'] + 0.01])
            ->where(fn ($q) => $this->applyUnpaidLineScope($q))
            ->first();

        if ($unpaidDuplicate && ! $existing) {
            $existing = $unpaidDuplicate;
        }

        $attributes = [
            'arrear_batch_id' => $batchId,
            'da_revision_event_id' => $revisionEventId,
            'payroll_period_id' => $payrollPeriodId,
            'company_id' => $companyId,
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
            'status' => 'UNPAID',
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
                $key = sprintf(
                    '%s|%d|%d',
                    (string) ($line['employee_user_id'] ?? $uid),
                    (int) $line['arrear_year'],
                    (int) $line['arrear_month'],
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

            $lineIds = array_values(array_unique(array_filter(array_map(
                static fn (array $line): ?string => isset($line['id']) ? (string) $line['id'] : null,
                array_values($deduped),
            ))));

            $employeeTotals[$uid] = array_merge($sums, [
                'lines' => array_values($deduped),
                'arrearLineIds' => $lineIds,
            ]);
        }

        return $employeeTotals;
    }

    /**
     * True when this employee calendar month is already settled at the target DA level or higher.
     *
     * @deprecated Prefer isArrearMonthSettled() which also checks finalized monthly payroll DA.
     */
    public function isArrearCalendarMonthSettled(
        string $employeeUserId,
        int $month,
        int $year,
        float $newDaPercent,
        ?string $companyId = null,
    ): bool {
        if ($companyId !== null) {
            return $this->isArrearMonthSettled($companyId, $employeeUserId, $year, $month, $newDaPercent);
        }

        return $this->hasPaidArrearLineForCalendarMonth($employeeUserId, $year, $month, $newDaPercent);
    }

    /**
     * Calendar salary month is settled when a paid/included arrear line exists OR
     * finalized monthly payroll for that month already used the target DA percent.
     */
    public function isArrearMonthSettled(
        string $companyId,
        string $employeeUserId,
        int $arrearYear,
        int $arrearMonth,
        float $targetDaPercent,
    ): bool {
        if ($this->hasPaidArrearLineForCalendarMonth($employeeUserId, $arrearYear, $arrearMonth, $targetDaPercent)) {
            return true;
        }

        return $this->isSalaryMonthPaidAtTargetDa($companyId, $employeeUserId, $arrearYear, $arrearMonth, $targetDaPercent);
    }

    /**
     * Unpaid arrear lines eligible for Run Payroll preview (excludes settled calendar months).
     *
     * @return list<array<string, mixed>>
     */
    public function getUnpaidArrearsForPayroll(string $companyId, ?int $runYear = null, ?int $runMonth = null): array
    {
        $query = HrmsPayrollArrearLine::query()
            ->where('company_id', $companyId)
            ->where(fn ($q) => $this->applyUnpaidLineScope($q));

        if ($runYear !== null && $runMonth !== null) {
            $batchIds = HrmsPayrollArrearBatch::query()
                ->where('company_id', $companyId)
                ->where('run_year', $runYear)
                ->where('run_month', $runMonth)
                ->pluck('id');
            if ($batchIds->isNotEmpty()) {
                $query->whereIn('arrear_batch_id', $batchIds);
            }
        }

        return $query
            ->orderBy('employee_user_id')
            ->orderBy('arrear_year')
            ->orderBy('arrear_month')
            ->get()
            ->reject(function (HrmsPayrollArrearLine $line) use ($companyId) {
                return $this->isArrearMonthSettled(
                    $companyId,
                    (string) $line->employee_user_id,
                    (int) $line->arrear_year,
                    (int) $line->arrear_month,
                    (float) $line->new_da_percent,
                );
            })
            ->map(fn (HrmsPayrollArrearLine $line) => [
                'employee_user_id' => $line->employee_user_id,
                'arrear_year' => $line->arrear_year,
                'arrear_month' => $line->arrear_month,
                'old_da_percent' => $line->old_da_percent,
                'new_da_percent' => $line->new_da_percent,
                'status' => $line->status,
                'included_in_month' => $line->included_in_month,
                'included_in_year' => $line->included_in_year,
                'paid_at' => $line->paid_at,
                'da_arrear' => $line->da_arrear,
                'transport_arrear' => $line->transport_arrear,
                'gross_arrear' => $line->gross_arrear,
                'cpf_arrear' => $line->cpf_arrear,
                'net_arrear' => $line->net_arrear,
            ])
            ->values()
            ->all();
    }

    public function resolveEffectiveOldDaForArrearMonth(
        string $employeeUserId,
        int $month,
        int $year,
        float $revisionOldDa,
        float $newDaPercent,
        ?string $companyId = null,
    ): ?float {
        if ($companyId !== null && $this->isArrearMonthSettled($companyId, $employeeUserId, $year, $month, $newDaPercent)) {
            return null;
        }

        if ($this->isArrearCalendarMonthSettled($employeeUserId, $month, $year, $newDaPercent, $companyId)) {
            return null;
        }

        $topPaid = HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_month', $month)
            ->where('arrear_year', $year)
            ->where(fn ($q) => $this->applyPaidLineScope($q))
            ->orderByDesc('new_da_percent')
            ->first();

        if ($topPaid && (float) $topPaid->new_da_percent >= $newDaPercent - 0.001) {
            return null;
        }

        return $topPaid ? (float) $topPaid->new_da_percent : $revisionOldDa;
    }

    /** @param  list<string>  $lineIds */
    /** @param  array<string, string>  $monthlyPayrollIdsByEmployee */
    private function markArrearLineIdsPaid(
        array $lineIds,
        HrmsPayrollPeriod $period,
        ?string $paidBy,
        int $year,
        int $month,
        ?string $paidInMonth,
        array $monthlyPayrollIdsByEmployee,
    ): void {
        $lines = HrmsPayrollArrearLine::query()
            ->whereIn('id', $lineIds)
            ->lockForUpdate()
            ->get();

        foreach ($lines as $line) {
            if ($line->isPaid()) {
                continue;
            }

            $employeeUserId = (string) $line->employee_user_id;
            $this->applyPaidStatusToLine(
                $line,
                $period,
                $paidBy,
                $year,
                $month,
                $paidInMonth,
                $monthlyPayrollIdsByEmployee[$employeeUserId] ?? null,
            );
        }
    }

    private function applyPaidStatusToLine(
        HrmsPayrollArrearLine $line,
        HrmsPayrollPeriod $period,
        ?string $paidBy,
        int $year,
        int $month,
        ?string $paidInMonth,
        ?string $monthlyPayrollId,
    ): void {
        $line->update([
            'status' => 'PAID',
            'is_locked' => true,
            'payroll_period_id' => $period->id,
            'paid_in_period_id' => $period->id,
            'paid_in_payroll_id' => $monthlyPayrollId ?? $line->paid_in_payroll_id,
            'paid_in_month' => $paidInMonth,
            'paid_at' => now(),
            'paid_by' => $paidBy,
            'included_in_payroll_period_id' => $period->id,
            'included_in_month' => $month,
            'included_in_year' => $year,
            'included_in_payroll_id' => $monthlyPayrollId ?? $line->included_in_payroll_id,
        ]);
    }

    /** @param  \Illuminate\Database\Eloquent\Builder<HrmsPayrollArrearLine>  $query */
    private function applyPaidLineScope($query): void
    {
        $query->where(function ($q) {
            $q->whereIn(DB::raw('UPPER(COALESCE(status, \'UNPAID\'))'), ['PAID', 'INCLUDED'])
                ->orWhereNotNull('paid_at')
                ->orWhereNotNull('included_in_payroll_period_id')
                ->orWhere(function ($q2) {
                    $q2->where('is_locked', true)
                        ->whereHas('batch', fn ($b) => $b->where('status', 'finalized'));
                });
        });
    }

    /** @param  \Illuminate\Database\Eloquent\Builder<HrmsPayrollArrearLine>  $query */
    private function applyUnpaidLineScope($query): void
    {
        $query->whereIn(DB::raw('UPPER(COALESCE(status, \'UNPAID\'))'), ['UNPAID', 'DRAFT'])
            ->whereNull('included_in_payroll_period_id')
            ->whereNull('included_in_month')
            ->whereNull('included_in_year')
            ->whereNull('paid_at');
    }

    private function hasPaidArrearLineForCalendarMonth(
        string $employeeUserId,
        int $arrearYear,
        int $arrearMonth,
        float $targetDaPercent,
    ): bool {
        return HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_month', $arrearMonth)
            ->where('arrear_year', $arrearYear)
            ->where(fn ($q) => $this->applyPaidLineScope($q))
            ->where('new_da_percent', '>=', $targetDaPercent - 0.001)
            ->exists();
    }

    private function isSalaryMonthPaidAtTargetDa(
        string $companyId,
        string $employeeUserId,
        int $arrearYear,
        int $arrearMonth,
        float $targetDaPercent,
    ): bool {
        $period = HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereYear('period_start', $arrearYear)
            ->whereMonth('period_start', $arrearMonth)
            ->first();

        if ($period === null) {
            return false;
        }

        $hasPayslip = HrmsPayslip::query()
            ->where('payroll_period_id', $period->id)
            ->where('employee_user_id', $employeeUserId)
            ->exists();

        if (! $hasPayslip) {
            return false;
        }

        $gov = HrmsGovernmentMonthlyPayroll::query()
            ->where('payroll_period_id', $period->id)
            ->where('employee_user_id', $employeeUserId)
            ->first();

        if ($gov === null) {
            return false;
        }

        $basic = (float) ($gov->basic_paid ?: $gov->basic_actual ?: 0);
        if ($basic <= 0) {
            return false;
        }

        $paidDaPercent = $this->deriveDaPercentFromMonthly($gov, $basic);

        return $paidDaPercent >= $targetDaPercent - 0.001;
    }

    private function purgeSettledUnpaidArrearLines(string $companyId): void
    {
        HrmsPayrollArrearLine::query()
            ->where(fn ($q) => $this->applyUnpaidLineScope($q))
            ->where(function ($q) use ($companyId) {
                $q->where('company_id', $companyId)
                    ->orWhereHas('batch', fn ($b) => $b->where('company_id', $companyId));
            })
            ->orderBy('created_at')
            ->chunk(100, function ($lines) use ($companyId) {
                foreach ($lines as $line) {
                    if ($this->isArrearMonthSettled(
                        $companyId,
                        (string) $line->employee_user_id,
                        (int) $line->arrear_year,
                        (int) $line->arrear_month,
                        (float) $line->new_da_percent,
                    )) {
                        $this->debugArrear('purge orphan unpaid line for settled month', [
                            'arrear_line_id' => $line->id,
                            'employee_user_id' => $line->employee_user_id,
                            'arrear_year' => $line->arrear_year,
                            'arrear_month' => $line->arrear_month,
                        ]);
                        $line->delete();
                    }
                }
            });
    }

    private function purgeOrphanArrearArtifacts(string $companyId): void
    {
        $activeRevisionIds = HrmsDaRevisionEvent::query()
            ->where('company_id', $companyId)
            ->get()
            ->filter(fn (HrmsDaRevisionEvent $event) => $this->isActiveRevisionEvent($event, $companyId))
            ->pluck('id')
            ->all();

        HrmsPayrollArrearLine::query()
            ->where(fn ($q) => $this->applyUnpaidLineScope($q))
            ->where(function ($q) use ($companyId) {
                $q->where('company_id', $companyId)
                    ->orWhereHas('batch', fn ($b) => $b->where('company_id', $companyId));
            })
            ->where(function ($q) use ($activeRevisionIds) {
                $q->whereNull('da_revision_event_id');
                if ($activeRevisionIds !== []) {
                    $q->orWhereNotIn('da_revision_event_id', $activeRevisionIds);
                } else {
                    $q->orWhereNotNull('da_revision_event_id');
                }
            })
            ->delete();

        $draftBatchQuery = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('status', 'draft');

        if ($activeRevisionIds !== []) {
            $draftBatchQuery->whereNotIn('da_revision_event_id', $activeRevisionIds);
        }

        $orphanBatchIds = $draftBatchQuery->pluck('id');
        if ($orphanBatchIds->isNotEmpty()) {
            HrmsPayrollArrearLine::whereIn('arrear_batch_id', $orphanBatchIds)->delete();
            HrmsPayrollArrearBatch::whereIn('id', $orphanBatchIds)->delete();
        }

        $emptyBatchIds = HrmsPayrollArrearBatch::query()
            ->where('company_id', $companyId)
            ->where('status', 'draft')
            ->whereDoesntHave('lines')
            ->pluck('id');

        if ($emptyBatchIds->isNotEmpty()) {
            HrmsPayrollArrearBatch::whereIn('id', $emptyBatchIds)->delete();
        }
    }

    public function getCurrentTargetDaPercent(string $companyId): ?float
    {
        $masterDas = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->pluck('da_percent')
            ->map(static fn ($da) => round((float) $da, 2))
            ->filter(static fn (float $da) => $da > 0)
            ->unique()
            ->values();

        if ($masterDas->count() === 1) {
            return (float) $masterDas->first();
        }

        $companyDa = HrmsCompany::query()->where('id', $companyId)->value('default_da_percent');

        return $companyDa !== null ? round((float) $companyDa, 2) : null;
    }

    public function isActiveRevisionEvent(?HrmsDaRevisionEvent $event, string $companyId): bool
    {
        if ($event === null || $event->company_id !== $companyId) {
            return false;
        }

        $oldDa = (float) $event->old_da_percent;
        $newDa = (float) $event->new_da_percent;
        if ($oldDa >= $newDa - 0.001) {
            return false;
        }

        $targetDa = $this->getCurrentTargetDaPercent($companyId);
        if ($targetDa === null) {
            return false;
        }

        return abs($newDa - $targetDa) < 0.001;
    }

    /** @param  array<string, mixed>  $context */
    private function debugArrear(string $message, array $context = []): void
    {
        if (config('app.debug')) {
            Log::debug('[PayrollArrear] '.$message, $context);
        }
    }

    /**
     * @deprecated Use isArrearCalendarMonthSettled()
     */
    public function isArrearMonthSettledForRevision(
        string $employeeUserId,
        int $month,
        int $year,
        string $revisionEventId,
    ): bool {
        return HrmsPayrollArrearLine::query()
            ->where('employee_user_id', $employeeUserId)
            ->where('arrear_month', $month)
            ->where('arrear_year', $year)
            ->where('da_revision_event_id', $revisionEventId)
            ->where(fn ($q) => $this->applyPaidLineScope($q))
            ->exists()
            || $this->isArrearCalendarMonthSettled($employeeUserId, $month, $year, 999);
    }

    /** @deprecated Use isArrearCalendarMonthSettled() */
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
            ->where(function ($q) {
                $q->where('status', 'paid')
                    ->orWhere(function ($q2) {
                        $q2->where('is_locked', true)
                            ->whereHas('batch', fn ($b) => $b->where('status', 'finalized'));
                    });
            })
            ->whereBetween('new_da_percent', [$newDaPercent - 0.01, $newDaPercent + 0.01])
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
            $historicalMaster = $this->findMasterOrHistoryById($gov->payroll_master_id);
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
                if ($paidPct >= $newDa - 0.001) {
                    return $newDa;
                }

                return $paidPct;
            }
        }

        if ($historicalMaster && $historicalMaster->da_percent !== null) {
            $masterDa = (float) $historicalMaster->da_percent;
            if ($masterDa >= $newDa - 0.001) {
                return $newDa;
            }
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
            $master = $this->findMasterOrHistoryById($gov->payroll_master_id);
            if ($master && $master->da_percent !== null) {
                return (float) $master->da_percent;
            }
        }

        return 53.0;
    }

    private function resolveCpfRate(?string $masterId, string $employeeUserId, string $companyId, string $asOfDate): float
    {
        $master = $masterId
            ? $this->findMasterOrHistoryById($masterId)
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
        return $this->masterService->getPayrollMasterForDate($companyId, $employeeUserId, $date);
    }

    private function findMasterOrHistoryById(?string $masterId): ?HrmsPayrollMaster
    {
        if (! $masterId) {
            return null;
        }

        return $this->masterService->findMasterOrHistoryById($masterId);
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
    private function aggregateLinesToEmployeeTotals(array $lines, ?string $companyId = null): array
    {
        $deduped = [];

        foreach ($lines as $line) {
            if ($line instanceof HrmsPayrollArrearLine && $line->isPaid()) {
                continue;
            }

            if ($line instanceof HrmsPayrollArrearLine && $companyId !== null
                && $this->isArrearMonthSettled(
                    $companyId,
                    (string) $line->employee_user_id,
                    (int) $line->arrear_year,
                    (int) $line->arrear_month,
                    (float) $line->new_da_percent,
                )) {
                continue;
            }

            $key = sprintf(
                '%s|%d|%d',
                (string) $line->employee_user_id,
                (int) $line->arrear_year,
                (int) $line->arrear_month,
            );

            if (! isset($deduped[$key])) {
                $deduped[$key] = $line;

                continue;
            }

            $existing = $deduped[$key];
            if ($line instanceof HrmsPayrollArrearLine && $line->isPaid() && ! ($existing instanceof HrmsPayrollArrearLine && $existing->isPaid())) {
                $deduped[$key] = $line;
            }
        }

        $employeeTotals = [];
        foreach ($deduped as $line) {
            if ($line instanceof HrmsPayrollArrearLine && $line->isPaid()) {
                continue;
            }
            $uid = (string) $line->employee_user_id;
            if (! isset($employeeTotals[$uid])) {
                $employeeTotals[$uid] = $this->emptyEmployeeArrear();
            }
            $employeeTotals[$uid]['daArrear'] += (float) $line->da_arrear;
            $employeeTotals[$uid]['transportArrear'] += (float) $line->transport_arrear;
            $employeeTotals[$uid]['grossArrear'] += (float) $line->gross_arrear;
            $employeeTotals[$uid]['cpfArrear'] += (float) $line->cpf_arrear;
            $employeeTotals[$uid]['netArrear'] += (float) $line->net_arrear;
            if ($line instanceof HrmsPayrollArrearLine) {
                $employeeTotals[$uid]['arrearLineIds'][] = (string) $line->id;
                $employeeTotals[$uid]['lines'][] = [
                    'id' => (string) $line->id,
                    'employee_user_id' => $line->employee_user_id,
                    'arrear_year' => (int) $line->arrear_year,
                    'arrear_month' => (int) $line->arrear_month,
                    'old_da_percent' => (float) $line->old_da_percent,
                    'new_da_percent' => (float) $line->new_da_percent,
                    'da_revision_event_id' => $line->da_revision_event_id,
                    'da_arrear' => (float) $line->da_arrear,
                    'transport_arrear' => (float) $line->transport_arrear,
                    'gross_arrear' => (float) $line->gross_arrear,
                ];
            }
        }

        return $this->dedupeEmployeeTotals($employeeTotals);
    }
}
