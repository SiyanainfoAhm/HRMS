<?php

namespace App\Services;

use App\Models\HrmsElectricityTariff;
use App\Models\HrmsElectricityTariffSlab;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ElectricityTariffService
{
    /**
     * @param  list<array{from_unit?: mixed, to_unit?: mixed, rate_per_unit?: mixed, sort_order?: mixed}>  $slabs
     * @return list<string>
     */
    public function validateSlabs(array $slabs): array
    {
        $errors = [];
        if ($slabs === []) {
            return ['At least one slab is required.'];
        }

        $normalized = $this->normalizeSlabs($slabs);
        foreach ($normalized as $i => $s) {
            $n = $i + 1;
            if ($s['from_unit'] < 0 || $s['rate_per_unit'] < 0) {
                $errors[] = "Slab {$n}: units and rate must be >= 0.";
            }
            if ($s['to_unit'] !== null && $s['to_unit'] < $s['from_unit']) {
                $errors[] = "Slab {$n}: upper unit must be >= lower unit.";
            }
            if ($s['to_unit'] === null && $i !== count($normalized) - 1) {
                $errors[] = 'Only the last slab may have no upper limit.';
            }
        }

        for ($i = 1; $i < count($normalized); $i++) {
            $prev = $normalized[$i - 1];
            $cur = $normalized[$i];
            if ($prev['to_unit'] === null) {
                $errors[] = 'A slab after an open-ended slab is not allowed.';
                break;
            }
            if ($cur['from_unit'] <= $prev['to_unit']) {
                $errors[] = "Slabs overlap: {$prev['from_unit']}–{$prev['to_unit']} and {$cur['from_unit']}–".($cur['to_unit'] ?? '∞').'.';
            } elseif ($cur['from_unit'] !== $prev['to_unit'] + 1) {
                $expected = $prev['to_unit'] + 1;
                $errors[] = "Gap between slabs: expected next from {$expected}, got {$cur['from_unit']}.";
            }
        }

        if (($normalized[0]['from_unit'] ?? 0) > 1) {
            $errors[] = 'First slab should start at 0 or 1.';
        }

        return $errors;
    }

    /**
     * Progressive slab charge.
     *
     * @param  list<array{from_unit: int, to_unit: ?int, rate_per_unit: float}>  $slabs
     * @return array{charge: float, portions: list<array<string, mixed>>}
     */
    public function calculateSlabCharge(float $units, array $slabs): array
    {
        $u = max(0, $units);
        $sorted = $this->normalizeSlabs($slabs);
        $portions = [];
        if ($u <= 0 || $sorted === []) {
            return ['charge' => 0.0, 'portions' => []];
        }

        $billed = 0.0;
        foreach ($sorted as $slab) {
            if ($billed >= $u) {
                break;
            }
            $upper = $slab['to_unit'] === null ? INF : (float) $slab['to_unit'];
            $capacity = is_finite($upper) ? max(0, $upper - $billed) : INF;
            $take = min($u - $billed, $capacity);
            if ($take <= 0) {
                continue;
            }
            $amount = $this->roundMoney2($take * $slab['rate_per_unit']);
            $portions[] = [
                'fromUnit' => $slab['from_unit'],
                'toUnit' => $slab['to_unit'],
                'units' => $take,
                'ratePerUnit' => $slab['rate_per_unit'],
                'amount' => $amount,
            ];
            $billed += $take;
        }

        $charge = $this->roundMoney2(array_sum(array_column($portions, 'amount')));

        return ['charge' => $charge, 'portions' => $portions];
    }

    /**
     * @param  array<string, mixed>|null  $tariff
     * @return array<string, mixed>
     */
    public function calculateBill(
        float $units,
        ?array $tariff,
        bool $applicable = true,
        string $mode = 'unit_based',
        float $legacyUnitRate = 0,
        float $fixedAmount = 0,
        bool $manualOverride = false,
        ?float $manualAmount = null,
    ): array {
        $units = max(0, $units);
        // Mirrors electricityTariffCalculation.ts: the stored mode is only a
        // hint. Master's manual_fixed amount applies while no units are recorded;
        // positive consumption is always billed from the tariff.
        $mode = ($mode === 'manual_fixed' && $units <= 0) ? 'manual_fixed' : 'unit_based';
        if (! $applicable) {
            return $this->emptyBill($units, $mode, $tariff['id'] ?? null, $manualOverride, $manualAmount);
        }

        if ($manualOverride && $manualAmount !== null) {
            $base = $this->computeTariffBreakdown($units, $tariff, $legacyUnitRate, $fixedAmount);
            $rounded = $this->roundDeduction($manualAmount);
            $base['manualOverride'] = true;
            $base['manualAmount'] = $rounded;
            $base['total'] = $rounded;
            $base['totalExact'] = $rounded;
            $base['units'] = $units;
            $base['applicable'] = true;
            $base['mode'] = $mode;

            return $base;
        }

        if ($mode === 'manual_fixed') {
            $fixed = $this->roundDeduction($fixedAmount);
            $out = $this->emptyBill($units, $mode, $tariff['id'] ?? null, false, null);
            $out['total'] = $fixed;
            $out['totalExact'] = $fixed;
            $out['consumptionCharge'] = $fixed;
            $out['subtotal'] = $fixed;

            return $out;
        }

        $base = $this->computeTariffBreakdown($units, $tariff, $legacyUnitRate, $fixedAmount);
        $base['units'] = $units;
        $base['applicable'] = true;
        $base['mode'] = $mode;
        $base['manualOverride'] = false;
        $base['manualAmount'] = null;

        return $base;
    }

    public function resolveForDate(string $companyId, string $asOfDate): ?HrmsElectricityTariff
    {
        return HrmsElectricityTariff::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $asOfDate)
            ->with('slabs')
            ->orderByDesc('effective_from')
            ->first();
    }

    /** @return list<array<string, mixed>> */
    public function listForCompany(string $companyId, bool $activeOnly = false): array
    {
        $q = HrmsElectricityTariff::query()
            ->where('company_id', $companyId)
            ->with('slabs')
            ->orderByDesc('effective_from');
        if ($activeOnly) {
            $q->where('is_active', true);
        }

        return $q->get()->map(fn (HrmsElectricityTariff $t) => $this->formatTariff($t))->all();
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $companyId, array $payload, ?string $createdBy = null): array
    {
        $data = $this->validatedPayload($payload);
        $this->assertUniqueEffectiveFrom($companyId, $data['effective_from'], null);
        $this->assertEffectiveDateIsSafe($companyId, $data['effective_from']);

        return DB::transaction(function () use ($companyId, $data, $createdBy) {
            $tariff = HrmsElectricityTariff::create([
                'id' => (string) Str::uuid(),
                'company_id' => $companyId,
                'effective_from' => $data['effective_from'],
                'sthir_aakar' => $data['sthir_aakar'],
                'vahan_aakar_per_unit' => $data['vahan_aakar_per_unit'],
                'fuel_charge' => $data['fuel_charge'],
                'duty_percentage' => $data['duty_percentage'],
                'is_active' => $data['is_active'],
                'created_by' => $createdBy,
            ]);
            $this->replaceSlabs($tariff, $data['slabs']);

            return $this->formatTariff($tariff->fresh('slabs'));
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(HrmsElectricityTariff $tariff, array $payload): array
    {
        $data = $this->validatedPayload($payload, true);
        $this->assertEditable($tariff);
        if (isset($data['effective_from'])) {
            $this->assertEffectiveDateIsSafe((string) $tariff->company_id, $data['effective_from']);
            $this->assertUniqueEffectiveFrom((string) $tariff->company_id, $data['effective_from'], (string) $tariff->id);
        }

        return DB::transaction(function () use ($tariff, $data) {
            $tariff->fill(array_filter([
                'effective_from' => $data['effective_from'] ?? null,
                'sthir_aakar' => $data['sthir_aakar'] ?? null,
                'vahan_aakar_per_unit' => $data['vahan_aakar_per_unit'] ?? null,
                'fuel_charge' => $data['fuel_charge'] ?? null,
                'duty_percentage' => $data['duty_percentage'] ?? null,
                'is_active' => $data['is_active'] ?? null,
            ], static fn ($v) => $v !== null));
            $tariff->save();
            if (isset($data['slabs'])) {
                $this->replaceSlabs($tariff, $data['slabs']);
            }

            return $this->formatTariff($tariff->fresh('slabs'));
        });
    }

    public function deactivate(HrmsElectricityTariff $tariff): array
    {
        $this->assertEditable($tariff);
        $tariff->update(['is_active' => false]);

        return $this->formatTariff($tariff->fresh('slabs'));
    }

    /** @return array<string, mixed> */
    public function formatTariff(HrmsElectricityTariff $tariff): array
    {
        $slabs = $tariff->relationLoaded('slabs')
            ? $tariff->slabs
            : $tariff->slabs()->orderBy('sort_order')->get();

        return [
            'id' => $tariff->id,
            'companyId' => $tariff->company_id,
            'effectiveFrom' => $tariff->effective_from?->format('Y-m-d'),
            'sthirAakar' => (float) $tariff->sthir_aakar,
            'vahanAakarPerUnit' => (float) $tariff->vahan_aakar_per_unit,
            'fuelCharge' => (float) $tariff->fuel_charge,
            'dutyPercentage' => (float) $tariff->duty_percentage,
            'isActive' => (bool) $tariff->is_active,
            'slabs' => $slabs->map(fn (HrmsElectricityTariffSlab $s) => [
                'id' => $s->id,
                'fromUnit' => (int) $s->from_unit,
                'toUnit' => $s->to_unit === null ? null : (int) $s->to_unit,
                'ratePerUnit' => (float) $s->rate_per_unit,
                'fuelChargePerUnit' => (float) ($s->fuel_charge_per_unit ?? 0),
                'sortOrder' => (int) $s->sort_order,
            ])->values()->all(),
        ];
    }

    public function roundMoney2(float $n): float
    {
        return round(max(0, $n), 2);
    }

    public function roundDeduction(float $n): float
    {
        // The final electricity deduction is the exact bill to 2 decimals (paise), no whole-rupee rounding.
        return \App\Support\Money::round2(max(0, $n));
    }

    /**
     * @param  array<string, mixed>|null  $tariff
     * @return array<string, mixed>
     */
    private function computeTariffBreakdown(float $units, ?array $tariff, float $legacyUnitRate, float $fixedAmount): array
    {
        $slabs = is_array($tariff['slabs'] ?? null) ? $tariff['slabs'] : [];
        if ($tariff && $slabs !== []) {
            $sthir = $this->roundMoney2((float) ($tariff['sthirAakar'] ?? $tariff['sthir_aakar'] ?? 0));
            $vahanRate = max(0, (float) ($tariff['vahanAakarPerUnit'] ?? $tariff['vahan_aakar_per_unit'] ?? 0));
            $dutyPct = max(0, (float) ($tariff['dutyPercentage'] ?? $tariff['duty_percentage'] ?? 0));
            $slabInput = array_map(static function ($s) {
                return [
                    'from_unit' => $s['fromUnit'] ?? $s['from_unit'] ?? 0,
                    'to_unit' => array_key_exists('toUnit', $s) ? $s['toUnit'] : ($s['to_unit'] ?? null),
                    'rate_per_unit' => $s['ratePerUnit'] ?? $s['rate_per_unit'] ?? 0,
                    'fuel_charge_per_unit' => $s['fuelChargePerUnit'] ?? $s['fuel_charge_per_unit'] ?? 0,
                    'sort_order' => $s['sortOrder'] ?? $s['sort_order'] ?? 0,
                ];
            }, $slabs);
            $calc = $this->calculateSlabCharge($units, $slabInput);
            $hasDynamicFuel = collect($slabs)->contains(
                fn (array $s) => array_key_exists('fuelChargePerUnit', $s) || array_key_exists('fuel_charge_per_unit', $s),
            );
            $fuelInput = array_map(static fn (array $s) => [...$s, 'rate_per_unit' => $s['fuel_charge_per_unit'] ?? 0], $slabInput);
            $fuel = $hasDynamicFuel
                ? $this->calculateSlabCharge($units, $fuelInput)['charge']
                : $this->roundMoney2((float) ($tariff['fuelCharge'] ?? $tariff['fuel_charge'] ?? 0));
            $vahan = $this->roundMoney2($units * $vahanRate);
            $subtotal = $this->roundMoney2($sthir + $calc['charge'] + $vahan + $fuel);
            $duty = $this->roundMoney2(($subtotal * $dutyPct) / 100);
            $exact = $this->roundMoney2($subtotal + $duty);

            return [
                'tariffId' => $tariff['id'] ?? null,
                'sthirAakar' => $sthir,
                'consumptionCharge' => $calc['charge'],
                'vahanAakar' => $vahan,
                'fuelCharge' => $fuel,
                'subtotal' => $subtotal,
                'dutyPercentage' => $dutyPct,
                'dutyAmount' => $duty,
                'totalExact' => $exact,
                'total' => $this->roundDeduction($exact),
                'slabPortions' => $calc['portions'],
            ];
        }

        if ($units > 0 && $legacyUnitRate > 0) {
            $charge = $this->roundMoney2($units * $legacyUnitRate);

            return [
                'tariffId' => null,
                'sthirAakar' => 0.0,
                'consumptionCharge' => $charge,
                'vahanAakar' => 0.0,
                'fuelCharge' => 0.0,
                'subtotal' => $charge,
                'dutyPercentage' => 0.0,
                'dutyAmount' => 0.0,
                'totalExact' => $charge,
                'total' => $this->roundDeduction($charge),
                'slabPortions' => [[
                    'fromUnit' => 0,
                    'toUnit' => $units,
                    'units' => $units,
                    'ratePerUnit' => $legacyUnitRate,
                    'amount' => $charge,
                ]],
            ];
        }

        $fixed = $this->roundDeduction($fixedAmount);

        return [
            'tariffId' => null,
            'sthirAakar' => 0.0,
            'consumptionCharge' => $fixed,
            'vahanAakar' => 0.0,
            'fuelCharge' => 0.0,
            'subtotal' => $fixed,
            'dutyPercentage' => 0.0,
            'dutyAmount' => 0.0,
            'totalExact' => $fixed,
            'total' => $fixed,
            'slabPortions' => [],
        ];
    }

    /** @return array<string, mixed> */
    private function emptyBill(float $units, string $mode, ?string $tariffId, bool $manualOverride, ?float $manualAmount): array
    {
        return [
            'units' => $units,
            'applicable' => false,
            'mode' => $mode,
            'tariffId' => $tariffId,
            'sthirAakar' => 0.0,
            'consumptionCharge' => 0.0,
            'vahanAakar' => 0.0,
            'fuelCharge' => 0.0,
            'subtotal' => 0.0,
            'dutyPercentage' => 0.0,
            'dutyAmount' => 0.0,
            'totalExact' => 0.0,
            'total' => 0.0,
            'slabPortions' => [],
            'manualOverride' => $manualOverride,
            'manualAmount' => $manualAmount,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $slabs
     * @return list<array{from_unit: int, to_unit: ?int, rate_per_unit: float, sort_order: int}>
     */
    private function normalizeSlabs(array $slabs): array
    {
        $out = [];
        foreach ($slabs as $i => $s) {
            $to = $s['to_unit'] ?? $s['toUnit'] ?? null;
            $out[] = [
                'from_unit' => max(0, (int) ($s['from_unit'] ?? $s['fromUnit'] ?? 0)),
                'to_unit' => $to === null || $to === '' ? null : max(0, (int) $to),
                'rate_per_unit' => max(0, (float) ($s['rate_per_unit'] ?? $s['ratePerUnit'] ?? 0)),
                'fuel_charge_per_unit' => max(0, (float) ($s['fuel_charge_per_unit'] ?? $s['fuelChargePerUnit'] ?? 0)),
                'sort_order' => (int) ($s['sort_order'] ?? $s['sortOrder'] ?? ($i + 1)),
            ];
        }
        usort($out, static fn ($a, $b) => $a['sort_order'] <=> $b['sort_order'] ?: $a['from_unit'] <=> $b['from_unit']);

        return $out;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function validatedPayload(array $payload, bool $partial = false): array
    {
        $effectiveFrom = $payload['effective_from'] ?? $payload['effectiveFrom'] ?? null;
        $slabsRaw = $payload['slabs'] ?? null;

        if (! $partial || $effectiveFrom !== null) {
            if (! is_string($effectiveFrom) || trim($effectiveFrom) === '') {
                throw ValidationException::withMessages(['effectiveFrom' => 'Effective from date is required.']);
            }
        }

        // On a partial update a field that was not sent stays null (= leave unchanged).
        // Coercing it to 0 / true zeroed the charges and re-activated a deactivated
        // tariff whenever only the slabs (or only the flag) were edited.
        $pick = static function (array $keys) use ($payload, $partial): ?float {
            foreach ($keys as $key) {
                if (array_key_exists($key, $payload) && $payload[$key] !== null && $payload[$key] !== '') return (float) $payload[$key];
            }

            return $partial ? null : 0.0;
        };
        $sthir = $pick(['sthir_aakar', 'sthirAakar']);
        $vahan = $pick(['vahan_aakar_per_unit', 'vahanAakarPerUnit']);
        $fuel = $pick(['fuel_charge', 'fuelCharge']);
        $duty = $pick(['duty_percentage', 'dutyPercentage']);

        foreach ([$sthir, $vahan, $fuel, $duty] as $charge) {
            if ($charge !== null && $charge < 0) {
                throw ValidationException::withMessages(['tariff' => 'Charges and duty percentage must be >= 0.']);
            }
        }
        $activeRaw = $payload['is_active'] ?? $payload['isActive'] ?? null;

        $data = [
            'effective_from' => $effectiveFrom ? substr((string) $effectiveFrom, 0, 10) : null,
            'sthir_aakar' => $sthir,
            'vahan_aakar_per_unit' => $vahan,
            'fuel_charge' => $fuel,
            'duty_percentage' => $duty,
            'is_active' => $activeRaw === null ? ($partial ? null : true) : filter_var($activeRaw, FILTER_VALIDATE_BOOLEAN),
        ];

        if (is_array($slabsRaw)) {
            $slabErrors = $this->validateSlabs($slabsRaw);
            if ($slabErrors !== []) {
                throw ValidationException::withMessages(['slabs' => $slabErrors[0]]);
            }
            $data['slabs'] = $this->normalizeSlabs($slabsRaw);
        } elseif (! $partial) {
            throw ValidationException::withMessages(['slabs' => 'Slabs are required.']);
        }

        return $data;
    }

    /**
     * @param  list<array{from_unit: int, to_unit: ?int, rate_per_unit: float, sort_order: int}>  $slabs
     */
    private function replaceSlabs(HrmsElectricityTariff $tariff, array $slabs): void
    {
        $tariff->slabs()->delete();
        foreach ($slabs as $slab) {
            HrmsElectricityTariffSlab::create([
                'id' => (string) Str::uuid(),
                'tariff_id' => $tariff->id,
                'from_unit' => $slab['from_unit'],
                'to_unit' => $slab['to_unit'],
                'rate_per_unit' => $slab['rate_per_unit'],
                'fuel_charge_per_unit' => $slab['fuel_charge_per_unit'],
                'sort_order' => $slab['sort_order'],
            ]);
        }
    }

    /** Today in the business timezone (effective dates are calendar dates in India). */
    private function today(): string
    {
        return \Illuminate\Support\Carbon::now('Asia/Kolkata')->toDateString();
    }

    /**
     * A tariff that is already in force (effective date today or earlier) is part of
     * history: months are billed from it, drafts reconcile against it and generated
     * payroll snapshots reference it. It is never edited or deactivated in place;
     * create a new tariff with a new effective date instead.
     */
    private function assertEditable(HrmsElectricityTariff $tariff): void
    {
        $from = $tariff->effective_from?->format('Y-m-d');
        if ($from !== null && $from <= $this->today()) {
            throw ValidationException::withMessages([
                'tariff' => 'This tariff is already in force (effective '.$from.') and cannot be edited or deactivated, because that would change billing for months already drafted or finalized. Create a new tariff with a new effective date instead.',
            ]);
        }
    }

    /**
     * A new tariff must start after every month that already has a draft or a
     * generated payroll, otherwise it would silently re-bill those months. The very
     * first tariff of a company is exempt.
     */
    private function assertEffectiveDateIsSafe(string $companyId, string $effectiveFrom): void
    {
        $locked = $this->lastLockedMonthEnd($companyId);
        if ($locked !== null && $effectiveFrom <= $locked) {
            throw ValidationException::withMessages([
                'effectiveFrom' => "Effective date must be after {$locked}: payroll for that month is drafted or already generated, and a tariff starting on or before it would change those amounts. Choose a later date.",
            ]);
        }
    }

    private function lastLockedMonthEnd(string $companyId): ?string
    {
        if (! HrmsElectricityTariff::query()->where('company_id', $companyId)->exists()) {
            return null;
        }
        $ends = [];
        $draft = DB::table('cirt_payroll_drafts')->where('company_id', $companyId)->where('status', 'draft')
            ->orderByDesc('payroll_year')->orderByDesc('payroll_month')->first(['payroll_year', 'payroll_month']);
        if ($draft) {
            $ends[] = \Illuminate\Support\Carbon::create((int) $draft->payroll_year, (int) $draft->payroll_month, 1)->endOfMonth()->toDateString();
        }
        $period = DB::table('cirt_payroll_periods')->where('company_id', $companyId)->orderByDesc('period_start')->value('period_start');
        if ($period) {
            $ends[] = \Illuminate\Support\Carbon::parse($period)->endOfMonth()->toDateString();
        }

        return $ends === [] ? null : max($ends);
    }

    private function assertUniqueEffectiveFrom(string $companyId, string $effectiveFrom, ?string $exceptId): void
    {
        $q = HrmsElectricityTariff::query()
            ->where('company_id', $companyId)
            ->whereDate('effective_from', $effectiveFrom);
        if ($exceptId) {
            $q->where('id', '!=', $exceptId);
        }
        if ($q->exists()) {
            throw ValidationException::withMessages([
                'effectiveFrom' => 'A tariff already exists for this effective date.',
            ]);
        }
    }
}
