<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsQuarter;
use App\Services\QuarterService;
use App\Services\QuarterTypeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuarterController extends Controller
{
    public function __construct(
        private readonly QuarterService $service,
        private readonly QuarterTypeService $typeService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $availableOnly = filter_var($request->query('available_only', false), FILTER_VALIDATE_BOOLEAN);
        $forEmployeeForm = filter_var($request->query('for_employee_form', false), FILTER_VALIDATE_BOOLEAN);
        $currentQuarterId = $request->query('current_quarter_id') ?? $request->query('currentQuarterId');

        $companyId = (string) $request->user()->company_id;
        $quarters = $forEmployeeForm
            ? $this->service->listForEmployeeForm($companyId, $currentQuarterId)
            : $this->service->listForCompany($companyId, $availableOnly);

        $types = $this->typeService->listForCompany($companyId, activeOnly: false);

        return response()->json([
            'quarters' => $quarters,
            'quarterTypes' => array_values(array_map(
                static fn (array $t) => $t['name'],
                array_filter($types, static fn (array $t) => $t['isActive']),
            )),
            'quarterTypeRecords' => $types,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'quarter_name' => ['required_without:quarterName', 'nullable', 'string', 'max:128'],
            'quarterName' => ['required_without:quarter_name', 'nullable', 'string', 'max:128'],
            'quarter_type' => ['required_without_all:quarterType,quarter_type_id,quarterTypeId', 'nullable', 'string', 'max:100'],
            'quarterType' => ['required_without_all:quarter_type,quarter_type_id,quarterTypeId', 'nullable', 'string', 'max:100'],
            'quarter_type_id' => ['required_without_all:quarterTypeId,quarter_type,quarterType', 'nullable', 'uuid'],
            'quarterTypeId' => ['required_without_all:quarter_type_id,quarter_type,quarterType', 'nullable', 'uuid'],
            'monthly_rent' => ['required_without:monthlyRent', 'nullable', 'numeric', 'min:0'],
            'monthlyRent' => ['required_without:monthly_rent', 'nullable', 'numeric', 'min:0'],
        ]);

        $payload = [
            'quarter_name' => $data['quarter_name'] ?? $data['quarterName'],
            'quarter_type' => $data['quarter_type'] ?? $data['quarterType'] ?? null,
            'quarter_type_id' => $data['quarter_type_id'] ?? $data['quarterTypeId'] ?? null,
            'monthly_rent' => $data['monthly_rent'] ?? $data['monthlyRent'],
        ];

        $quarter = $this->service->create(
            (string) $request->user()->company_id,
            (string) $request->user()->id,
            $payload,
        );

        return response()->json($quarter, 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $quarter = HrmsQuarter::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        $data = $request->validate([
            'quarter_name' => ['nullable', 'string', 'max:128'],
            'quarterName' => ['nullable', 'string', 'max:128'],
            'quarter_type' => ['nullable', 'string', 'max:100'],
            'quarterType' => ['nullable', 'string', 'max:100'],
            'quarter_type_id' => ['nullable', 'uuid'],
            'quarterTypeId' => ['nullable', 'uuid'],
            'monthly_rent' => ['nullable', 'numeric', 'min:0'],
            'monthlyRent' => ['nullable', 'numeric', 'min:0'],
        ]);

        $payload = array_filter([
            'quarter_name' => $data['quarter_name'] ?? $data['quarterName'] ?? null,
            'quarter_type' => $data['quarter_type'] ?? $data['quarterType'] ?? null,
            'quarter_type_id' => $data['quarter_type_id'] ?? $data['quarterTypeId'] ?? null,
            'monthly_rent' => $data['monthly_rent'] ?? $data['monthlyRent'] ?? null,
        ], fn ($v) => $v !== null);

        $updated = $this->service->update($quarter, (string) $request->user()->company_id, $payload);

        return response()->json($updated);
    }

    public function assign(Request $request, string $id): JsonResponse
    {
        $quarter = HrmsQuarter::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        $data = $request->validate([
            'employee_user_id' => ['required_without:employeeUserId', 'string'],
            'employeeUserId' => ['required_without:employee_user_id', 'string'],
        ]);

        $employeeUserId = $data['employee_user_id'] ?? $data['employeeUserId'];

        return response()->json($this->service->assign(
            $quarter,
            (string) $request->user()->company_id,
            $employeeUserId,
            (string) $request->user()->id,
        ));
    }

    public function unassign(Request $request, string $id): JsonResponse
    {
        $quarter = HrmsQuarter::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        return response()->json($this->service->unassign(
            $quarter,
            (string) $request->user()->company_id,
            (string) $request->user()->id,
        ));
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $quarter = HrmsQuarter::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        return response()->json($this->service->deactivate($quarter, (string) $request->user()->company_id));
    }
}
