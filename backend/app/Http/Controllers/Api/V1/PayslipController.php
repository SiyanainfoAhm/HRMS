<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsPayslip;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayslipController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $payslips = HrmsPayslip::where('employee_user_id', $user->id)
            ->with('payrollPeriod')
            ->orderBy('generated_at', 'desc')
            ->get();

        return response()->json(['payslips' => $payslips]);
    }

    public function forEmployee(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $userId = $request->input('user_id');
        if (! $userId) {
            return response()->json(['error' => 'user_id required'], 422);
        }

        $payslips = HrmsPayslip::where('employee_user_id', $userId)
            ->where('company_id', $user->company_id)
            ->with('payrollPeriod')
            ->orderBy('generated_at', 'desc')
            ->get();

        return response()->json(['payslips' => $payslips]);
    }
}
