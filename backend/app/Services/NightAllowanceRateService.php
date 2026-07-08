<?php

namespace App\Services;

use App\Models\HrmsNightAllowanceRate;
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
     * Resolve rate for employee: selected slab, else first active slab for pay level.
     *
     * @return array{rate: float, slabNo: int|null, warning: string|null}
     */
    public function resolveForEmployee(string $companyId, int $payLevel, ?int $selectedSlabNo = null): array
    {
        if ($selectedSlabNo !== null && $selectedSlabNo > 0) {
            $row = $this->findBySlabNo($companyId, $selectedSlabNo, true);
            if ($row) {
                if ((int) $row['payLevel'] !== $payLevel) {
                    return [
                        'rate' => (float) $row['ratePerHour'],
                        'slabNo' => (int) $row['slabNo'],
                        'warning' => 'Selected night allowance slab pay level does not match employee pay level.',
                    ];
                }

                return [
                    'rate' => (float) $row['ratePerHour'],
                    'slabNo' => (int) $row['slabNo'],
                    'warning' => null,
                ];
            }
        }

        $match = HrmsNightAllowanceRate::query()
            ->where('company_id', $companyId)
            ->where('pay_level', $payLevel)
            ->where('is_active', true)
            ->orderBy('slab_no')
            ->first();

        if ($match) {
            return [
                'rate' => (float) $match->rate_per_hour,
                'slabNo' => (int) $match->slab_no,
                'warning' => $selectedSlabNo === null || $selectedSlabNo <= 0
                    ? 'Night allowance slab not selected. Default matching rate used.'
                    : null,
            ];
        }

        return [
            'rate' => 0.0,
            'slabNo' => null,
            'warning' => 'Night allowance slab not configured for this employee pay level.',
        ];
    }

    /** @param array<string, mixed> $data */
    public function create(string $companyId, array $data): array
    {
        $slabNo = (int) ($data['slab_no'] ?? $data['slabNo'] ?? 0);
        $payLevel = (int) ($data['pay_level'] ?? $data['payLevel'] ?? 0);
        $rate = (float) ($data['rate_per_hour'] ?? $data['ratePerHour'] ?? -1);

        $this->validateSlab($companyId, $slabNo, $payLevel, $rate);

        if (HrmsNightAllowanceRate::query()->where('company_id', $companyId)->where('slab_no', $slabNo)->exists()) {
            abort(422, 'Duplicate slab number is not allowed.');
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
            abort(422, 'Duplicate slab number is not allowed.');
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
        if ($payLevel < 1) {
            abort(422, 'Pay Level is required.');
        }
        if ($rate < 0) {
            abort(422, 'Night allowance rate is required.');
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
