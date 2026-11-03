<?php

namespace App\Services;

use App\Models\HrmsNightAllowanceRate;
use App\Support\GovernmentPayLevel;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class NightAllowanceRateService
{
    /**
     * Night Duty Allowance = hours / 8 x rate. The rate (Settings > Night Allowance, 7th CPC table:
     * Level 1 = 23.20) is the amount per DUTY of 8 hours and is stored exactly as typed.
     * Computed as (hours x rate) / 8 and rounded ONCE, to 2 decimals (paise), at the end. Mirror: src/lib/nightAllowanceCalculation.ts
     * (shared cases: tests/fixtures/night_allowance_cases.json).
     */
    public const DUTY_BASE_HOURS = 8;

    public const ROUND_AMOUNT_TO_RUPEE = false;

    /** 'duty' = rate is per 8-hour duty; 'hour' = legacy rows keep hours x rate (history unchanged). */
    public const BASIS_DUTY = 'duty';

    public const BASIS_HOUR = 'hour';

    public static function allowanceAmount(float $hours, float $rate, string $basis = self::BASIS_DUTY): float
    {
        $hours = max(0.0, $hours);
        $rate = max(0.0, $rate);
        if ($hours <= 0) {
            return 0.0;
        }
        if ($basis === self::BASIS_HOUR) {
            return (float) round($hours * $rate);
        }
        // hours x rate / 8 in integer paise (App\Support\Money), rounded once, half up, to paise.
        $amount = \App\Support\Money::proportion($rate, $hours, self::DUTY_BASE_HOURS);

        return self::ROUND_AMOUNT_TO_RUPEE ? (float) round($amount) : $amount;
    }

    /**
     * Open-draft row -> duty basis. A row saved before the per-duty rate (no basis, or 'hour' with
     * an hourly rate such as 28.85) gets basis 'duty' and the rate re-resolved from the active slab
     * for its pay level and period. Typed hours and a typed (override) amount are kept; only a
     * computed amount can change, and gross/net move by exactly that delta. A level with no slab
     * is left untouched (a stored amount is never zeroed). A row already on 'duty' whose rate is
     * exactly 8x the slab rate (saved while the slabs were 8x too high) is corrected the same way.
     * The basis alone decides this, never a rate threshold. Idempotent. Never call for finalized months.
     *
     * @param  array<string, mixed>  $payload  draft row_payload
     * @param  list<array<string, mixed>>  $preloadedRates
     * @return array{payload: array<string, mixed>, changed: bool, from: array<string, mixed>, to: array<string, mixed>}
     */
    public function normalizeDraftPayloadToDuty(array $payload, array $preloadedRates, ?string $periodEndDate): array
    {
        $unchanged = ['payload' => $payload, 'changed' => false, 'from' => [], 'to' => []];
        $gr = $payload['govRecalc'] ?? null;
        $gm = $payload['governmentMonthly'] ?? null;
        if (! is_array($gr) || ! is_array($gm)) {
            return $unchanged;
        }
        $basis = $gr['nightAllowanceRateBasis'] ?? $gm['nightAllowanceRateBasis'] ?? null;
        $level = (int) ($gr['payLevel'] ?? $gm['payLevel'] ?? 0);
        $resolved = $this->resolveFromPreloadedRates($preloadedRates, $level, $periodEndDate);
        if ($resolved['rate'] <= 0) {
            return $unchanged;
        }
        $rate = (float) $resolved['rate'];
        $storedRate = (float) ($gr['nightAllowanceRate'] ?? $gm['nightAllowanceRate'] ?? 0);
        $stale8x = $basis === self::BASIS_DUTY && abs($storedRate - 8 * $rate) < 0.005;
        if ($basis === self::BASIS_DUTY && ! $stale8x) {
            return $unchanged;
        }
        $hours = (float) ($gr['nightHours'] ?? $gm['nightHours'] ?? 0);
        $manual = (bool) ($gr['nightAllowanceManualOverride'] ?? $gm['nightAllowanceManualOverride'] ?? false);
        $eligible = ($gm['nightAllowanceEligible'] ?? true) !== false;
        $oldAmount = (float) ($gm['nightAllowancePaid'] ?? 0);
        $newAmount = ($manual || ! $eligible) ? $oldAmount : self::allowanceAmount($hours, $rate, self::BASIS_DUTY);

        $from = ['rate' => $gr['nightAllowanceRate'] ?? null, 'basis' => $basis, 'amount' => $oldAmount];
        $gr['nightAllowanceRate'] = $rate;
        $gr['nightAllowanceRateBasis'] = self::BASIS_DUTY;
        $gr['nightAllowanceSlabNo'] = $resolved['slabNo'];
        $gm['nightAllowanceRate'] = $rate;
        $gm['nightAllowanceRateBasis'] = self::BASIS_DUTY;
        $gm['nightAllowanceSlabNo'] = $resolved['slabNo'];
        $delta = $hours > 0 ? $newAmount - $oldAmount : 0.0;
        if (abs($delta) > 0.0001) {
            foreach (['nightAllowancePaid', 'nightAllowanceAmount', 'nightAllowanceActual'] as $k) {
                $gm[$k] = $newAmount;
            }
            $gm['totalEarnings'] = (float) ($gm['totalEarnings'] ?? 0) + $delta;
            $gm['netSalary'] = (float) ($gm['netSalary'] ?? 0) + $delta;
            foreach (['grossPay', 'netPay', 'takeHome'] as $k) {
                if (isset($payload[$k]) && is_numeric($payload[$k])) {
                    $payload[$k] = (float) $payload[$k] + $delta;
                }
            }
        }
        $payload['govRecalc'] = $gr;
        $payload['governmentMonthly'] = $gm;

        return [
            'payload' => $payload,
            'changed' => true,
            'from' => $from,
            'to' => ['rate' => $rate, 'basis' => self::BASIS_DUTY, 'amount' => $hours > 0 ? $newAmount : $oldAmount],
        ];
    }

    /**
     * Rate per duty, exactly as stored. Rows created before rate_per_duty existed carry the same
     * 7th CPC table amount in the legacy rate_per_hour column (a misnomer: it is per duty), so no
     * multiplication or division is applied.
     */
    public static function ratePerDuty(mixed $stored, float $legacyColumn): float
    {
        return is_numeric($stored) ? (float) $stored : round($legacyColumn, 2);
    }

    /** @return list<array<string, mixed>> */
    public function listForCompany(string $companyId, bool $activeOnly = false): array
    {
        $q = HrmsNightAllowanceRate::query()
            ->where('company_id', $companyId)
            ->orderBy('slab_no');
        if ($activeOnly) {
            $q->where('is_active', true);
        }

        return $q->get()->map(fn (HrmsNightAllowanceRate $r) => $this->formatRow($r))->values()->all();
    }

    /** @return array<string, mixed>|null */
    public function findBySlabNo(string $companyId, int $slabNo, bool $activeOnly = true): ?array
    {
        $q = HrmsNightAllowanceRate::query()
            ->where('company_id', $companyId)
            ->where('slab_no', $slabNo);
        if ($activeOnly) {
            $q->where('is_active', true);
        }
        $row = $q->first();

        return $row ? $this->formatRow($row) : null;
    }

    /**
     * Resolve from preloaded rate rows (avoids per-employee DB query in Run Payroll).
     *
     * @param  list<array<string, mixed>>  $preloadedRates
     * @return array{rate: float, slabNo: int|null, warning: string|null, basis: string}
     */
    public function resolveFromPreloadedRates(array $preloadedRates, int $payLevel, ?string $periodEndDate = null): array
    {
        if ($payLevel < GovernmentPayLevel::MIN || $payLevel > GovernmentPayLevel::MAX) {
            return [
                'rate' => 0.0,
                'slabNo' => null,
                'warning' => 'Night allowance rate is not configured for this Pay Level.',
                'basis' => self::BASIS_DUTY,
            ];
        }

        $onOrBefore = $periodEndDate ? Carbon::parse($periodEndDate)->toDateString() : null;
        $matches = [];
        foreach ($preloadedRates as $row) {
            if ((int) ($row['payLevel'] ?? 0) !== $payLevel) {
                continue;
            }
            if (($row['isActive'] ?? true) === false) {
                continue;
            }
            $eff = $row['effectiveFrom'] ?? null;
            if ($onOrBefore && $eff && Carbon::parse((string) $eff)->toDateString() > $onOrBefore) {
                continue;
            }
            $matches[] = $row;
        }

        usort($matches, function (array $a, array $b): int {
            $aHas = empty($a['effectiveFrom']) ? 1 : 0;
            $bHas = empty($b['effectiveFrom']) ? 1 : 0;
            if ($aHas !== $bHas) {
                return $aHas <=> $bHas;
            }
            $aEff = ! empty($a['effectiveFrom']) ? strtotime((string) $a['effectiveFrom']) : 0;
            $bEff = ! empty($b['effectiveFrom']) ? strtotime((string) $b['effectiveFrom']) : 0;
            if ($aEff !== $bEff) {
                return $bEff <=> $aEff;
            }

            return ((int) ($a['slabNo'] ?? 0)) <=> ((int) ($b['slabNo'] ?? 0));
        });

        $pick = $matches[0] ?? null;
        if ($pick) {
            return [
                'rate' => self::ratePerDuty($pick['ratePerDuty'] ?? null, (float) ($pick['ratePerHour'] ?? 0)),
                'slabNo' => isset($pick['slabNo']) ? (int) $pick['slabNo'] : null,
                'warning' => null,
                'basis' => self::BASIS_DUTY,
            ];
        }

        return [
            'rate' => 0.0,
            'slabNo' => null,
            'warning' => 'Night allowance rate is not configured for this Pay Level.',
            'basis' => self::BASIS_DUTY,
        ];
    }

    /**
     * Resolve active night allowance rate for an employee pay level.
     * Picks first row: effective_from <= period end (if given), then effective_from DESC NULLS LAST, slab_no ASC.
     *
     * @return array{rate: float, slabNo: int|null, warning: string|null}
     */
    public function resolveForPayLevel(string $companyId, int $payLevel, ?string $periodEndDate = null): array
    {
        if ($payLevel < GovernmentPayLevel::MIN || $payLevel > GovernmentPayLevel::MAX) {
            return [
                'rate' => 0.0,
                'slabNo' => null,
                'warning' => 'Night allowance rate is not configured for this Pay Level.',
                'basis' => self::BASIS_DUTY,
            ];
        }

        $q = HrmsNightAllowanceRate::query()
            ->where('company_id', $companyId)
            ->where('pay_level', $payLevel)
            ->where('is_active', true);

        if ($periodEndDate) {
            $onOrBefore = Carbon::parse($periodEndDate)->toDateString();
            $q->where(function ($w) use ($onOrBefore) {
                $w->whereNull('effective_from')
                    ->orWhereDate('effective_from', '<=', $onOrBefore);
            });
        }

        $match = $q
            ->orderByRaw('CASE WHEN effective_from IS NULL THEN 1 ELSE 0 END')
            ->orderByDesc('effective_from')
            ->orderBy('slab_no')
            ->first();

        if ($match) {
            return [
                'basis' => self::BASIS_DUTY,
                'rate' => self::ratePerDuty($match->rate_per_duty, (float) $match->rate_per_hour),
                'slabNo' => (int) $match->slab_no,
                'warning' => null,
            ];
        }

        return [
            'rate' => 0.0,
            'slabNo' => null,
            'warning' => 'Night allowance rate is not configured for this Pay Level.',
        ];
    }

    /**
     * @deprecated Use resolveForPayLevel(); employee master no longer stores slab selection.
     *
     * @return array{rate: float, slabNo: int|null, warning: string|null}
     */
    public function resolveForEmployee(string $companyId, int $payLevel, ?int $selectedSlabNo = null, ?string $periodEndDate = null): array
    {
        return $this->resolveForPayLevel($companyId, $payLevel, $periodEndDate);
    }

    /** @param array<string, mixed> $data */
    public function create(string $companyId, array $data): array
    {
        $slabNo = (int) ($data['slab_no'] ?? $data['slabNo'] ?? 0);
        $payLevel = (int) ($data['pay_level'] ?? $data['payLevel'] ?? 0);
        $rate = (float) ($data['rate_per_duty'] ?? $data['ratePerDuty'] ?? -1);

        $this->validateSlab($companyId, $slabNo, $payLevel, $rate);

        if (HrmsNightAllowanceRate::query()->where('company_id', $companyId)->where('slab_no', $slabNo)->exists()) {
            abort(422, 'Slab number already exists.');
        }

        $effectiveFrom = $data['effective_from'] ?? $data['effectiveFrom'] ?? null;
        $row = HrmsNightAllowanceRate::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'slab_no' => $slabNo,
            'pay_level' => $payLevel,
            'rate_per_duty' => round($rate, 2),
            'rate_per_hour' => round($rate, 2), // legacy column name; holds the same per-duty amount
            'effective_from' => $effectiveFrom ? Carbon::parse((string) $effectiveFrom)->toDateString() : null,
            'is_active' => (bool) ($data['is_active'] ?? $data['isActive'] ?? true),
        ]);

        return $this->formatRow($row);
    }

    /** @param array<string, mixed> $data */
    public function update(HrmsNightAllowanceRate $row, array $data): array
    {
        if ($row->company_id && isset($data['company_id']) && $data['company_id'] !== $row->company_id) {
            abort(403, 'Forbidden');
        }

        $slabNo = (int) ($data['slab_no'] ?? $data['slabNo'] ?? $row->slab_no);
        $payLevel = (int) ($data['pay_level'] ?? $data['payLevel'] ?? $row->pay_level);
        $rate = (float) ($data['rate_per_duty'] ?? $data['ratePerDuty'] ?? self::ratePerDuty($row->rate_per_duty, (float) $row->rate_per_hour));

        $this->validateSlab((string) $row->company_id, $slabNo, $payLevel, $rate);

        $duplicate = HrmsNightAllowanceRate::query()
            ->where('company_id', $row->company_id)
            ->where('slab_no', $slabNo)
            ->where('id', '!=', $row->id)
            ->exists();
        if ($duplicate) {
            abort(422, 'Slab number already exists.');
        }

        $effectiveFrom = array_key_exists('effective_from', $data) || array_key_exists('effectiveFrom', $data)
            ? (($data['effective_from'] ?? $data['effectiveFrom']) ? Carbon::parse((string) ($data['effective_from'] ?? $data['effectiveFrom']))->toDateString() : null)
            : $row->effective_from?->toDateString();

        $row->update([
            'slab_no' => $slabNo,
            'pay_level' => $payLevel,
            'rate_per_duty' => round($rate, 2),
            'rate_per_hour' => round($rate, 2), // legacy column name; holds the same per-duty amount
            'effective_from' => $effectiveFrom,
            'is_active' => array_key_exists('is_active', $data) || array_key_exists('isActive', $data)
                ? (bool) ($data['is_active'] ?? $data['isActive'])
                : $row->is_active,
        ]);

        return $this->formatRow($row->refresh());
    }

    public function deactivate(HrmsNightAllowanceRate $row): array
    {
        $row->update(['is_active' => false]);

        return $this->formatRow($row->refresh());
    }

    private function validateSlab(string $companyId, int $slabNo, int $payLevel, float $rate): void
    {
        if ($slabNo < 1) {
            abort(422, 'Slab No is required.');
        }
        if (! GovernmentPayLevel::isValid($payLevel)) {
            abort(422, GovernmentPayLevel::requiredMessage());
        }
        if ($rate < 0) {
            abort(422, 'Night allowance rate is required.');
        }
    }

    public const DEFAULT_BASIC_CEILING = 43600.0;

    /**
     * @return array{amount: float, eligible: bool, warning: string|null, ceiling: float}
     */
    public function resolveAmountWithCeiling(
        float $hours,
        float $rate,
        float $basicPay,
        float $ceiling,
        bool $manualOverride = false,
        ?float $manualAmount = null,
        string $rateBasis = self::BASIS_HOUR,
    ): array {
        $ceiling = max(0, $ceiling > 0 ? $ceiling : self::DEFAULT_BASIC_CEILING);
        $basic = max(0, $basicPay);
        $eligible = $basic <= $ceiling;

        if (! $eligible) {
            return [
                'amount' => 0.0,
                'eligible' => false,
                'warning' => sprintf(
                    'Not eligible for Night Allowance: Basic Pay exceeds ₹%s ceiling.',
                    number_format($ceiling, 0, '.', ',')
                ),
                'ceiling' => $ceiling,
            ];
        }

        $amount = self::allowanceAmount($hours, $rate, $rateBasis);
        if ($manualOverride && $manualAmount !== null) {
            $amount = round(max(0, $manualAmount), 2);
        }

        return [
            'amount' => $amount,
            'eligible' => true,
            'warning' => null,
            'ceiling' => $ceiling,
        ];
    }

    /**
     * Enforce ceiling on government monthly preview payload before persistence.
     *
     * @param  array<string, mixed>  $gm
     */
    public function enforceCeilingOnGovernmentMonthly(array &$gm, float $ceiling): void
    {
        $basicPaid = (float) ($gm['basicPaid'] ?? $gm['basic_paid'] ?? 0);
        $basicActual = (float) ($gm['basicActual'] ?? $gm['basic_actual'] ?? 0);
        $basicForCeiling = $basicPaid > 0 ? $basicPaid : $basicActual;

        $hours = (float) ($gm['nightHours'] ?? $gm['night_hours'] ?? 0);
        $rate = (float) ($gm['nightAllowanceRate'] ?? $gm['night_allowance_rate'] ?? 0);
        // A payload with no basis predates the per-duty rate (hourly rate); `payroll:repair-data` moves open drafts to 'duty'.
        $rateBasis = ($gm['nightAllowanceRateBasis'] ?? $gm['night_allowance_rate_basis'] ?? null) === self::BASIS_DUTY ? self::BASIS_DUTY : self::BASIS_HOUR;
        $manualOverride = (bool) ($gm['nightAllowanceManualOverride'] ?? $gm['night_allowance_manual_override'] ?? false);
        $oldAmount = (float) ($gm['nightAllowancePaid'] ?? $gm['night_allowance_paid'] ?? $gm['nightAllowanceAmount'] ?? 0);

        $resolved = $this->resolveAmountWithCeiling(
            $hours,
            $rate,
            $basicForCeiling,
            $ceiling,
            $manualOverride,
            $manualOverride ? $oldAmount : null,
            $rateBasis,
        );

        $newAmount = (float) $resolved['amount'];
        $gm['nightAllowancePaid'] = $newAmount;
        $gm['nightAllowanceAmount'] = $newAmount;
        $gm['night_allowance_paid'] = $newAmount;
        $gm['night_allowance_amount'] = $newAmount;
        $gm['nightAllowanceActual'] = $newAmount;
        $gm['night_allowance_actual'] = $newAmount;
        $gm['nightAllowanceEligible'] = $resolved['eligible'];
        $gm['night_allowance_eligible'] = $resolved['eligible'];
        $gm['nightAllowanceBasicCeiling'] = $resolved['ceiling'];
        $gm['night_allowance_basic_ceiling'] = $resolved['ceiling'];
        if (! $resolved['eligible']) {
            $gm['nightAllowanceManualOverride'] = false;
            $gm['night_allowance_manual_override'] = false;
            if ($resolved['warning']) {
                $gm['nightAllowanceWarning'] = $resolved['warning'];
            }
        }

        $delta = $newAmount - $oldAmount;
        if (abs($delta) > 0.0001) {
            $gm['totalEarnings'] = max(0, (float) ($gm['totalEarnings'] ?? $gm['total_earnings'] ?? 0) + $delta);
            $gm['total_earnings'] = $gm['totalEarnings'];
            $gm['netSalary'] = max(0, (float) ($gm['netSalary'] ?? $gm['net_salary'] ?? 0) + $delta);
            $gm['net_salary'] = $gm['netSalary'];
        }
    }

    /** @return array<string, mixed> */
    public function formatRow(HrmsNightAllowanceRate $r): array
    {
        return [
            'id' => $r->id,
            'slabNo' => (int) $r->slab_no,
            'payLevel' => (int) $r->pay_level,
            'ratePerHour' => (float) $r->rate_per_hour,
            'ratePerDuty' => self::ratePerDuty($r->rate_per_duty, (float) $r->rate_per_hour),
            'effectiveFrom' => $r->effective_from?->toDateString(),
            'isActive' => (bool) $r->is_active,
            'label' => sprintf('S.No %d - Level %d - ₹%s/duty', $r->slab_no, $r->pay_level, number_format(self::ratePerDuty($r->rate_per_duty, (float) $r->rate_per_hour), 2)),
        ];
    }
}
