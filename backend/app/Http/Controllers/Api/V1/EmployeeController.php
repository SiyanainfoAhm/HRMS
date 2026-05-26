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
        $query = HrmsEmployee::where('company_id', $user->company_id)
            ->with(['user', 'division', 'department', 'designation', 'shift', 'role'])
            ->orderBy('first_name');

        $employmentStatus = $request->query('employmentStatus') ?? $request->query('employment_status');
        if ($employmentStatus) {
            $query->whereHas('user', function ($q) use ($employmentStatus) {
                $q->where('employment_status', $employmentStatus);
            });
        }

        $employees = $query->get();

        return response()->json(['employees' => $employees, 'total' => $employees->count()]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $employee = HrmsEmployee::with(['user', 'division', 'department', 'designation', 'shift', 'role', 'manager'])
            ->find($id);

        if (! $employee) {
            $employee = HrmsEmployee::with(['user', 'division', 'department', 'designation', 'shift', 'role', 'manager'])
                ->where('user_id', $id)
                ->first();
        }

        if (! $employee) {
            return response()->json(['error' => 'Employee not found'], 404);
        }

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

        $action = $request->input('action');

        if ($action === 'preview_convert_to_current') {
            return $this->previewConvertToCurrent($request, $id);
        }

        if ($action === 'convert_to_current') {
            return $this->convertToCurrent($request, $id);
        }

        if ($action === 'convert_to_past') {
            return $this->convertToPast($request, $id);
        }

        $employee = HrmsEmployee::find($id);
        if (! $employee) {
            $employee = HrmsEmployee::where('user_id', $id)->first();
        }
        if (! $employee) {
            return response()->json(['error' => 'Employee not found'], 404);
        }

        $employee->update($request->only([
            'first_name', 'last_name', 'email', 'phone', 'employee_code',
            'date_of_joining', 'date_of_leaving',
            'division_id', 'department_id', 'designation_id', 'shift_id',
            'manager_id', 'role_id', 'is_active',
            'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
            'emergency_contact_name', 'emergency_contact_phone',
            'bank_account_number', 'bank_ifsc',
        ]));

        // Also update HrmsUser fields if provided
        $targetUser = HrmsUser::find($employee->user_id);
        if ($targetUser) {
            $userFields = $request->only([
                'employment_status', 'date_of_joining', 'date_of_leaving',
                'government_pay_level', 'gross_salary', 'tds_monthly',
                'gender', 'designation', 'phone',
                'current_address_line1', 'current_address_line2', 'current_city',
                'current_state', 'current_country', 'current_postal_code',
                'permanent_address_line1', 'permanent_address_line2', 'permanent_city',
                'permanent_state', 'permanent_country', 'permanent_postal_code',
                'bank_name', 'bank_account_holder_name', 'bank_account_number', 'bank_ifsc',
                'aadhaar', 'pan', 'uan_number', 'pf_number', 'cpf_number',
            ]);
            $filtered = array_filter($userFields, fn ($v) => $v !== null);
            if (! empty($filtered)) {
                $targetUser->update($filtered);
            }
        }

        return response()->json(['employee' => $employee->refresh()->load('user')]);
    }

    private function previewConvertToCurrent(Request $request, string $id): JsonResponse
    {
        $targetUser = HrmsUser::find($id);
        if (! $targetUser) {
            $emp = HrmsEmployee::find($id);
            $targetUser = $emp ? HrmsUser::find($emp->user_id) : null;
        }
        if (! $targetUser) {
            return response()->json(['error' => 'User not found'], 404);
        }

        $existing = HrmsPayrollMaster::where('employee_user_id', $targetUser->id)
            ->whereNull('effective_end_date')
            ->orderBy('effective_start_date', 'desc')
            ->first();

        $grossBasic = (int) ($targetUser->gross_salary ?? 0);
        $daPercent = 53;
        $da = (int) round($grossBasic * $daPercent / 100);
        $cpfComputed = (int) round(($grossBasic + $da) * 0.12);
        $daCpfComputed = (int) round($da * 0.12);

        // Government pay formula defaults
        $defaults = [
            'gross_basic' => $grossBasic,
            'da_percent' => $daPercent,
            'hra_percent' => 30,
            'medical_fixed' => 3000,
            'transport_da_percent' => 48.06,
            'tds' => (int) ($targetUser->tds_monthly ?? 0),
            'pt_default' => 200,
            'advance_bonus' => 0,
            'lic_default' => 0,
            'cpf_default' => $cpfComputed,
            'da_cpf_default' => $daCpfComputed,
            'vpf_default' => 0,
            'pf_loan_default' => 0,
            'post_office_default' => 0,
            'credit_society_default' => 0,
            'std_licence_fee_default' => 0,
            'electricity_default' => 0,
            'water_default' => 0,
            'mess_default' => 0,
            'horticulture_default' => 0,
            'welfare_default' => 0,
            'veh_charge_default' => 0,
            'other_deduction_default' => 0,
        ];

        $payrollMaster = $defaults;
        if ($existing) {
            foreach ($defaults as $key => $defaultVal) {
                $val = $existing->{$key};
                $payrollMaster[$key] = ($val !== null && $val !== '' && $val != 0) ? $val : $defaultVal;
            }
        }

        return response()->json([
            'payrollMaster' => $payrollMaster,
            'government_pay_level' => $targetUser->government_pay_level,
        ]);
    }

    private function convertToCurrent(Request $request, string $id): JsonResponse
    {
        $targetUser = HrmsUser::find($id);
        if (! $targetUser) {
            $emp = HrmsEmployee::find($id);
            $targetUser = $emp ? HrmsUser::find($emp->user_id) : null;
        }
        if (! $targetUser) {
            return response()->json(['error' => 'User not found'], 404);
        }

        $dateOfJoining = $request->input('date_of_joining');
        $targetUser->employment_status = \App\Enums\EmploymentStatus::Current;
        if ($dateOfJoining) {
            $targetUser->date_of_joining = $dateOfJoining;
        }
        $targetUser->save();

        // Update employee record too
        $empRecord = HrmsEmployee::where('user_id', $targetUser->id)->first();
        if ($empRecord) {
            $empRecord->is_active = true;
            if ($dateOfJoining) {
                $empRecord->date_of_joining = $dateOfJoining;
            }
            $empRecord->save();
        }

        // Create/update payroll master if provided
        $payrollMaster = $request->input('payroll_master');
        if ($payrollMaster && is_array($payrollMaster)) {
            $payrollMaster['employee_user_id'] = $targetUser->id;
            $payrollMaster['company_id'] = $targetUser->company_id;
            $payrollMaster['effective_start_date'] = $dateOfJoining ?? now()->toDateString();
            $payrollMaster['created_by'] = $request->user()->id;
            $payrollMaster['payroll_mode'] = 'government';

            // Update gross_salary on user from gross_basic
            if (! empty($payrollMaster['gross_basic'])) {
                $targetUser->gross_salary = $payrollMaster['gross_basic'];
                $targetUser->save();
            }
            if (isset($payrollMaster['tds'])) {
                $targetUser->tds_monthly = $payrollMaster['tds'];
                $targetUser->save();
            }

            // Close any existing open master
            HrmsPayrollMaster::where('employee_user_id', $targetUser->id)
                ->whereNull('effective_end_date')
                ->update(['effective_end_date' => now()->subDay()->toDateString()]);

            HrmsPayrollMaster::create($payrollMaster);
        }

        return response()->json(['message' => 'Converted to current', 'user' => $targetUser->refresh()]);
    }

    private function convertToPast(Request $request, string $id): JsonResponse
    {
        $targetUser = HrmsUser::find($id);
        if (! $targetUser) {
            $emp = HrmsEmployee::find($id);
            $targetUser = $emp ? HrmsUser::find($emp->user_id) : null;
        }
        if (! $targetUser) {
            return response()->json(['error' => 'User not found'], 404);
        }

        $lastWorkingDate = $request->input('last_working_date');
        $targetUser->employment_status = \App\Enums\EmploymentStatus::Past;
        if ($lastWorkingDate) {
            $targetUser->date_of_leaving = $lastWorkingDate;
        }
        $targetUser->save();

        // Update employee record
        $empRecord = HrmsEmployee::where('user_id', $targetUser->id)->first();
        if ($empRecord) {
            $empRecord->is_active = false;
            if ($lastWorkingDate) {
                $empRecord->date_of_leaving = $lastWorkingDate;
            }
            $empRecord->save();
        }

        // Close any open payroll master
        HrmsPayrollMaster::where('employee_user_id', $targetUser->id)
            ->whereNull('effective_end_date')
            ->update(['effective_end_date' => $lastWorkingDate ?? now()->toDateString()]);

        return response()->json(['message' => 'Converted to past', 'user' => $targetUser->refresh()]);
    }

    public function onboarding(Request $request, string $id): JsonResponse
    {
        $authUser = $request->user();
        $targetUser = HrmsUser::find($id);
        if (! $targetUser) {
            $employee = HrmsEmployee::find($id);
            if ($employee) {
                $targetUser = HrmsUser::find($employee->user_id);
            }
        }
        if (! $targetUser) {
            return response()->json(['error' => 'User not found'], 404);
        }

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

        $empRecord = HrmsEmployee::where('user_id', $targetUser->id)->first();

        $employee = array_merge(
            $empRecord ? $empRecord->toArray() : [],
            [
                'id' => $targetUser->id,
                'employee_record_id' => $empRecord?->id,
                'name' => $targetUser->name ?? trim(($empRecord->first_name ?? '').' '.($empRecord->last_name ?? '')) ?: null,
                'email' => $targetUser->email,
                'phone' => $targetUser->phone ?? $empRecord?->phone,
                'gender' => $targetUser->gender,
                'date_of_birth' => $empRecord?->date_of_birth ?? $targetUser->date_of_birth,
                'date_of_joining' => $empRecord?->date_of_joining ?? $targetUser->date_of_joining,
                'current_address_line1' => $targetUser->current_address_line1,
                'current_address_line2' => $targetUser->current_address_line2,
                'current_city' => $targetUser->current_city,
                'current_state' => $targetUser->current_state,
                'bank_name' => $targetUser->bank_name,
                'bank_account_number' => $targetUser->bank_account_number,
                'bank_ifsc' => $targetUser->bank_ifsc,
                'aadhaar' => $targetUser->aadhaar,
                'pan' => $targetUser->pan,
                'uan_number' => $targetUser->uan_number,
                'pf_number' => $targetUser->pf_number,
                'gross_salary' => $targetUser->gross_salary,
                'tds_monthly' => $targetUser->tds_monthly,
                'government_pay_level' => $targetUser->government_pay_level,
            ]
        );

        return response()->json([
            'employee' => $employee,
            'user' => $targetUser,
            'invite' => $invite,
            'documents' => $documents,
            'payrollMaster' => $master,
        ]);
    }
}
