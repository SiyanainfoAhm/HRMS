<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\SalaryIncrementService;
use App\Support\IncrementMonth;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SalaryIncrementController extends Controller
{
    public function __construct(
        private readonly SalaryIncrementService $service,
    ) {}

    public function eligible(Request $request): JsonResponse
    {
        $data = $request->validate([
            'increment_month' => ['required_without:incrementMonth', 'string'],
            'incrementMonth' => ['required_without:increment_month', 'string'],
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'effective_start_date' => ['required_without:effectiveStartDate', 'date'],
            'effectiveStartDate' => ['required_without:effective_start_date', 'date'],
            'default_increment_percentage' => ['nullable', 'numeric'],
            'defaultIncrementPercentage' => ['sometimes', 'numeric'],
        ]);

        $month = $data['increment_month'] ?? $data['incrementMonth'];
        $effectiveDate = $data['effective_start_date'] ?? $data['effectiveStartDate'];
        $pct = isset($data['default_increment_percentage'])
            ? (float) $data['default_increment_percentage']
            : (isset($data['defaultIncrementPercentage']) ? (float) $data['defaultIncrementPercentage'] : null);

        $payload = $this->service->listEligibleEmployees(
            $request->user()->company_id,
            $month,
            (int) $data['year'],
            $effectiveDate,
            $pct,
        );

        if ($payload['employees'] === []) {
            return response()->json([
                ...$payload,
                'message' => 'No employees found for selected increment month.',
            ]);
        }

        return response()->json($payload);
    }

    public function apply(Request $request): JsonResponse
    {
        $data = $request->validate([
            'increment_month' => ['required_without:incrementMonth', 'string'],
            'incrementMonth' => ['required_without:increment_month', 'string'],
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'effective_start_date' => ['required_without:effectiveStartDate', 'date'],
            'effectiveStartDate' => ['required_without:effective_start_date', 'date'],
            'default_increment_percentage' => ['required_without:defaultIncrementPercentage', 'numeric'],
            'defaultIncrementPercentage' => ['required_without:default_increment_percentage', 'numeric'],
            'employees' => ['required', 'array', 'min:1'],
            'employees.*.employeeUserId' => ['nullable', 'string'],
            'employees.*.employee_user_id' => ['nullable', 'string'],
            'employees.*.masterId' => ['nullable', 'string'],
            'employees.*.master_id' => ['nullable', 'string'],
            'employees.*.incrementPercentage' => ['nullable', 'numeric'],
            'employees.*.increment_percentage' => ['nullable', 'numeric'],
            'confirm_payroll_overwrite' => ['nullable', 'boolean'],
            'confirmPayrollOverwrite' => ['nullable', 'boolean'],
        ]);

        $month = $data['increment_month'] ?? $data['incrementMonth'];
        $effectiveDate = $data['effective_start_date'] ?? $data['effectiveStartDate'];
        $defaultPct = (float) ($data['default_increment_percentage'] ?? $data['defaultIncrementPercentage']);
        $confirm = (bool) ($data['confirm_payroll_overwrite'] ?? $data['confirmPayrollOverwrite'] ?? false);

        $employees = array_map(function (array $row) use ($defaultPct) {
            return [
                'employeeUserId' => $row['employeeUserId'] ?? $row['employee_user_id'] ?? null,
                'masterId' => $row['masterId'] ?? $row['master_id'] ?? null,
                'incrementPercentage' => isset($row['incrementPercentage'])
                    ? (float) $row['incrementPercentage']
                    : (isset($row['increment_percentage']) ? (float) $row['increment_percentage'] : null),
            ];
        }, $data['employees']);

        $result = $this->service->applyIncrement(
            $request->user()->company_id,
            $request->user()->id,
            $month,
            (int) $data['year'],
            $effectiveDate,
            $defaultPct,
            $employees,
            $confirm,
        );

        return response()->json($result);
    }

    public function history(Request $request): JsonResponse
    {
        $data = $request->validate([
            'increment_month' => ['nullable', 'string'],
            'incrementMonth' => ['nullable', 'string'],
            'year' => ['nullable', 'integer', 'min:2000', 'max:2100'],
            'employee_user_id' => ['nullable', 'string'],
            'employeeUserId' => ['nullable', 'string'],
        ]);

        $month = $data['increment_month'] ?? $data['incrementMonth'] ?? null;
        $employeeUserId = $data['employee_user_id'] ?? $data['employeeUserId'] ?? null;

        return response()->json($this->service->listHistory(
            $request->user()->company_id,
            $month,
            isset($data['year']) ? (int) $data['year'] : null,
            $employeeUserId,
        ));
    }

    public function defaults(Request $request): JsonResponse
    {
        $data = $request->validate([
            'increment_month' => ['required_without:incrementMonth', 'string'],
            'incrementMonth' => ['required_without:increment_month', 'string'],
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
        ]);

        $month = $data['increment_month'] ?? $data['incrementMonth'];
        $normalized = IncrementMonth::normalize($month);
        if ($normalized === null) {
            return response()->json(['error' => 'Increment month must be January or July.'], 422);
        }

        return response()->json([
            'incrementMonth' => $normalized,
            'year' => (int) $data['year'],
            'effectiveStartDate' => IncrementMonth::defaultEffectiveDate($normalized, (int) $data['year']),
        ]);
    }
}
