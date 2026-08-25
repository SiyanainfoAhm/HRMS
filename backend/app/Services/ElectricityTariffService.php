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
        if (isset($data['effective_from'])) {
            $this->assertUniqueEffectiveFrom((string) $tariff->company_id, $data['effective_from'], (string) $tariff->id);
        }

        return DB::transaction(function () use ($tariff, $data) {
            $tariff->fill(array_filter([
                'effective_from' => $data['effective_from'] ?? null,
                'sthir_aakar' => $data['sthir_aakar'] ?? null,
                'vahan_aakar_per_unit' => $data['vahan_aakar_per_unit'] ?? null,
                'fuel_charge' => $data['fuel_charge'] ?? null,
                'duty_percentage' => $data['duty_percentage'] ?? null,
                'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : null,
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
        return (float) round(max(0, $n));
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
            $fuel = $this->roundMoney2((float) ($tariff['fuelCharge'] ?? $tariff['fuel_charge'] ?? 0));
            $vahanRate = max(0, (float) ($tariff['vahanAakarPerUnit'] ?? $tariff['vahan_aakar_per_unit'] ?? 0));
            $dutyPct = max(0, (float) ($tariff['dutyPercentage'] ?? $tariff['duty_percentage'] ?? 0));
            $slabInput = array_map(static function ($s) {
                return [
                    'from_unit' => $s['fromUnit'] ?? $s['from_unit'] ?? 0,
                    'to_unit' => array_key_exists('toUnit', $s) ? $s['toUnit'] : ($s['to_unit'] ?? null),
                    'rate_per_unit' => $s['ratePerUnit'] ?? $s['rate_per_unit'] ?? 0,
                    'sort_order' => $s['sortOrder'] ?? $s['sort_order'] ?? 0,
                ];
            }, $slabs);
            $calc = $this->calculateSlabCharge($units, $slabInput);
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

        $sthir = (float) ($payload['sthir_aakar'] ?? $payload['sthirAakar'] ?? 0);
        $vahan = (float) ($payload['vahan_aakar_per_unit'] ?? $payload['vahanAakarPerUnit'] ?? 0);
        $fuel = (float) ($payload['fuel_charge'] ?? $payload['fuelCharge'] ?? 0);
        $duty = (float) ($payload['duty_percentage'] ?? $payload['dutyPercentage'] ?? 0);

        if ($sthir < 0 || $vahan < 0 || $fuel < 0 || $duty < 0) {
            throw ValidationException::withMessages(['tariff' => 'Charges and duty percentage must be >= 0.']);
        }

        $data = [
            'effective_from' => $effectiveFrom ? substr((string) $effectiveFrom, 0, 10) : null,
            'sthir_aakar' => $sthir,
            'vahan_aakar_per_unit' => $vahan,
            'fuel_charge' => $fuel,
            'duty_percentage' => $duty,
            'is_active' => filter_var($payload['is_active'] ?? $payload['isActive'] ?? true, FILTER_VALIDATE_BOOLEAN),
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
                'sort_order' => $slab['sort_order'],
            ]);
        }
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
