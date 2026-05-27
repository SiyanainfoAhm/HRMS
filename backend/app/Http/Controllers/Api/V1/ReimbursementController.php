<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsReimbursement;
use App\Models\HrmsUser;
use App\Support\EmployeeRecordService;
use App\Support\PayrollRunGuard;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ReimbursementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = HrmsReimbursement::where('company_id', $user->company_id);

        if (! $user->role?->isManagerial()) {
            $query->where('employee_user_id', $user->id);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }
        if ($request->filled('payroll_year')) {
            $query->where('payroll_year', $request->input('payroll_year'));
        }
        if ($request->filled('payroll_month')) {
            $query->where('payroll_month', $request->input('payroll_month'));
        }

        $page = max(1, (int) ($request->query('page') ?? 1));
        $pageSize = max(1, min(200, (int) ($request->query('page_size') ?? $request->query('pageSize') ?? 20)));

        $total = (clone $query)->count();
        $items = $query
            ->with(['employeeUser', 'approverUser'])
            ->orderBy('created_at', 'desc')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get()
            ->map(function (HrmsReimbursement $r) {
                return array_merge($r->toArray(), [
                    'employeeName' => $r->employeeUser?->name,
                    'employeeEmail' => $r->employeeUser?->email,
                    'approverName' => $r->approverUser?->name,
                    'approverEmail' => $r->approverUser?->email,
                ]);
            });

        return response()->json(['claims' => $items, 'total' => $total]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'category' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0'],
            'currency' => ['nullable', 'string', 'size:3'],
            'claim_date' => ['required', 'date'],
            'description' => ['nullable', 'string'],
            'attachment_url' => ['nullable', 'string'],
            'employee_user_id' => ['nullable', 'uuid'],
        ]);

        if (! $user->company_id) {
            return response()->json(['error' => 'Company is required to submit a reimbursement claim'], 422);
        }

        $subjectUser = $user;
        $targetUserId = $data['employee_user_id'] ?? null;
        if ($targetUserId && $targetUserId !== $user->id) {
            if (! $user->role?->isManagerial()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $target = HrmsUser::where('id', $targetUserId)
                ->where('company_id', $user->company_id)
                ->first();
            if (! $target) {
                return response()->json(['error' => 'Employee user not found'], 404);
            }
            $subjectUser = $target;
        }

        $employee = EmployeeRecordService::forUser($subjectUser);
        $claimDate = Carbon::parse($data['claim_date']);

        if (PayrollRunGuard::isPayrollRunForDate($user->company_id, $claimDate)) {
            return response()->json([
                'error' => PayrollRunGuard::blockMessageForMonth((int) $claimDate->year, (int) $claimDate->month),
            ], 422);
        }

        $reimb = HrmsReimbursement::create([
            'company_id' => $user->company_id,
            'employee_id' => $employee->id,
            'employee_user_id' => $subjectUser->id,
            'department_id' => $employee->department_id ?? $subjectUser->department_id,
            'category' => $data['category'],
            'amount' => $data['amount'],
            'currency' => $data['currency'] ?? 'INR',
            'claim_date' => $data['claim_date'],
            'description' => $data['description'] ?? null,
            'attachment_url' => $data['attachment_url'] ?? null,
            'status' => 'pending',
            'payroll_year' => $claimDate->year,
            'payroll_month' => $claimDate->month,
        ]);

        $reimb->load(['employeeUser', 'approverUser']);

        return response()->json([
            'reimbursement' => array_merge($reimb->toArray(), [
                'employeeName' => $reimb->employeeUser?->name,
                'employeeEmail' => $reimb->employeeUser?->email,
                'approverName' => $reimb->approverUser?->name,
                'approverEmail' => $reimb->approverUser?->email,
            ]),
        ], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $reimb = HrmsReimbursement::findOrFail($id);

        $data = $request->validate([
            'status' => ['sometimes', 'in:approved,rejected,paid'],
            'rejection_reason' => ['nullable', 'string'],
            'category' => ['sometimes', 'string'],
            'amount' => ['sometimes', 'numeric'],
            'description' => ['nullable', 'string'],
            'attachment_url' => ['nullable', 'string'],
        ]);

        if (isset($data['status']) && in_array($data['status'], ['approved', 'rejected', 'paid'])) {
            if (! $user->role?->isManagerial()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $data['approver_user_id'] = $user->id;
            if ($data['status'] === 'approved') {
                $data['approved_at'] = now();
            } elseif ($data['status'] === 'rejected') {
                $data['rejected_at'] = now();
            } elseif ($data['status'] === 'paid') {
                $data['paid_at'] = now();
            }
        } elseif ($reimb->status !== 'pending') {
            return response()->json(['error' => 'Can only edit pending reimbursements'], 422);
        }

        $reimb->update($data);

        return response()->json(['reimbursement' => $reimb->refresh()]);
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:8192']]);

        $path = $request->file('file')->store('reimbursements', 'public');
        $url = Storage::disk('public')->url($path);

        return response()->json(['url' => $url]);
    }
}
