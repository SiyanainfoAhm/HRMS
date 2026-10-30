<?php

namespace App\Http\Middleware;

use App\Services\PayrollEditLockService;
use App\Models\HrmsPayrollPeriod;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class RequirePayrollEditLock
{
    public function handle(Request $request, Closure $next, string $scope = 'period'): Response
    {
        $data = $request->all();
        $clientId = $data['clientId'] ?? $data['client_id'] ?? $request->header('X-Payroll-Client-ID');
        $token = $data['leaseToken'] ?? $data['lease_token'] ?? $request->header('X-Payroll-Lease-Token');
        $year = (int)($data['year'] ?? 0);
        $month = (int)($data['month'] ?? 0);
        $monthlyId = $scope === 'monthly' ? (string)$request->route('id') : null;
        if ($scope === 'period_id') {
            $periodIds = collect($data['payslips'] ?? [])->map(fn ($row) => is_array($row) ? ($row['payroll_period_id'] ?? $row['payrollPeriodId'] ?? null) : null)->filter()->unique()->values();
            if ($periodIds->count() !== 1) return response()->json(['message'=>'All payslips in a write must target one payroll period.','code'=>'PAYROLL_PERIOD_SCOPE_REQUIRED'],422);
            $period = HrmsPayrollPeriod::query()->where('company_id',$request->user()->company_id)->find($periodIds->first());
            if (!$period) return response()->json(['message'=>'Payroll period was not found.'],404);
            $year = (int)$period->period_start->format('Y');
            $month = (int)$period->period_start->format('n');
        }
        if (!is_string($clientId) || !is_string($token)) return response()->json(['message'=>'An active payroll editing lease is required.','code'=>'PAYROLL_EDIT_LOCK_REQUIRED'],423);

        return DB::transaction(function () use ($request,$next,$clientId,$token,$year,$month,$monthlyId): Response {
            $active = app(PayrollEditLockService::class)->lockForWrite((string)$request->user()->company_id,(string)$request->user()->id,$clientId,$token,$year,$month,$monthlyId);
            if (!$active) return response()->json(['message'=>'Payroll editing lease expired or was taken over. Reload before saving.','code'=>'PAYROLL_EDIT_LOCK_LOST'],423);
            return $next($request);
        });
    }
}
