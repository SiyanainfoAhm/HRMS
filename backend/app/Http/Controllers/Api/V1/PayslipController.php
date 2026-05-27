<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Models\HrmsDepartment;
use App\Models\HrmsEmployee;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayslipController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['payslips' => [], 'company' => null, 'user' => null]);
        }

        return response()->json($this->buildPayslipsResponse($user->company_id, $user->id));
    }

    public function forEmployee(Request $request): JsonResponse
    {
        $auth = $request->user();
        if (! $auth->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $employeeUserId = $this->resolveEmployeeUserId($request);
        if (! $employeeUserId) {
            return response()->json(['error' => 'user_id required'], 422);
        }

        $resolvedUserId = $this->resolveToEmployeeUserId($employeeUserId, $auth->company_id);
        if (! $resolvedUserId) {
            return response()->json(['error' => 'Employee not found or access denied'], 404);
        }

        return response()->json($this->buildPayslipsResponse($auth->company_id, $resolvedUserId));
    }

    private function resolveEmployeeUserId(Request $request): ?string
    {
        foreach (['user_id', 'employeeUserId', 'employee_user_id'] as $key) {
            $v = $request->query($key) ?? $request->input($key);
            if (is_string($v) && trim($v) !== '') {
                return trim($v);
            }
        }

        return null;
    }

    /** Accept HRMS user id or HRMS employee row id from the employees list. */
    private function resolveToEmployeeUserId(string $id, string $companyId): ?string
    {
        $user = HrmsUser::where('id', $id)->where('company_id', $companyId)->first();
        if ($user) {
            return $user->id;
        }

        $employee = HrmsEmployee::where('id', $id)->where('company_id', $companyId)->first();
        if ($employee?->user_id) {
            return $employee->user_id;
        }

        $employee = HrmsEmployee::where('user_id', $id)->where('company_id', $companyId)->first();
        if ($employee?->user_id) {
            return $employee->user_id;
        }

        return null;
    }

    /**
     * @return array{company: array<string, mixed>|null, user: array<string, mixed>|null, payslips: list<array<string, mixed>>}
     */
    private function buildPayslipsResponse(string $companyId, string $employeeUserId): array
    {
        $company = HrmsCompany::find($companyId);
        $user = HrmsUser::find($employeeUserId);

        $payslips = HrmsPayslip::where('company_id', $companyId)
            ->where('employee_user_id', $employeeUserId)
            ->with('payrollPeriod')
            ->orderByDesc('generated_at')
            ->get();

        $slipIds = $payslips->pluck('id')->filter()->all();
        $govByPayslipId = collect();
        if ($slipIds !== []) {
            $govByPayslipId = HrmsGovernmentMonthlyPayroll::whereIn('payslip_id', $slipIds)
                ->get()
                ->keyBy('payslip_id');
        }

        $deptName = null;
        if ($user?->department_id) {
            $deptName = HrmsDepartment::find($user->department_id)?->name;
        }

        $formatted = $payslips->map(function (HrmsPayslip $p) use ($govByPayslipId) {
            $period = $p->payrollPeriod;
            $periodStart = $period?->period_start?->format('Y-m-d') ?? '';
            $periodEnd = $period?->period_end?->format('Y-m-d') ?? '';
            $periodFormatted = ($periodStart && $periodEnd)
                ? $this->fmtDate($periodStart).' - '.$this->fmtDate($periodEnd)
                : '';
            $periodMonth = $periodStart ? substr($periodStart, 0, 7) : '';

            $totalDays = 0;
            if ($periodStart && $periodEnd) {
                $start = strtotime($periodStart);
                $end = strtotime($periodEnd);
                if ($start !== false && $end !== false) {
                    $totalDays = (int) round(($end - $start) / 86400) + 1;
                }
            }

            $payDays = $p->pay_days !== null ? (float) $p->pay_days : 0;
            $gov = $govByPayslipId->get($p->id);
            $unpaidLeaves = $gov
                ? (int) ($gov->unpaid_days ?? 0)
                : ($totalDays > 0 ? max(0, $totalDays - (int) $payDays) : 0);

            $generatedAt = $p->generated_at
                ? $p->generated_at->toIso8601String()
                : now()->toIso8601String();

            return [
                'id' => $p->id,
                'payrollPeriodId' => $p->payroll_period_id,
                'payrollMode' => $p->payroll_mode ?? 'private',
                'netPay' => (float) ($p->net_pay ?? 0),
                'grossPay' => (float) ($p->gross_pay ?? 0),
                'payDays' => $payDays,
                'unpaidLeaves' => $unpaidLeaves,
                'basic' => (float) ($p->basic ?? 0),
                'hra' => (float) ($p->hra ?? 0),
                'allowances' => (float) ($p->allowances ?? 0),
                'medical' => (float) ($p->medical ?? 0),
                'trans' => (float) ($p->trans ?? 0),
                'lta' => (float) ($p->lta ?? 0),
                'personal' => (float) ($p->personal ?? 0),
                'deductions' => (float) ($p->deductions ?? 0),
                'pfEmployee' => (float) ($p->pf_employee ?? 0),
                'esicEmployee' => (float) ($p->esic_employee ?? 0),
                'professionalTax' => (float) ($p->professional_tax ?? 0),
                'incentive' => (float) ($p->incentive ?? 0),
                'prBonus' => (float) ($p->pr_bonus ?? 0),
                'reimbursement' => (float) ($p->reimbursement ?? 0),
                'tds' => (float) ($p->tds ?? 0),
                'currency' => $p->currency,
                'payslipNumber' => $p->payslip_number,
                'generatedAt' => $generatedAt,
                'bankName' => $p->bank_name ?? '',
                'bankAccountNumber' => $p->bank_account_number ?? '',
                'bankIfsc' => $p->bank_ifsc ?? '',
                'periodStart' => $periodStart,
                'periodEnd' => $periodEnd,
                'periodName' => $period?->period_name ?? '',
                'periodFormatted' => $periodFormatted,
                'periodMonth' => $periodMonth,
                'governmentMonthly' => $gov ? $gov->toArray() : null,
                'leavePayslip' => null,
            ];
        })->values()->all();

        return [
            'company' => $this->formatCompany($company),
            'user' => $this->formatUser($user, $deptName),
            'payslips' => $formatted,
        ];
    }

    private function formatCompany(?HrmsCompany $company): ?array
    {
        if (! $company) {
            return null;
        }

        $addrParts = array_filter([
            $company->address_line1,
            $company->address_line2,
            trim(implode(', ', array_filter([$company->city, $company->state, $company->postal_code]))),
            $company->country,
        ]);

        $logo = $company->logo_url;

        return [
            'name' => $company->name,
            'address' => implode(', ', $addrParts),
            'logoUrl' => is_string($logo) && trim($logo) !== '' ? trim($logo) : null,
        ];
    }

    private function formatUser(?HrmsUser $user, ?string $departmentName): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'id' => $user->id,
            'name' => $user->name ?? '',
            'employeeCode' => $user->employee_code ?? '',
            'designation' => $user->designation ?? '',
            'departmentName' => $departmentName ?? '',
            'dateOfJoining' => $user->date_of_joining?->format('Y-m-d') ?? '',
            'aadhaar' => $user->aadhaar ?? '',
            'pan' => $user->pan ?? '',
            'uanNumber' => $user->uan_number ?? '',
            'pfNumber' => $user->pf_number ?? '',
            'esicNumber' => $user->esic_number ?? '',
            'governmentPayLevel' => $user->government_pay_level,
        ];
    }

    private function fmtDate(string $ymd): string
    {
        $parts = explode('-', $ymd);
        if (count($parts) !== 3) {
            return '';
        }
        [$y, $m, $d] = $parts;
        $months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        $mi = (int) $m;

        return sprintf('%02d %s %s', (int) $d, $months[max(0, min(11, $mi - 1))] ?? '', $y);
    }
}
