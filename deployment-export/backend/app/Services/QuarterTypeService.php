<?php

namespace App\Services;

use App\Models\HrmsQuarter;
use App\Models\HrmsQuarterType;
use App\Support\QuarterTypes;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class QuarterTypeService
{
    /** @return list<array<string, mixed>> */
    public function listForCompany(string $companyId, bool $activeOnly = false, ?string $includeId = null): array
    {
        $this->ensureDefaults($companyId);

        $query = HrmsQuarterType::query()
            ->where('company_id', $companyId)
            ->orderByRaw('sort_order nulls last')
            ->orderBy('name');

        if ($activeOnly) {
            $query->where(function ($q) use ($includeId) {
                $q->where('is_active', true);
                if ($includeId) {
                    $q->orWhere('id', $includeId);
                }
            });
        }

        return $query->get()->map(fn (HrmsQuarterType $t) => $this->format($t))->values()->all();
    }

    /** @param array<string, mixed> $data */
    public function create(string $companyId, string $userId, array $data): array
    {
        $name = $this->normalizeDisplayName($data['name'] ?? $data['quarterType'] ?? $data['quarter_type'] ?? '');
        $this->assertValidTypeName($name);
        $normalized = $this->normalizeKey($name);

        if (
            HrmsQuarterType::query()
                ->where('company_id', $companyId)
                ->where('normalized_name', $normalized)
                ->exists()
        ) {
            throw ValidationException::withMessages([
                'name' => ['A quarter type with this name already exists.'],
            ]);
        }

        $maxSort = (int) HrmsQuarterType::query()->where('company_id', $companyId)->max('sort_order');

        $row = HrmsQuarterType::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'name' => $name,
            'normalized_name' => $normalized,
            'is_active' => true,
            'sort_order' => $maxSort + 1,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        return $this->format($row);
    }

    /** @param array<string, mixed> $data */
    public function update(HrmsQuarterType $type, string $companyId, string $userId, array $data): array
    {
        if ($type->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        $attrs = ['updated_by' => $userId];

        if (array_key_exists('name', $data) || array_key_exists('quarterType', $data) || array_key_exists('quarter_type', $data)) {
            $name = $this->normalizeDisplayName($data['name'] ?? $data['quarterType'] ?? $data['quarter_type'] ?? '');
            $this->assertValidTypeName($name);
            $normalized = $this->normalizeKey($name);
            if (
                HrmsQuarterType::query()
                    ->where('company_id', $companyId)
                    ->where('normalized_name', $normalized)
                    ->where('id', '!=', $type->id)
                    ->exists()
            ) {
                throw ValidationException::withMessages([
                    'name' => ['A quarter type with this name already exists.'],
                ]);
            }
            $attrs['name'] = $name;
            $attrs['normalized_name'] = $normalized;
        }

        if (array_key_exists('is_active', $data) || array_key_exists('isActive', $data)) {
            $attrs['is_active'] = (bool) ($data['is_active'] ?? $data['isActive']);
        }

        if (array_key_exists('sort_order', $data) || array_key_exists('sortOrder', $data)) {
            $attrs['sort_order'] = $data['sort_order'] ?? $data['sortOrder'];
        }

        $type->update($attrs);

        // Keep denormalized quarter_type text in sync when renamed (display via reference preferred).
        if (isset($attrs['name'])) {
            HrmsQuarter::query()
                ->where('company_id', $companyId)
                ->where('quarter_type_id', $type->id)
                ->update(['quarter_type' => $attrs['name']]);
        }

        return $this->format($type->fresh());
    }

    public function deactivate(HrmsQuarterType $type, string $companyId, string $userId): array
    {
        return $this->update($type, $companyId, $userId, ['is_active' => false]);
    }

    public function activate(HrmsQuarterType $type, string $companyId, string $userId): array
    {
        return $this->update($type, $companyId, $userId, ['is_active' => true]);
    }

    public function resolveForCompany(string $companyId, ?string $typeId, ?string $typeName, bool $allowInactive = false): HrmsQuarterType
    {
        $this->ensureDefaults($companyId);

        if ($typeId) {
            $row = HrmsQuarterType::query()
                ->where('company_id', $companyId)
                ->where('id', $typeId)
                ->first();
            if (! $row) {
                throw ValidationException::withMessages(['quarter_type' => ['Selected quarter type does not exist.']]);
            }
            if (! $allowInactive && ! $row->is_active) {
                throw ValidationException::withMessages(['quarter_type' => ['Selected quarter type is inactive.']]);
            }

            return $row;
        }

        $name = $this->normalizeDisplayName((string) ($typeName ?? ''));
        if ($name === '') {
            throw ValidationException::withMessages(['quarter_type' => ['Quarter Type is required.']]);
        }

        $row = HrmsQuarterType::query()
            ->where('company_id', $companyId)
            ->where('normalized_name', $this->normalizeKey($name))
            ->first();

        if (! $row) {
            throw ValidationException::withMessages(['quarter_type' => ['Invalid quarter type.']]);
        }
        if (! $allowInactive && ! $row->is_active) {
            throw ValidationException::withMessages(['quarter_type' => ['Selected quarter type is inactive.']]);
        }

        return $row;
    }

    public function ensureDefaults(string $companyId): void
    {
        $count = HrmsQuarterType::query()->where('company_id', $companyId)->count();
        if ($count > 0) {
            return;
        }

        $sort = 1;
        foreach (QuarterTypes::defaults() as $name) {
            HrmsQuarterType::create([
                'id' => (string) Str::uuid(),
                'company_id' => $companyId,
                'name' => $name,
                'normalized_name' => $this->normalizeKey($name),
                'is_active' => true,
                'sort_order' => $sort++,
            ]);
        }
    }

    public function normalizeDisplayName(string $value): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', trim($value)) ?? '';

        return $collapsed;
    }

    public function normalizeKey(string $value): string
    {
        return mb_strtolower($this->normalizeDisplayName($value));
    }

    public function assertValidTypeName(string $name): void
    {
        if ($name === '') {
            throw ValidationException::withMessages(['name' => ['Quarter Type name is required.']]);
        }
        if (mb_strlen($name) > 100) {
            throw ValidationException::withMessages(['name' => ['Quarter Type name cannot exceed 100 characters.']]);
        }
        if (! preg_match('/[A-Za-z0-9]/u', $name)) {
            throw ValidationException::withMessages(['name' => ['Quarter Type name must contain at least one letter or number.']]);
        }
        if (! preg_match('/^[A-Za-z0-9][A-Za-z0-9\s\-\/\.\(\)]*$/u', $name) && ! preg_match('/^(?=.*[A-Za-z0-9])[A-Za-z0-9\s\-\/\.\(\)]+$/u', $name)) {
            throw ValidationException::withMessages(['name' => ['Quarter Type name contains unsupported characters.']]);
        }
    }

    /** @return array<string, mixed> */
    private function format(HrmsQuarterType $t): array
    {
        return [
            'id' => $t->id,
            'companyId' => $t->company_id,
            'name' => $t->name,
            'normalizedName' => $t->normalized_name,
            'isActive' => (bool) $t->is_active,
            'sortOrder' => $t->sort_order,
            'createdAt' => $t->created_at?->toIso8601String(),
            'updatedAt' => $t->updated_at?->toIso8601String(),
        ];
    }
}
