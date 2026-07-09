<?php

namespace App\Services;

use App\Models\HrmsNightAllowanceRate;
use App\Support\GovernmentPayLevel;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class NightAllowanceRateService
{
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
                'rate' => (float) $match->rate_per_hour,
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
        $rate = (float) ($data['rate_per_hour'] ?? $data['ratePerHour'] ?? -1);

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
            'rate_per_hour' => round($rate, 2),
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
        $rate = (float) ($data['rate_per_hour'] ?? $data['ratePerHour'] ?? $row->rate_per_hour);

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
            'rate_per_hour' => round($rate, 2),
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

        $amount = $hours > 0 ? round(max(0, $hours) * max(0, $rate)) : 0.0;
        if ($manualOverride && $manualAmount !== null) {
            $amount = round(max(0, $manualAmount));
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
        $manualOverride = (bool) ($gm['nightAllowanceManualOverride'] ?? $gm['night_allowance_manual_override'] ?? false);
        $oldAmount = (float) ($gm['nightAllowancePaid'] ?? $gm['night_allowance_paid'] ?? $gm['nightAllowanceAmount'] ?? 0);

        $resolved = $this->resolveAmountWithCeiling(
            $hours,
            $rate,
            $basicForCeiling,
            $ceiling,
            $manualOverride,
            $manualOverride ? $oldAmount : null,
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
            'effectiveFrom' => $r->effective_from?->toDateString(),
            'isActive' => (bool) $r->is_active,
            'label' => sprintf('S.No %d - Level %d - ₹%s/hr', $r->slab_no, $r->pay_level, number_format((float) $r->rate_per_hour, 2)),
        ];
    }
}
