<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Models\HrmsUser;
use App\Services\PayrollBankLetterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PayrollBankLetterController extends Controller
{
    public function __construct(
        private readonly PayrollBankLetterService $service,
    ) {}

    public function store(Request $request): BinaryFileResponse|JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertAdmin($user)) {
            return $denied;
        }

        $data = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'source' => ['nullable', 'string', 'max:64'],
            'employee_count' => ['nullable', 'integer', 'min:1'],
            'employeeCount' => ['nullable', 'integer', 'min:1'],
            'draft_id' => ['nullable', 'string', 'max:64'],
            'draftId' => ['nullable', 'string', 'max:64'],
            'draft_version' => ['nullable', 'integer', 'min:1'],
            'draftVersion' => ['nullable', 'integer', 'min:1'],
            'employees' => ['required', 'array', 'min:1'],
        ]);

        $expectedCount = $data['employee_count'] ?? $data['employeeCount'] ?? null;

        try {
            $normalized = $this->service->normalizeEmployees(
                (string) $user->company_id,
                $data['employees'],
                isset($expectedCount) ? (int) $expectedCount : null,
            );

            return $this->service->generateDownloadResponse(
                (int) $data['month'],
                (int) $data['year'],
                $normalized['rows'],
                $normalized['total'],
            );
        } catch (InvalidArgumentException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'message' => $e->getMessage(),
                'errors' => ['employees' => [$e->getMessage()]],
            ], 422);
        }
    }

    private function assertAdmin(HrmsUser $user): ?JsonResponse
    {
        $role = $user->role;
        $roleKey = $role instanceof UserRole ? $role->value : (is_string($role) ? $role : '');
        if (! in_array($roleKey, [UserRole::Admin->value], true)) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        return null;
    }
}
