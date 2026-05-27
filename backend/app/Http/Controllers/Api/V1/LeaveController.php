<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsEmployee;
use App\Models\HrmsLeavePolicy;
use App\Models\HrmsLeaveRequest;
use App\Models\HrmsLeaveType;
use App\Models\HrmsUser;
use App\Support\EmployeeRecordService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveController extends Controller
{
    /** @return array<string, mixed> */
    private function formatLeaveRequest(HrmsLeaveRequest $leave): array
    {
        $leave->loadMissing(['leaveType', 'employeeUser']);

        return array_merge($leave->toArray(), [
            'leaveTypeId' => $leave->leave_type_id,
            'leaveTypeName' => $leave->leaveType?->name,
            'startDate' => $leave->start_date?->format('Y-m-d'),
            'endDate' => $leave->end_date?->format('Y-m-d'),
            'totalDays' => (float) $leave->total_days,
            'employeeUserId' => $leave->employee_user_id,
            'employeeName' => $leave->employeeUser?->name,
            'employeeEmail' => $leave->employeeUser?->email,
            'createdAt' => $leave->created_at?->toIso8601String(),
        ]);
    }

    public function types(Request $request): JsonResponse
    {
        $companyId = $request->user()->company_id;
        $types = HrmsLeaveType::where('company_id', $companyId)
            ->orderBy('name')
            ->get();

        $policiesByType = HrmsLeavePolicy::where('company_id', $companyId)
            ->get()
            ->groupBy('leave_type_id');

        $formatted = $types->map(function (HrmsLeaveType $type) use ($policiesByType) {
            $policies = ($policiesByType->get($type->id) ?? collect())->values()->all();

            return array_merge($type->toArray(), [
                'HRMS_leave_policies' => $policies,
                'leavePolicies' => $policies,
            ]);
        })->values()->all();

        return response()->json([
            'types' => $formatted,
            'leaveTypes' => $formatted,
        ]);
    }

    public function storeType(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:20'],
            'description' => ['nullable', 'string'],
            'is_paid' => ['nullable', 'boolean'],
            'annual_quota' => ['nullable', 'numeric'],
            'payslip_slot' => ['nullable', 'string', 'in:CL,EL,HPL,HL'],
        ]);

        $data['company_id'] = $user->company_id;
        if (isset($data['payslip_slot']) && $data['payslip_slot'] === '') {
            $data['payslip_slot'] = null;
        }
        $type = HrmsLeaveType::create($data);

        return response()->json(['leaveType' => $type, 'type' => $type], 201);
    }

    public function updateType(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $type = HrmsLeaveType::where('id', $id)
            ->where('company_id', $user->company_id)
            ->firstOrFail();

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:20'],
            'description' => ['nullable', 'string'],
            'is_paid' => ['sometimes', 'boolean'],
            'annual_quota' => ['nullable', 'numeric'],
            'payslip_slot' => ['nullable', 'string', 'in:CL,EL,HPL,HL'],
        ]);

        if (array_key_exists('payslip_slot', $data) && ($data['payslip_slot'] === '' || $data['payslip_slot'] === null)) {
            $data['payslip_slot'] = null;
        }

        $type->update($data);

        $refreshed = $type->refresh();

        return response()->json(['type' => $refreshed, 'leaveType' => $refreshed]);
    }

    public function policies(Request $request): JsonResponse
    {
        $policies = HrmsLeavePolicy::where('company_id', $request->user()->company_id)
            ->with('leaveType')
            ->get();

        return response()->json(['leavePolicies' => $policies]);
    }

    public function storePolicy(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'leave_type_id' => ['required', 'uuid'],
            'accrual_method' => ['required', 'in:monthly,annual,none'],
            'monthly_accrual_rate' => ['nullable', 'numeric'],
            'annual_quota' => ['nullable', 'numeric'],
            'prorate_on_join' => ['nullable', 'boolean'],
            'reset_month' => ['nullable', 'integer', 'min:1', 'max:12'],
            'reset_day' => ['nullable', 'integer', 'min:1', 'max:31'],
            'allow_carryover' => ['nullable', 'boolean'],
            'carryover_limit' => ['nullable', 'numeric'],
        ]);

        $data['company_id'] = $user->company_id;

        $existing = HrmsLeavePolicy::where('company_id', $user->company_id)
            ->where('leave_type_id', $data['leave_type_id'])
            ->first();

        if ($existing) {
            $existing->update($data);
            return response()->json(['leavePolicy' => $existing->refresh()->load('leaveType')]);
        }

        $policy = HrmsLeavePolicy::create($data);

        return response()->json(['leavePolicy' => $policy->load('leaveType')], 201);
    }

    public function balance(Request $request): JsonResponse
    {
        $authUser = $request->user();
        $targetUserId = $request->input('user_id', $authUser->id);

        if ($targetUserId !== $authUser->id && ! $authUser->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $targetUser = HrmsUser::findOrFail($targetUserId);
        $companyId = $targetUser->company_id ?? $authUser->company_id;

        $policies = HrmsLeavePolicy::where('company_id', $companyId)
            ->with('leaveType')
            ->get();

        $approvedLeaves = HrmsLeaveRequest::where('employee_user_id', $targetUserId)
            ->where('status', 'approved')
            ->get();

        $balances = [];
        foreach ($policies as $policy) {
            $used = $approvedLeaves
                ->where('leave_type_id', $policy->leave_type_id)
                ->sum('total_days');

            $quota = (float) ($policy->annual_quota ?? 0);

            $balances[] = [
                'leave_type_id' => $policy->leave_type_id,
                'leave_type_name' => $policy->leaveType?->name,
                'leave_type_code' => $policy->leaveType?->code,
                'annual_quota' => $quota,
                'used' => (float) $used,
                'balance' => $quota - (float) $used,
            ];
        }

        return response()->json(['balances' => $balances, 'userId' => $targetUserId]);
    }

    public function requests(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = HrmsLeaveRequest::where('company_id', $user->company_id)
            ->with(['leaveType', 'employeeUser']);

        if (! $user->role?->isManagerial()) {
            $query->where('employee_user_id', $user->id);
        } elseif ($request->filled('employee_user_id') || $request->filled('employeeUserId')) {
            $empUid = $request->input('employee_user_id') ?? $request->input('employeeUserId');
            $query->where('employee_user_id', $empUid);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        $page = max(1, (int) ($request->query('page') ?? 1));
        $pageSize = max(1, min(200, (int) ($request->query('page_size') ?? $request->query('pageSize') ?? 20)));

        $total = (clone $query)->count();
        $leaves = $query
            ->orderBy('created_at', 'desc')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get()
            ->map(fn (HrmsLeaveRequest $leave) => $this->formatLeaveRequest($leave))
            ->values()
            ->all();

        return response()->json([
            'requests' => $leaves,
            'leaveRequests' => $leaves,
            'total' => $total,
        ]);
    }

    public function storeRequest(Request $request): JsonResponse
    {
        $user = $request->user();

        $targetUserId = $user->id;
        if ($user->role?->isManagerial()) {
            $targetUserId = $request->input('employee_user_id')
                ?? $request->input('employeeUserId')
                ?? $user->id;
        }

        $data = $request->validate([
            'leave_type_id' => ['required', 'uuid'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after_or_equal:start_date'],
            'total_days' => ['nullable', 'numeric', 'min:0.5'],
            'reason' => ['nullable', 'string'],
            'employee_user_id' => ['nullable', 'uuid'],
        ]);

        $start = Carbon::parse($data['start_date']);
        $end = Carbon::parse($data['end_date']);
        $totalDays = $data['total_days'] ?? ($start->diffInDays($end) + 1);

        $subjectUser = HrmsUser::where('id', $targetUserId)
            ->where('company_id', $user->company_id)
            ->first();
        if (! $subjectUser) {
            return response()->json(['error' => 'Employee user not found'], 404);
        }

        $employee = EmployeeRecordService::forUser($subjectUser);
        $autoApprove = (bool) $user->role?->isManagerial();

        $leaveRequest = HrmsLeaveRequest::create([
            'company_id' => $user->company_id,
            'employee_id' => $employee->id,
            'employee_user_id' => $subjectUser->id,
            'manager_id' => $employee->manager_id,
            'department_id' => $employee->department_id ?? $user->department_id,
            'leave_type_id' => $data['leave_type_id'],
            'start_date' => $data['start_date'],
            'end_date' => $data['end_date'],
            'total_days' => $totalDays,
            'reason' => $data['reason'] ?? null,
            'status' => $autoApprove ? 'approved' : 'pending',
            'approver_user_id' => $autoApprove ? $user->id : null,
            'approved_at' => $autoApprove ? now() : null,
        ]);

        $formatted = $this->formatLeaveRequest($leaveRequest->load(['leaveType', 'employeeUser']));

        return response()->json([
            'request' => $formatted,
            'leaveRequest' => $formatted,
        ], 201);
    }

    public function updateRequest(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $leave = HrmsLeaveRequest::where('id', $id)
            ->where('company_id', $user->company_id)
            ->firstOrFail();

        $data = $request->validate([
            'status' => ['sometimes', 'in:approved,rejected,cancelled,pending'],
            'rejection_reason' => ['nullable', 'string'],
        ]);

        if (isset($data['status']) && in_array($data['status'], ['approved', 'rejected'], true)) {
            if (! $user->role?->isManagerial()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $data['approver_user_id'] = $user->id;
            if ($data['status'] === 'approved') {
                $data['approved_at'] = now();
                $data['rejected_at'] = null;
                $data['rejection_reason'] = null;
            } else {
                $data['rejected_at'] = now();
                $data['approved_at'] = null;
            }
        }

        $leave->update($data);

        $formatted = $this->formatLeaveRequest($leave->refresh()->load(['leaveType', 'employeeUser']));

        return response()->json([
            'request' => $formatted,
            'leaveRequest' => $formatted,
        ]);
    }
}
