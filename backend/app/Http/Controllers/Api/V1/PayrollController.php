<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollController extends Controller
{
    public function periods(Request $request): JsonResponse
    {
        $periods = HrmsPayrollPeriod::where('company_id', $request->user()->company_id)
            ->orderBy('period_start', 'desc')
            ->get();

        return response()->json(['periods' => $periods]);
    }

    public function storePeriod(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'period_name' => ['required', 'string', 'max:255'],
            'period_start' => ['required', 'date'],
            'period_end' => ['required', 'date', 'after:period_start'],
        ]);

        $data['company_id'] = $user->company_id;
        $period = HrmsPayrollPeriod::create($data);

        return response()->json(['period' => $period], 201);
    }

    public function updatePeriod(Request $request, string $id): JsonResponse
    {
        $period = HrmsPayrollPeriod::findOrFail($id);
        $period->update($request->only([
            'period_name', 'period_start', 'period_end', 'is_locked', 'excel_file_path',
        ]));

        return response()->json(['period' => $period->refresh()]);
    }

    public function master(Request $request): JsonResponse
    {
        $user = $request->user();
        $targetUserId = $request->input('user_id', $user->id);

        if ($targetUserId !== $user->id && ! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $masters = HrmsPayrollMaster::where('employee_user_id', $targetUserId)
            ->orderBy('effective_start_date', 'desc')
            ->get();

        $current = $masters->first(function ($m) {
            return $m->effective_end_date === null || $m->effective_end_date >= now()->toDateString();
        });

        return response()->json(['masters' => $masters, 'current' => $current]);
    }

    public function storeMaster(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'employee_user_id' => ['required', 'uuid'],
            'effective_start_date' => ['required', 'date'],
            'effective_end_date' => ['nullable', 'date'],
            'gross_salary' => ['nullable', 'numeric'],
            'ctc' => ['nullable', 'numeric'],
            'basic' => ['nullable', 'numeric'],
            'hra' => ['nullable', 'numeric'],
            'medical' => ['nullable', 'numeric'],
            'trans' => ['nullable', 'numeric'],
            'lta' => ['nullable', 'numeric'],
            'personal' => ['nullable', 'numeric'],
            'pf_eligible' => ['nullable', 'boolean'],
            'esic_eligible' => ['nullable', 'boolean'],
            'pf_employee' => ['nullable', 'numeric'],
            'pf_employer' => ['nullable', 'numeric'],
            'esic_employee' => ['nullable', 'numeric'],
            'esic_employer' => ['nullable', 'numeric'],
            'pt' => ['nullable', 'numeric'],
            'take_home' => ['nullable', 'numeric'],
            'tds' => ['nullable', 'numeric'],
            'advance_bonus' => ['nullable', 'numeric'],
            'reason_for_change' => ['nullable', 'string'],
            'payroll_mode' => ['nullable', 'in:private,government'],
        ]);

        $data['company_id'] = $user->company_id;
        $data['created_by'] = $user->id;

        $master = HrmsPayrollMaster::create($data);

        return response()->json(['master' => $master], 201);
    }

    public function run(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'period_id' => ['required', 'uuid'],
            'employee_user_ids' => ['required', 'array'],
            'employee_user_ids.*' => ['uuid'],
        ]);

        $period = HrmsPayrollPeriod::findOrFail($data['period_id']);
        $results = [];

        foreach ($data['employee_user_ids'] as $userId) {
            $master = HrmsPayrollMaster::where('employee_user_id', $userId)
                ->where(function ($q) use ($period) {
                    $q->whereNull('effective_end_date')
                      ->orWhere('effective_end_date', '>=', $period->period_start);
                })
                ->where('effective_start_date', '<=', $period->period_end)
                ->orderBy('effective_start_date', 'desc')
                ->first();

            if ($master) {
                $empUser = HrmsUser::find($userId);
                $results[] = [
                    'employee_user_id' => $userId,
                    'name' => $empUser?->name,
                    'email' => $empUser?->email,
                    'master' => $master,
                ];
            }
        }

        return response()->json(['payrollRun' => $results, 'period' => $period]);
    }

    public function storePayslips(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'payslips' => ['required', 'array'],
            'payslips.*.employee_user_id' => ['required', 'uuid'],
            'payslips.*.payroll_period_id' => ['required', 'uuid'],
            'payslips.*.basic' => ['nullable', 'numeric'],
            'payslips.*.hra' => ['nullable', 'numeric'],
            'payslips.*.allowances' => ['nullable', 'numeric'],
            'payslips.*.deductions' => ['nullable', 'numeric'],
            'payslips.*.gross_pay' => ['nullable', 'numeric'],
            'payslips.*.net_pay' => ['nullable', 'numeric'],
        ]);

        $created = [];
        foreach ($data['payslips'] as $slip) {
            $slip['company_id'] = $user->company_id;
            $slip['generated_at'] = now();
            $slip['created_by'] = $user->id;

            $empUser = HrmsUser::find($slip['employee_user_id']);
            if ($empUser) {
                $slip['bank_name'] = $empUser->bank_name;
                $slip['bank_account_number'] = $empUser->bank_account_number;
                $slip['bank_ifsc'] = $empUser->bank_ifsc;
            }

            $created[] = HrmsPayslip::create($slip);
        }

        return response()->json(['payslips' => $created], 201);
    }

    public function export(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $periodId = $request->input('period_id');
        if (! $periodId) {
            return response()->json(['error' => 'period_id required'], 422);
        }

        $payslips = HrmsPayslip::where('payroll_period_id', $periodId)
            ->where('company_id', $user->company_id)
            ->with('employeeUser')
            ->get();

        return response()->json(['payslips' => $payslips]);
    }
}
