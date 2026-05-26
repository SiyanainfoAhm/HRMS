<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\HrmsEmployeeBankAccount;
use App\Models\HrmsEmployeeDocumentSubmission;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => new UserResource($request->user())]);
    }

    public function updateMe(Request $request): JsonResponse
    {
        /** @var HrmsUser $user */
        $user = $request->user();
        $body = $request->all();
        $isManagerial = $user->role?->isManagerial() ?? false;

        $prevBank = [
            'bank_name' => $user->bank_name ?? '',
            'bank_account_number' => $user->bank_account_number ?? '',
            'bank_ifsc' => $user->bank_ifsc ?? '',
        ];

        $payload = $this->buildUpdatePayload($body, $isManagerial);
        $user->update($payload);
        $user->refresh();

        $nextBank = [
            'bank_name' => $user->bank_name ?? '',
            'bank_account_number' => $user->bank_account_number ?? '',
            'bank_ifsc' => $user->bank_ifsc ?? '',
        ];

        if ($prevBank !== $nextBank && $user->company_id) {
            $this->recordBankChange($user, $nextBank);
        }

        return response()->json(['user' => new UserResource($user)]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $query = HrmsUser::where('company_id', $user->company_id);

        if ($request->filled('role')) {
            $query->where('role', $request->input('role'));
        }
        if ($request->filled('employment_status')) {
            $query->where('employment_status', $request->input('employment_status'));
        }
        if ($request->filled('search')) {
            $s = '%'.mb_strtolower($request->input('search')).'%';
            $query->where(function ($q) use ($s) {
                $q->whereRaw('LOWER(name) LIKE ?', [$s])
                  ->orWhereRaw('LOWER(email) LIKE ?', [$s])
                  ->orWhereRaw('LOWER(employee_code) LIKE ?', [$s]);
            });
        }

        $users = $query->orderByRaw("CASE employment_status WHEN 'current' THEN 0 WHEN 'preboarding' THEN 1 ELSE 2 END")
            ->orderBy('name')
            ->get();

        return response()->json(['users' => UserResource::collection($users)]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = HrmsUser::findOrFail($id);

        return response()->json(['user' => new UserResource($user)]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $authUser = $request->user();
        if (! $authUser->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $target = HrmsUser::findOrFail($id);
        $payload = $this->buildUpdatePayload($request->all(), true);
        $target->update($payload);

        return response()->json(['user' => new UserResource($target->refresh())]);
    }

    public function myDocuments(Request $request): JsonResponse
    {
        $user = $request->user();
        $submissions = HrmsEmployeeDocumentSubmission::where('user_id', $user->id)
            ->with('document')
            ->get();

        return response()->json(['documents' => $submissions]);
    }

    public function myPayrollMaster(Request $request): JsonResponse
    {
        $user = $request->user();
        $master = HrmsPayrollMaster::where('employee_user_id', $user->id)
            ->where(function ($q) {
                $q->whereNull('effective_end_date')
                  ->orWhere('effective_end_date', '>=', now()->toDateString());
            })
            ->orderBy('effective_start_date', 'desc')
            ->first();

        return response()->json(['master' => $master]);
    }

    private function buildUpdatePayload(array $body, bool $isManagerial): array
    {
        $payload = [];
        $fields = [
            'name', 'phone', 'date_of_birth',
            'current_address_line1', 'current_address_line2', 'current_city',
            'current_state', 'current_country', 'current_postal_code',
            'permanent_address_line1', 'permanent_address_line2', 'permanent_city',
            'permanent_state', 'permanent_country', 'permanent_postal_code',
            'emergency_contact_name', 'emergency_contact_phone',
            'bank_name', 'bank_account_number', 'bank_ifsc',
            'aadhaar', 'pan', 'gender',
        ];

        foreach ($fields as $snakeField) {
            $camelField = lcfirst(str_replace('_', '', ucwords($snakeField, '_')));
            if (array_key_exists($camelField, $body)) {
                $val = is_string($body[$camelField]) ? trim($body[$camelField]) : $body[$camelField];
                $payload[$snakeField] = $val === '' ? null : $val;
            }
        }

        if ($isManagerial) {
            $orgFields = [
                'employee_code' => 'employeeCode',
                'date_of_joining' => 'dateOfJoining',
                'employment_status' => 'employmentStatus',
                'designation' => 'designation',
                'designation_id' => 'designationId',
                'department_id' => 'departmentId',
                'division_id' => 'divisionId',
                'shift_id' => 'shiftId',
                'uan_number' => 'uanNumber',
                'pf_number' => 'pfNumber',
                'esic_number' => 'esicNumber',
                'ctc' => 'ctc',
                'role' => 'role',
            ];
            foreach ($orgFields as $db => $camel) {
                if (array_key_exists($camel, $body)) {
                    $val = is_string($body[$camel]) ? trim($body[$camel]) : $body[$camel];
                    $payload[$db] = $val === '' ? null : $val;
                }
            }
        }

        if ($payload !== []) {
            $payload['updated_at'] = now();
        }

        return $payload;
    }

    private function recordBankChange(HrmsUser $user, array $bank): void
    {
        HrmsEmployeeBankAccount::where('user_id', $user->id)
            ->where('is_active', true)
            ->update(['is_active' => false, 'effective_to' => now()]);

        if ($bank['bank_name'] || $bank['bank_account_number'] || $bank['bank_ifsc']) {
            HrmsEmployeeBankAccount::create([
                'company_id' => $user->company_id,
                'user_id' => $user->id,
                'bank_name' => $bank['bank_name'] ?: null,
                'bank_account_number' => $bank['bank_account_number'] ?: null,
                'bank_ifsc' => $bank['bank_ifsc'] ?: null,
                'is_active' => true,
                'effective_from' => now(),
                'created_by' => $user->id,
            ]);
        }
    }
}
