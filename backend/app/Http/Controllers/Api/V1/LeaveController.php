<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsEmployee;
use App\Models\HrmsLeavePolicy;
use App\Models\HrmsLeaveRequest;
use App\Models\HrmsLeaveType;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveController extends Controller
{
    public function types(Request $request): JsonResponse
    {
        $types = HrmsLeaveType::where('company_id', $request->user()->company_id)
            ->orderBy('name')
            ->get();

        return response()->json(['leaveTypes' => $types]);
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
        ]);

        $data['company_id'] = $user->company_id;
        $type = HrmsLeaveType::create($data);

        return response()->json(['leaveType' => $type], 201);
    }

    public function updateType(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $type = HrmsLeaveType::findOrFail($id);
        $type->update($request->only(['name', 'code', 'description', 'is_paid', 'annual_quota', 'payslip_slot']));

        return response()->json(['type' => $type->refresh()]);
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
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        $leaves = $query->orderBy('created_at', 'desc')->get();

        return response()->json(['leaveRequests' => $leaves]);
    }

    public function storeRequest(Request $request): JsonResponse
    {
        $user = $request->user();

        $targetUserId = $user->id;
        if ($request->filled('employee_user_id') && $user->role?->isManagerial()) {
            $targetUserId = $request->input('employee_user_id');
        }

        $data = $request->validate([
            'leave_type_id' => ['required', 'uuid'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after_or_equal:start_date'],
            'total_days' => ['nullable', 'numeric', 'min:0.5'],
            'reason' => ['nullable', 'string'],
            'employee_user_id' => ['nullable', 'uuid'],
        ]);

        $totalDays = $data['total_days']
            ?? ((\Carbon\Carbon::parse($data['start_date'])->diffInDays(\Carbon\Carbon::parse($data['end_date']))) + 1);

        $employee = HrmsEmployee::where('user_id', $targetUserId)->first();

        $leaveRequest = HrmsLeaveRequest::create([
            'company_id' => $user->company_id,
            'employee_id' => $employee?->id,
            'employee_user_id' => $targetUserId,
            'manager_id' => $employee?->manager_id,
            'department_id' => $employee?->department_id ?? $user->department_id,
            'leave_type_id' => $data['leave_type_id'],
            'start_date' => $data['start_date'],
            'end_date' => $data['end_date'],
            'total_days' => $totalDays,
            'reason' => $data['reason'] ?? null,
            'status' => 'pending',
        ]);

        return response()->json(['leaveRequest' => $leaveRequest->load('leaveType')], 201);
    }

    public function updateRequest(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $leave = HrmsLeaveRequest::findOrFail($id);

        $data = $request->validate([
            'status' => ['sometimes', 'in:approved,rejected,cancelled'],
            'rejection_reason' => ['nullable', 'string'],
        ]);

        if (isset($data['status']) && in_array($data['status'], ['approved', 'rejected'])) {
            if (! $user->role?->isManagerial()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $data['approver_user_id'] = $user->id;
            if ($data['status'] === 'approved') {
                $data['approved_at'] = now();
            } else {
                $data['rejected_at'] = now();
            }
        }

        $leave->update($data);

        return response()->json(['leaveRequest' => $leave->refresh()->load('leaveType')]);
    }
}
