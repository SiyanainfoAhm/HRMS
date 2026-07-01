<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsQuarter;
use App\Services\QuarterService;
use App\Support\QuarterTypes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuarterController extends Controller
{
    public function __construct(
        private readonly QuarterService $service,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $availableOnly = filter_var($request->query('available_only', false), FILTER_VALIDATE_BOOLEAN);
        $forEmployeeForm = filter_var($request->query('for_employee_form', false), FILTER_VALIDATE_BOOLEAN);
        $currentQuarterId = $request->query('current_quarter_id') ?? $request->query('currentQuarterId');

        $quarters = $forEmployeeForm
            ? $this->service->listForEmployeeForm((string) $request->user()->company_id, $currentQuarterId)
            : $this->service->listForCompany((string) $request->user()->company_id, $availableOnly);

        return response()->json([
            'quarters' => $quarters,
            'quarterTypes' => QuarterTypes::all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'quarter_name' => ['required_without:quarterName', 'string', 'max:128'],
            'quarterName' => ['required_without:quarter_name', 'string', 'max:128'],
            'quarter_type' => ['required_without:quarterType', 'string'],
            'quarterType' => ['required_without:quarter_type', 'string'],
            'monthly_rent' => ['required_without:monthlyRent', 'numeric', 'min:0'],
            'monthlyRent' => ['required_without:monthly_rent', 'numeric', 'min:0'],
        ]);

        $payload = [
            'quarter_name' => $data['quarter_name'] ?? $data['quarterName'],
            'quarter_type' => $data['quarter_type'] ?? $data['quarterType'],
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
            'quarter_type' => ['nullable', 'string'],
            'quarterType' => ['nullable', 'string'],
            'monthly_rent' => ['nullable', 'numeric', 'min:0'],
            'monthlyRent' => ['nullable', 'numeric', 'min:0'],
        ]);

        $payload = array_filter([
            'quarter_name' => $data['quarter_name'] ?? $data['quarterName'] ?? null,
            'quarter_type' => $data['quarter_type'] ?? $data['quarterType'] ?? null,
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
