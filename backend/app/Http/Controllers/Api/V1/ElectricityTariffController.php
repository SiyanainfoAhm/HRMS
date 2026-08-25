<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsElectricityTariff;
use App\Services\ElectricityTariffService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ElectricityTariffController extends Controller
{
    public function __construct(private readonly ElectricityTariffService $service) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $activeOnly = $request->boolean('activeOnly', false);
        $asOf = $request->query('asOf') ?? $request->query('as_of');

        if (is_string($asOf) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $asOf)) {
            $tariff = $this->service->resolveForDate((string) $user->company_id, $asOf);

            return response()->json([
                'tariff' => $tariff ? $this->service->formatTariff($tariff) : null,
                'tariffs' => $this->service->listForCompany((string) $user->company_id, $activeOnly),
            ]);
        }

        return response()->json([
            'tariffs' => $this->service->listForCompany((string) $user->company_id, $activeOnly),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $row = $this->service->create((string) $user->company_id, $request->all(), (string) $user->id);

        return response()->json(['tariff' => $row], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $tariff = HrmsElectricityTariff::query()
            ->where('company_id', $user->company_id)
            ->findOrFail($id);

        return response()->json(['tariff' => $this->service->update($tariff, $request->all())]);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isAdmin()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $tariff = HrmsElectricityTariff::query()
            ->where('company_id', $user->company_id)
            ->findOrFail($id);

        return response()->json(['tariff' => $this->service->deactivate($tariff)]);
    }

    public function preview(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $units = max(0, (float) ($request->input('units') ?? 0));
        $asOf = (string) ($request->input('asOf') ?? $request->input('as_of') ?? date('Y-m-d'));
        $tariffModel = $this->service->resolveForDate((string) $user->company_id, $asOf);
        $tariff = $tariffModel ? $this->service->formatTariff($tariffModel) : null;
        $bill = $this->service->calculateBill(
            $units,
            $tariff,
            filter_var($request->input('applicable', true), FILTER_VALIDATE_BOOLEAN),
            (string) ($request->input('mode') ?? 'unit_based'),
            (float) ($request->input('legacyUnitRate') ?? 0),
            (float) ($request->input('fixedAmount') ?? 0),
            filter_var($request->input('manualOverride', false), FILTER_VALIDATE_BOOLEAN),
            $request->has('manualAmount') ? (float) $request->input('manualAmount') : null,
        );

        return response()->json(['bill' => $bill, 'tariff' => $tariff]);
    }
}
