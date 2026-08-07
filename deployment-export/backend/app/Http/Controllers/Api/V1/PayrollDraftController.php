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
        ]);

        $replaceAll = (bool) ($data['replace_all_employees'] ?? $data['replaceAllEmployees'] ?? true);

        $result = $this->service->saveDraft(
            (string) $request->user()->company_id,
            (int) $data['year'],
            (int) $data['month'],
            (string) $request->user()->id,
            $data['employees'],
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
        ]);

        $result = $this->service->resetDraft(
            (string) $request->user()->company_id,
            (int) $data['year'],
            (int) $data['month'],
            (string) $request->user()->id,
        );

        return response()->json($result);
    }
}
