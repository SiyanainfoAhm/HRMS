<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsQuarterType;
use App\Services\QuarterTypeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuarterTypeController extends Controller
{
    public function __construct(
        private readonly QuarterTypeService $service,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $activeOnly = filter_var($request->query('active_only', $request->query('activeOnly', false)), FILTER_VALIDATE_BOOLEAN);
        $includeId = $request->query('include_id') ?? $request->query('includeId');

        return response()->json([
            'quarterTypes' => $this->service->listForCompany(
                (string) $request->user()->company_id,
                $activeOnly,
                $includeId ? (string) $includeId : null,
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required_without_all:quarterType,quarter_type', 'nullable', 'string', 'max:100'],
            'quarterType' => ['required_without_all:name,quarter_type', 'nullable', 'string', 'max:100'],
            'quarter_type' => ['required_without_all:name,quarterType', 'nullable', 'string', 'max:100'],
        ]);

        $created = $this->service->create(
            (string) $request->user()->company_id,
            (string) $request->user()->id,
            $data,
        );

        return response()->json(['quarterType' => $created], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $type = HrmsQuarterType::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:100'],
            'quarterType' => ['nullable', 'string', 'max:100'],
            'quarter_type' => ['nullable', 'string', 'max:100'],
            'is_active' => ['nullable', 'boolean'],
            'isActive' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'sortOrder' => ['nullable', 'integer', 'min:0'],
        ]);

        $updated = $this->service->update(
            $type,
            (string) $request->user()->company_id,
            (string) $request->user()->id,
            $data,
        );

        return response()->json(['quarterType' => $updated]);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $type = HrmsQuarterType::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        return response()->json([
            'quarterType' => $this->service->deactivate(
                $type,
                (string) $request->user()->company_id,
                (string) $request->user()->id,
            ),
        ]);
    }

    public function activate(Request $request, string $id): JsonResponse
    {
        $type = HrmsQuarterType::query()
            ->where('company_id', $request->user()->company_id)
            ->findOrFail($id);

        return response()->json([
            'quarterType' => $this->service->activate(
                $type,
                (string) $request->user()->company_id,
                (string) $request->user()->id,
            ),
        ]);
    }
}
