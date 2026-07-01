<?php

namespace App\Services;

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsQuarter;
use App\Models\HrmsQuarterAssignment;
use App\Models\HrmsUser;
use App\Support\QuarterTypes;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class QuarterService
{
    /** @return list<array<string, mixed>> */
    public function listForCompany(string $companyId, bool $availableOnly = false): array
    {
        $query = HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->orderBy('quarter_name');

        if ($availableOnly) {
            $query->where('status', 'available');
        }

        return $query->get()->map(fn (HrmsQuarter $q) => $this->formatQuarter($q))->values()->all();
    }

    /** @return list<array<string, mixed>> */
    public function listForEmployeeForm(string $companyId, ?string $currentQuarterId = null): array
    {
        $query = HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->where(function ($q) use ($currentQuarterId) {
                $q->where('status', 'available');
                if ($currentQuarterId) {
                    $q->orWhere('id', $currentQuarterId);
                }
            })
            ->where('status', '!=', 'inactive')
            ->orderBy('quarter_name');

        return $query->get()->map(fn (HrmsQuarter $q) => $this->formatQuarter($q))->values()->all();
    }

    /** @param array<string, mixed> $data */
    public function create(string $companyId, string $createdBy, array $data): array
    {
        $validated = $this->validateQuarterPayload($data);
        $name = trim((string) $validated['quarter_name']);
        if (HrmsQuarter::query()->where('company_id', $companyId)->where('quarter_name', $name)->exists()) {
            throw ValidationException::withMessages(['quarter_name' => 'Quarter Number/Name must be unique.']);
        }

        $quarter = HrmsQuarter::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'quarter_name' => $name,
            'quarter_type' => $validated['quarter_type'],
            'monthly_rent' => $validated['monthly_rent'],
            'status' => 'available',
            'created_by' => $createdBy,
        ]);

        return $this->formatQuarter($quarter->fresh());
    }

    /** @param array<string, mixed> $data */
    public function update(HrmsQuarter $quarter, string $companyId, array $data): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        $validated = $this->validateQuarterPayload($data, true);
        $name = trim((string) ($validated['quarter_name'] ?? $quarter->quarter_name));
        if (
            HrmsQuarter::query()
                ->where('company_id', $companyId)
                ->where('quarter_name', $name)
                ->where('id', '!=', $quarter->id)
                ->exists()
        ) {
            throw ValidationException::withMessages(['quarter_name' => 'Quarter Number/Name must be unique.']);
        }

        $quarter->update([
            'quarter_name' => $name,
            'quarter_type' => $validated['quarter_type'] ?? $quarter->quarter_type,
            'monthly_rent' => $validated['monthly_rent'] ?? $quarter->monthly_rent,
        ]);

        return $this->formatQuarter($quarter->fresh());
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

            return $this->formatQuarter($quarter->fresh());
        });
    }

    public function unassign(HrmsQuarter $quarter, string $companyId, string $actorId): array
    {
        if ($quarter->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }

        return DB::transaction(function () use ($quarter, $companyId, $actorId) {
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

            return $this->formatQuarter($quarter->fresh());
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

        return $this->formatQuarter($quarter->fresh());
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

        $master->update([
            'quarter_id' => $quarter->id,
            'has_quarter' => true,
            'quarter_rent' => (float) $quarter->monthly_rent,
        ]);
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
        $trimmed = trim($name);
        if ($trimmed === '') {
            return null;
        }

        return HrmsQuarter::query()
            ->where('company_id', $companyId)
            ->whereRaw('LOWER(quarter_name) = ?', [strtolower($trimmed)])
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
                'quarterRent' => 0,
                'hraEligible' => true,
            ];
        }

        $quarter = $master->quarter_id
            ? HrmsQuarter::query()->when($companyId, fn ($q) => $q->where('company_id', $companyId))->find($master->quarter_id)
            : null;

        return [
            'hasQuarter' => true,
            'quarterId' => $master->quarter_id,
            'quarterName' => $quarter?->quarter_name,
            'quarterType' => $quarter?->quarter_type,
            'quarterRent' => (float) ($master->quarter_rent ?? $quarter?->monthly_rent ?? 0),
            'hraEligible' => false,
        ];
    }

    /** @param array<string, mixed> $data */
    private function validateQuarterPayload(array $data, bool $partial = false): array
    {
        $name = $data['quarter_name'] ?? $data['quarterName'] ?? null;
        $type = $data['quarter_type'] ?? $data['quarterType'] ?? null;
        $rent = $data['monthly_rent'] ?? $data['monthlyRent'] ?? null;

        if (! $partial && (trim((string) ($name ?? '')) === '')) {
            throw ValidationException::withMessages(['quarter_name' => 'Quarter Number/Name is required.']);
        }
        if (! $partial && ! in_array($type, QuarterTypes::all(), true)) {
            throw ValidationException::withMessages(['quarter_type' => 'Invalid quarter type.']);
        }
        if ($rent !== null && (! is_numeric($rent) || (float) $rent < 0)) {
            throw ValidationException::withMessages(['monthly_rent' => 'Monthly Rent must be numeric and >= 0.']);
        }

        return [
            'quarter_name' => $name,
            'quarter_type' => $type,
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

        return [
            'id' => $q->id,
            'companyId' => $q->company_id,
            'quarterName' => $q->quarter_name,
            'quarterType' => $q->quarter_type,
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
