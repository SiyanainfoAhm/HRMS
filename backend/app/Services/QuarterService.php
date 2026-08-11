<?php

namespace App\Services;

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsQuarter;
use App\Models\HrmsQuarterAssignment;
use App\Models\HrmsQuarterType;
use App\Models\HrmsUser;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class QuarterService
{
    public function __construct(
        private readonly QuarterTypeService $quarterTypes,
    ) {}

    /** @return list<array<string, mixed>> */
    public function listForCompany(string $companyId, bool $availableOnly = false): array
    {
        $query = HrmsQuarter::query()
            ->with('quarterType')
            ->where('company_id', $companyId)
            ->orderBy('quarter_name');

        if ($availableOnly) {
            $query->where('status', 'available');
        }

        return $query->get()->map(fn (HrmsQuarter $q) => $this->formatQuarter($q))->values()->all();
    }

    /**
     * Quarters selectable on Payroll Master employee form.
     *
     * Returns all non-inactive quarters for the company so assigned quarters
     * remain visible when editing (available-only lists look empty when stock
     * is fully assigned). Assignment conflicts are still enforced on save.
     *
     * @return list<array<string, mixed>>
     */
    public function listForEmployeeForm(string $companyId, ?string $currentQuarterId = null): array
    {
        $query = HrmsQuarter::query()
            ->with('quarterType')
            ->where('company_id', $companyId)
            ->where(function ($q) use ($currentQuarterId) {
                $q->where('status', '!=', 'inactive');
                if ($currentQuarterId) {
                    // Include currently assigned row even if marked inactive (legacy).
                    $q->orWhere('id', $currentQuarterId);
                }
            })
            ->orderBy('quarter_name');

        return $query->get()->map(fn (HrmsQuarter $q) => $this->formatQuarter($q))->values()->all();
    }

    /** @param array<string, mixed> $data */
    public function create(string $companyId, string $createdBy, array $data): array
    {
        $validated = $this->validateQuarterPayload($companyId, $data);
        $name = $validated['quarter_name'];
        $this->assertUniqueQuarterName($companyId, $name);

        $type = $validated['type'];

        $quarter = HrmsQuarter::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'quarter_name' => $name,
            'quarter_type' => $type->name,
            'quarter_type_id' => $type->id,
            'monthly_rent' => $validated['monthly_rent'],
            'status' => 'available',
            'created_by' => $createdBy,
        ]);

        return $this->formatQuarter($quarter->fresh(['quarterType']));
    }

    /** @param array<string, mixed> $data */
    public function update(HrmsQuarter $quarter, string $companyId, array $data): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        $validated = $this->validateQuarterPayload($companyId, $data, true, $quarter);
        $name = $validated['quarter_name'] ?? $this->normalizeQuarterName((string) $quarter->quarter_name);
        $this->assertUniqueQuarterName($companyId, $name, $quarter->id);

        $update = [
            'quarter_name' => $name,
            'monthly_rent' => $validated['monthly_rent'] ?? $quarter->monthly_rent,
        ];

        if (isset($validated['type'])) {
            /** @var HrmsQuarterType $type */
            $type = $validated['type'];
            $update['quarter_type'] = $type->name;
            $update['quarter_type_id'] = $type->id;
        }

        $quarter->update($update);

        return $this->formatQuarter($quarter->fresh(['quarterType']));
    }

    public function assign(HrmsQuarter $quarter, string $companyId, string $employeeUserId, string $actorId): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }
        if ($quarter->status === 'inactive') {
            throw ValidationException::withMessages(['quarter' => 'Cannot assign an inactive quarter.']);
        }
        if (
            $quarter->assigned_employee_id
            && $quarter->assigned_employee_id !== $employeeUserId
            && $quarter->status === 'assigned'
        ) {
            throw ValidationException::withMessages(['quarter' => 'This quarter is already assigned to another employee.']);
        }

        return DB::transaction(function () use ($quarter, $companyId, $employeeUserId, $actorId) {
            $today = Carbon::today()->toDateString();
            $quarter->update([
                'status' => 'assigned',
                'assigned_employee_id' => $employeeUserId,
                'assigned_from' => $today,
                'assigned_to' => null,
            ]);

            HrmsQuarterAssignment::create([
                'id' => (string) Str::uuid(),
                'company_id' => $companyId,
                'quarter_id' => $quarter->id,
                'employee_id' => $employeeUserId,
                'assigned_from' => $today,
                'rent_at_assignment' => $quarter->monthly_rent,
                'created_by' => $actorId,
            ]);

            return $this->formatQuarter($quarter->fresh(['quarterType']));
        });
    }

    public function unassign(HrmsQuarter $quarter, string $companyId, string $actorId): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        return DB::transaction(function () use ($quarter, $companyId) {
            $today = Carbon::today()->toDateString();
            if ($quarter->assigned_employee_id) {
                HrmsQuarterAssignment::query()
                    ->where('company_id', $companyId)
                    ->where('quarter_id', $quarter->id)
                    ->where('employee_id', $quarter->assigned_employee_id)
                    ->whereNull('assigned_to')
                    ->update(['assigned_to' => $today]);
            }

            $quarter->update([
                'status' => 'available',
                'assigned_employee_id' => null,
                'assigned_from' => null,
                'assigned_to' => null,
            ]);

            return $this->formatQuarter($quarter->fresh(['quarterType']));
        });
    }

    public function deactivate(HrmsQuarter $quarter, string $companyId): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }
        if ($quarter->status === 'assigned' && $quarter->assigned_employee_id) {
            throw ValidationException::withMessages(['quarter' => 'Unassign the quarter before deactivating.']);
        }

        $quarter->update(['status' => 'inactive']);

        return $this->formatQuarter($quarter->fresh(['quarterType']));
    }

    /**
     * Sync quarter assignment from payroll master payload.
     *
     * @param  array<string, mixed>  $payload
     */
    public function syncFromMasterPayload(
        HrmsPayrollMaster $master,
        array $payload,
        string $companyId,
        string $actorId,
    ): void {
        $hasQuarter = $this->payloadHasQuarter($payload);
        $quarterId = $payload['quarter_id'] ?? $payload['quarterId'] ?? null;
        $employeeUserId = (string) ($master->employee_user_id ?? $master->user_id ?? '');

        if (! $hasQuarter || ! $quarterId) {
            $this->clearMasterQuarter($master, $companyId, $actorId);

            return;
        }

        $quarter = HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->where('id', $quarterId)
            ->first();

        if (! $quarter) {
            throw ValidationException::withMessages(['quarter_id' => 'Selected quarter does not exist.']);
        }
        if ($quarter->status === 'inactive') {
            throw ValidationException::withMessages(['quarter_id' => 'Cannot assign an inactive quarter.']);
        }
        if (
            $quarter->assigned_employee_id
            && $quarter->assigned_employee_id !== $employeeUserId
            && $quarter->status === 'assigned'
        ) {
            throw ValidationException::withMessages(['quarter_id' => 'This quarter is already assigned to another employee.']);
        }

        if ($master->quarter_id && $master->quarter_id !== $quarterId) {
            $old = HrmsQuarter::find($master->quarter_id);
            if ($old) {
                $this->unassign($old, $companyId, $actorId);
            }
        }

        if ($employeeUserId) {
            $this->assign($quarter, $companyId, $employeeUserId, $actorId);
        }

        $payloadRent = $payload['quarter_rent'] ?? $payload['quarterRent'] ?? null;
        $master->update([
            'quarter_id' => $quarter->id,
            'has_quarter' => true,
            'quarter_rent' => $this->resolveEffectiveMasterQuarterRent(
                $payloadRent,
                (float) $quarter->monthly_rent,
            ),
        ]);
    }

    /**
     * Effective employee/master quarter rent.
     * Explicit 0 must remain 0 (use nullish, not truthy fallback).
     */
    public function resolveEffectiveMasterQuarterRent(mixed $payloadRent, float $catalogMonthlyRent): float
    {
        if ($payloadRent === null || $payloadRent === '') {
            return round(max(0, $catalogMonthlyRent), 2);
        }
        if (! is_numeric($payloadRent)) {
            return round(max(0, $catalogMonthlyRent), 2);
        }

        return round(max(0, (float) $payloadRent), 2);
    }

    public function clearMasterQuarter(HrmsPayrollMaster $master, string $companyId, string $actorId): void
    {
        if ($master->quarter_id) {
            $quarter = HrmsQuarter::find($master->quarter_id);
            if ($quarter && $quarter->company_id === $companyId) {
                $this->unassign($quarter, $companyId, $actorId);
            }
        }

        $master->update([
            'quarter_id' => null,
            'has_quarter' => false,
            'quarter_rent' => 0,
        ]);
    }

    public function findByName(string $companyId, string $name): ?HrmsQuarter
    {
        $normalized = $this->normalizeQuarterName($name);
        if ($normalized === '') {
            return null;
        }

        return HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->whereRaw(
                "lower(regexp_replace(btrim(quarter_name), '\\s+', ' ', 'g')) = ?",
                [mb_strtolower($normalized)],
            )
            ->first();
    }

    /** @return array<string, mixed> */
    public function quarterMetaForMaster(?HrmsPayrollMaster $master, ?string $companyId = null): array
    {
        if (! $master || ! ($master->has_quarter || $master->quarter_id)) {
            return [
                'hasQuarter' => false,
                'quarterId' => null,
                'quarterName' => null,
                'quarterType' => null,
                'quarterTypeId' => null,
                'quarterRent' => 0,
                'hraEligible' => true,
            ];
        }

        $quarter = $master->quarter_id
            ? HrmsQuarter::query()
                ->with('quarterType')
                ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
                ->find($master->quarter_id)
            : null;

        $typeName = $quarter?->quarterType?->name ?? $quarter?->quarter_type;

        return [
            'hasQuarter' => true,
            'quarterId' => $master->quarter_id,
            'quarterName' => $quarter?->quarter_name,
            'quarterType' => $typeName,
            'quarterTypeId' => $quarter?->quarter_type_id,
            'quarterRent' => (float) ($master->quarter_rent ?? $quarter?->monthly_rent ?? 0),
            'hraEligible' => false,
        ];
    }

    public function normalizeQuarterName(string $value): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', trim($value)) ?? '';

        return $collapsed;
    }

    public function assertValidQuarterName(string $name): void
    {
        if ($name === '') {
            throw ValidationException::withMessages(['quarter_name' => ['Quarter Number/Name is required.']]);
        }
        if (mb_strlen($name) > 128) {
            throw ValidationException::withMessages(['quarter_name' => ['Quarter Number/Name cannot exceed 128 characters.']]);
        }
        if (! preg_match('/[A-Za-z0-9]/u', $name)) {
            throw ValidationException::withMessages([
                'quarter_name' => ['Quarter Number/Name must contain at least one letter or number.'],
            ]);
        }
        if (! preg_match('/^[A-Za-z0-9\s\-\/\.\(\)]+$/u', $name)) {
            throw ValidationException::withMessages([
                'quarter_name' => ['Letters, numbers, spaces, /, -, periods and parentheses are allowed.'],
            ]);
        }
    }

    private function assertUniqueQuarterName(string $companyId, string $name, ?string $exceptId = null): void
    {
        $key = mb_strtolower($name);
        $query = HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->whereRaw(
                "lower(regexp_replace(btrim(quarter_name), '\\s+', ' ', 'g')) = ?",
                [$key],
            );
        if ($exceptId) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages([
                'quarter_name' => ['A quarter with this number/name already exists.'],
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{quarter_name: ?string, type: ?HrmsQuarterType, monthly_rent: ?float}
     */
    private function validateQuarterPayload(
        string $companyId,
        array $data,
        bool $partial = false,
        ?HrmsQuarter $existing = null,
    ): array {
        $nameRaw = $data['quarter_name'] ?? $data['quarterName'] ?? null;
        $typeId = $data['quarter_type_id'] ?? $data['quarterTypeId'] ?? null;
        $typeName = $data['quarter_type'] ?? $data['quarterType'] ?? null;
        $rent = $data['monthly_rent'] ?? $data['monthlyRent'] ?? null;

        $name = null;
        if ($nameRaw !== null) {
            $name = $this->normalizeQuarterName((string) $nameRaw);
            $this->assertValidQuarterName($name);
        } elseif (! $partial) {
            throw ValidationException::withMessages(['quarter_name' => ['Quarter Number/Name is required.']]);
        }

        $type = null;
        if ($typeId !== null || $typeName !== null) {
            $allowInactive = $existing !== null
                && $typeId
                && (string) $existing->quarter_type_id === (string) $typeId;
            $type = $this->quarterTypes->resolveForCompany(
                $companyId,
                $typeId ? (string) $typeId : null,
                $typeName !== null ? (string) $typeName : null,
                $allowInactive,
            );
        } elseif (! $partial) {
            throw ValidationException::withMessages(['quarter_type' => ['Quarter Type is required.']]);
        }

        if ($rent !== null && (! is_numeric($rent) || (float) $rent < 0)) {
            throw ValidationException::withMessages(['monthly_rent' => ['Monthly Rent must be numeric and >= 0.']]);
        }

        return [
            'quarter_name' => $name,
            'type' => $type,
            'monthly_rent' => $rent !== null ? round((float) $rent, 2) : null,
        ];
    }

    /** @param array<string, mixed> $payload */
    private function payloadHasQuarter(array $payload): bool
    {
        $flag = $payload['has_quarter'] ?? $payload['hasQuarter'] ?? $payload['quarter_assigned'] ?? $payload['quarterAssigned'] ?? false;
        if (is_string($flag)) {
            $v = strtolower(trim($flag));

            return in_array($v, ['yes', 'y', 'true', '1'], true);
        }

        return (bool) $flag;
    }

    /** @return array<string, mixed> */
    private function formatQuarter(HrmsQuarter $q): array
    {
        $employee = $q->assigned_employee_id ? HrmsUser::find($q->assigned_employee_id) : null;
        $master = $employee
            ? HrmsPayrollMaster::query()
                ->where('company_id', $q->company_id)
                ->where(function ($query) use ($employee) {
                    $query->where('employee_user_id', $employee->id)->orWhere('user_id', $employee->id);
                })
                ->whereNull('effective_to')
                ->first()
            : null;

        $typeName = $q->relationLoaded('quarterType') && $q->quarterType
            ? $q->quarterType->name
            : $q->quarter_type;

        return [
            'id' => $q->id,
            'companyId' => $q->company_id,
            'quarterName' => $q->quarter_name,
            'quarterType' => $typeName,
            'quarterTypeId' => $q->quarter_type_id,
            'monthlyRent' => (float) $q->monthly_rent,
            'status' => $q->status,
            'assignedEmployeeId' => $q->assigned_employee_id,
            'assignedEmployeeName' => $employee?->name,
            'assignedEmployeeCode' => $master?->employee_code,
            'assignedFrom' => $q->assigned_from?->toDateString(),
            'assignedTo' => $q->assigned_to?->toDateString(),
            'createdAt' => $q->created_at?->toIso8601String(),
            'updatedAt' => $q->updated_at?->toIso8601String(),
        ];
    }
}
