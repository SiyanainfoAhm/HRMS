<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsEmployee;
use App\Models\HrmsReimbursement;
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

        $items = $query->orderBy('created_at', 'desc')->get();

        return response()->json(['reimbursements' => $items]);
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
        ]);

        $employee = HrmsEmployee::where('user_id', $user->id)->first();
        $claimDate = Carbon::parse($data['claim_date']);

        $reimb = HrmsReimbursement::create([
            'company_id' => $user->company_id,
            'employee_id' => $employee?->id,
            'employee_user_id' => $user->id,
            'department_id' => $employee?->department_id ?? $user->department_id,
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

        return response()->json(['reimbursement' => $reimb], 201);
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
        $request->validate(['file' => ['required', 'file', 'max:5120']]);

        $path = $request->file('file')->store('reimbursements', 'public');
        $url = Storage::disk('public')->url($path);

        return response()->json(['url' => $url]);
    }
}
