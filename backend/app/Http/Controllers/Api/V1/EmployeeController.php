<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompanyDocument;
use App\Models\HrmsEmployee;
use App\Models\HrmsEmployeeDocumentSubmission;
use App\Models\HrmsEmployeeInvite;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class EmployeeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $employees = HrmsEmployee::where('company_id', $user->company_id)
            ->with(['user', 'division', 'department', 'designation', 'shift', 'role'])
            ->orderBy('first_name')
            ->get();

        return response()->json(['employees' => $employees]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $employee = HrmsEmployee::with(['user', 'division', 'department', 'designation', 'shift', 'role', 'manager'])
            ->findOrFail($id);

        return response()->json(['employee' => $employee]);
    }

    public function store(Request $request): JsonResponse
    {
        $authUser = $request->user();
        if (! $authUser->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:255'],
            'last_name' => ['nullable', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'phone' => ['nullable', 'string'],
            'employee_code' => ['nullable', 'string'],
            'date_of_joining' => ['nullable', 'date'],
            'date_of_birth' => ['nullable', 'date'],
            'division_id' => ['nullable', 'uuid'],
            'department_id' => ['nullable', 'uuid'],
            'designation_id' => ['nullable', 'uuid'],
            'shift_id' => ['nullable', 'uuid'],
            'manager_id' => ['nullable', 'uuid'],
            'role_id' => ['nullable', 'uuid'],
            'gender' => ['nullable', 'string'],
            'designation' => ['nullable', 'string'],
            'role' => ['nullable', 'string'],
            'employment_status' => ['nullable', 'string'],
            'password' => ['nullable', 'string', 'min:6'],
            'gross_salary' => ['nullable', 'numeric'],
            'tds_monthly' => ['nullable', 'numeric'],
            'government_pay_level' => ['nullable', 'integer'],
            'aadhaar' => ['nullable', 'string'],
            'pan' => ['nullable', 'string'],
            'uan_number' => ['nullable', 'string'],
            'pf_number' => ['nullable', 'string'],
            'cpf_number' => ['nullable', 'string'],
            'current_address_line1' => ['nullable', 'string'],
            'current_address_line2' => ['nullable', 'string'],
            'current_city' => ['nullable', 'string'],
            'current_state' => ['nullable', 'string'],
            'current_country' => ['nullable', 'string'],
            'current_postal_code' => ['nullable', 'string'],
            'permanent_address_line1' => ['nullable', 'string'],
            'permanent_address_line2' => ['nullable', 'string'],
            'permanent_city' => ['nullable', 'string'],
            'permanent_state' => ['nullable', 'string'],
            'permanent_country' => ['nullable', 'string'],
            'permanent_postal_code' => ['nullable', 'string'],
            'emergency_contact_name' => ['nullable', 'string'],
            'emergency_contact_phone' => ['nullable', 'string'],
            'bank_name' => ['nullable', 'string'],
            'bank_account_number' => ['nullable', 'string'],
            'bank_ifsc' => ['nullable', 'string'],
            'requested_document_ids' => ['nullable', 'array'],
        ]);

        $email = mb_strtolower(trim($data['email']));
        $fullName = trim(($data['first_name'] ?? '').' '.($data['last_name'] ?? ''));

        $hrmsUser = HrmsUser::whereRaw('LOWER(email) = ?', [$email])->first();
        if (! $hrmsUser) {
            $employeeCode = $data['employee_code'] ?? $this->generateEmployeeCode();
            $hrmsUser = HrmsUser::create([
                'email' => $email,
                'password_hash' => isset($data['password']) ? Hash::make($data['password']) : null,
                'name' => $fullName ?: null,
                'role' => $data['role'] ?? 'employee',
                'auth_provider' => 'password',
                'auth_session_version' => 0,
                'company_id' => $authUser->company_id,
                'employee_code' => $employeeCode,
                'employment_status' => $data['employment_status'] ?? 'preboarding',
                'phone' => $data['phone'] ?? null,
                'date_of_birth' => $data['date_of_birth'] ?? null,
                'date_of_joining' => $data['date_of_joining'] ?? null,
                'gender' => $data['gender'] ?? null,
                'designation' => $data['designation'] ?? null,
                'designation_id' => $data['designation_id'] ?? null,
                'department_id' => $data['department_id'] ?? null,
                'division_id' => $data['division_id'] ?? null,
                'shift_id' => $data['shift_id'] ?? null,
                'gross_salary' => $data['gross_salary'] ?? null,
                'tds_monthly' => $data['tds_monthly'] ?? null,
                'government_pay_level' => $data['government_pay_level'] ?? null,
                'aadhaar' => $data['aadhaar'] ?? null,
                'pan' => $data['pan'] ?? null,
                'uan_number' => $data['uan_number'] ?? null,
                'pf_number' => $data['pf_number'] ?? null,
                'cpf_number' => $data['cpf_number'] ?? null,
                'current_address_line1' => $data['current_address_line1'] ?? null,
                'current_address_line2' => $data['current_address_line2'] ?? null,
                'current_city' => $data['current_city'] ?? null,
                'current_state' => $data['current_state'] ?? null,
                'current_country' => $data['current_country'] ?? null,
                'current_postal_code' => $data['current_postal_code'] ?? null,
                'permanent_address_line1' => $data['permanent_address_line1'] ?? null,
                'permanent_address_line2' => $data['permanent_address_line2'] ?? null,
                'permanent_city' => $data['permanent_city'] ?? null,
                'permanent_state' => $data['permanent_state'] ?? null,
                'permanent_country' => $data['permanent_country'] ?? null,
                'permanent_postal_code' => $data['permanent_postal_code'] ?? null,
                'emergency_contact_name' => $data['emergency_contact_name'] ?? null,
                'emergency_contact_phone' => $data['emergency_contact_phone'] ?? null,
                'bank_name' => $data['bank_name'] ?? null,
                'bank_account_number' => $data['bank_account_number'] ?? null,
                'bank_ifsc' => $data['bank_ifsc'] ?? null,
            ]);
        } else {
            $hrmsUser->update(array_filter([
                'company_id' => $authUser->company_id,
                'employment_status' => $data['employment_status'] ?? $hrmsUser->employment_status?->value,
                'phone' => $data['phone'] ?? $hrmsUser->phone,
                'gender' => $data['gender'] ?? $hrmsUser->gender,
                'gross_salary' => $data['gross_salary'] ?? $hrmsUser->gross_salary,
                'government_pay_level' => $data['government_pay_level'] ?? $hrmsUser->government_pay_level,
            ], fn ($v) => $v !== null));
        }

        $employee = HrmsEmployee::create([
            'user_id' => $hrmsUser->id,
            'company_id' => $authUser->company_id,
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'] ?? null,
            'email' => $email,
            'phone' => $data['phone'] ?? null,
            'employee_code' => $hrmsUser->employee_code,
            'date_of_joining' => $data['date_of_joining'] ?? null,
            'date_of_birth' => $data['date_of_birth'] ?? null,
            'division_id' => $data['division_id'] ?? null,
            'department_id' => $data['department_id'] ?? null,
            'designation_id' => $data['designation_id'] ?? null,
            'shift_id' => $data['shift_id'] ?? null,
            'manager_id' => $data['manager_id'] ?? null,
            'role_id' => $data['role_id'] ?? null,
            'is_active' => true,
        ]);

        return response()->json(['employee' => $employee->load('user')], 201);
    }

    private function generateEmployeeCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = 'EMP-';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            if (! HrmsUser::where('employee_code', $code)->exists()) {
                return $code;
            }
        }

        return 'EMP-'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $employee = HrmsEmployee::findOrFail($id);
        $employee->update($request->only([
            'first_name', 'last_name', 'email', 'phone', 'employee_code',
            'date_of_joining', 'date_of_leaving',
            'division_id', 'department_id', 'designation_id', 'shift_id',
            'manager_id', 'role_id', 'is_active',
            'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
            'emergency_contact_name', 'emergency_contact_phone',
            'bank_account_number', 'bank_ifsc',
        ]));

        return response()->json(['employee' => $employee->refresh()->load('user')]);
    }

    public function onboarding(Request $request, string $id): JsonResponse
    {
        $authUser = $request->user();
        $targetUser = HrmsUser::findOrFail($id);

        $invite = HrmsEmployeeInvite::where('user_id', $targetUser->id)
            ->orderBy('created_at', 'desc')
            ->first();

        $documents = [];
        if ($invite && $invite->requested_document_ids) {
            $docs = HrmsCompanyDocument::whereIn('id', $invite->requested_document_ids)->get();
            $subs = HrmsEmployeeDocumentSubmission::where('user_id', $targetUser->id)
                ->whereIn('document_id', $invite->requested_document_ids)
                ->get()
                ->keyBy('document_id');

            foreach ($docs as $doc) {
                $documents[] = [
                    'document' => $doc,
                    'submission' => $subs->get($doc->id),
                ];
            }
        }

        $master = HrmsPayrollMaster::where('employee_user_id', $targetUser->id)
            ->whereNull('effective_end_date')
            ->first();

        return response()->json([
            'user' => $targetUser,
            'invite' => $invite,
            'documents' => $documents,
            'payrollMaster' => $master,
        ]);
    }
}
