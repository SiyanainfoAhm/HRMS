<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsNightAllowanceRate;
use App\Services\NightAllowanceRateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NightAllowanceRateController extends Controller
{
    public function __construct(private readonly NightAllowanceRateService $service) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $activeOnly = $request->boolean('activeOnly', false);

        return response()->json([
            'rates' => $this->service->listForCompany((string) $user->company_id, $activeOnly),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $row = $this->service->create((string) $user->company_id, $request->all());

        return response()->json(['rate' => $row], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $row = HrmsNightAllowanceRate::query()
            ->where('company_id', $user->company_id)
            ->findOrFail($id);

        $updated = $this->service->update($row, $request->all());

        return response()->json(['rate' => $updated]);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $row = HrmsNightAllowanceRate::query()
            ->where('company_id', $user->company_id)
            ->findOrFail($id);

        return response()->json(['rate' => $this->service->deactivate($row)]);
    }
}
