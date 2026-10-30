<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PayrollDraftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollDraftController extends Controller
{
    public function __construct(
        private readonly PayrollDraftService $service,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
        ]);

        $payload = $this->service->getDraft(
            (string) $request->user()->company_id,
            (int) $data['year'],
            (int) $data['month'],
        );

        return response()->json($payload);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'version' => ['nullable', 'integer', 'min:1'],
            'replace_all_employees' => ['nullable', 'boolean'],
            'replaceAllEmployees' => ['nullable', 'boolean'],
            'employees' => ['required', 'array', 'min:1'],
            'employees.*' => ['required', 'array'],
            'employees.*.employeeUserId' => ['required_without:employees.*.employee_user_id', 'string', 'max:64'],
            'employees.*.employee_user_id' => ['required_without:employees.*.employeeUserId', 'string', 'max:64'],
            'employees.*.rowPayload' => ['sometimes', 'array'],
            'employees.*.row_payload' => ['sometimes', 'array'],
            'employees.*.changedFields' => ['sometimes', 'array', 'max:100'],
            'employees.*.changedFields.*' => ['string', 'max:160'],
            'employees.*.changed_fields' => ['sometimes', 'array', 'max:100'],
            'employees.*.changed_fields.*' => ['string', 'max:160'],
        ]);

        // Keep malformed or version-skewed requests on the validation path (422),
        // never as an undefined-key 500. Laravel's validator should guarantee this,
        // while the guard protects deployments with older/custom validation behavior.
        $employeeRows = $data['employees'] ?? null;
        if (! is_array($employeeRows) || $employeeRows === []) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'employees' => ['The employees field must contain at least one employee row.'],
            ]);
        }
        foreach ($employeeRows as $index => $employeeRow) {
            if (! is_array($employeeRow)
                || ! is_string($employeeRow['employeeUserId'] ?? $employeeRow['employee_user_id'] ?? null)
                || trim((string) ($employeeRow['employeeUserId'] ?? $employeeRow['employee_user_id'] ?? '')) === '') {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    "employees.{$index}" => ['Each employee row must include an employee user ID.'],
                ]);
            }
        }

        $replaceAll = (bool) ($data['replace_all_employees'] ?? $data['replaceAllEmployees'] ?? true);

        $result = $this->service->saveDraft(
            (string) $request->user()->company_id,
            (int) $data['year'],
            (int) $data['month'],
            (string) $request->user()->id,
            $employeeRows,
            isset($data['version']) ? (int) $data['version'] : null,
            $replaceAll,
        );

        return response()->json($result);
    }

    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'version' => ['nullable', 'integer', 'min:1'],
        ]);

        $result = $this->service->resetDraft(
            (string) $request->user()->company_id,
            (int) $data['year'],
            (int) $data['month'],
            (string) $request->user()->id,
            isset($data['version']) ? (int) $data['version'] : null,
        );

        return response()->json($result);
    }

    public function auditLogs(Request $request): JsonResponse
    {
        return response()->json([
            'logs' => $this->service->resetAuditLogs((string) $request->user()->company_id),
        ]);
    }
}
