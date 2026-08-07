<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Models\HrmsDepartment;
use App\Models\HrmsEmployee;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use App\Services\PayrollMasterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayslipController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $masterService,
    ) {}

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

        $currentMaster = $this->currentMasterForEmployee($companyId, $employeeUserId);

        $formatted = $payslips->map(function (HrmsPayslip $p) use ($govByPayslipId, $currentMaster, $user) {
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
            $master = $this->resolveMasterForSlip($gov, $currentMaster);
            $bank = $this->resolveBankDetails($p, $master, $user);
            $unpaidLeaves = $gov
                ? (int) ($gov->unpaid_days ?? 0)
                : ($totalDays > 0 ? max(0, $totalDays - (int) $payDays) : 0);

            $generatedAt = $p->generated_at
                ? $p->generated_at->toIso8601String()
                : now()->toIso8601String();

            $leaveRemarks = $this->normalizeLeaveRemarks($gov?->leave_remarks ?? null);

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
                'bankName' => $bank['bank_name'],
                'bankAccountNumber' => $bank['bank_account_number'],
                'bankIfsc' => $bank['bank_ifsc'],
                'periodStart' => $periodStart,
                'periodEnd' => $periodEnd,
                'periodName' => $period?->period_name ?? '',
                'periodFormatted' => $periodFormatted,
                'periodMonth' => $periodMonth,
                'governmentMonthly' => $gov ? $this->formatGovernmentMonthlyForPayslip($gov) : null,
                'leaveRemarks' => $leaveRemarks,
                'leavePayslip' => null,
            ];
        })->values()->all();

        return [
            'company' => $this->formatCompany($company),
            'user' => $this->formatUser($user, $deptName, $currentMaster),
            'payslips' => $formatted,
        ];
    }

    /**
     * Salary-slip government snapshot; leave remarks are exposed separately as leaveRemarks.
     *
     * @return array<string, mixed>
     */
    private function formatGovernmentMonthlyForPayslip(HrmsGovernmentMonthlyPayroll $gov): array
    {
        $row = $gov->toArray();
        unset($row['leave_remarks'], $row['leaveRemarks']);

        return $row;
    }

    private function normalizeLeaveRemarks(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }
        $text = trim((string) $value);

        return $text === '' ? null : $text;
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

    private function formatUser(?HrmsUser $user, ?string $departmentName, ?HrmsPayrollMaster $master = null): ?array
    {
        if (! $user) {
            return null;
        }

        $cpfNo = $this->firstNonEmptyString($master?->cpf_no, $user->cpf_number, $user->pf_number);

        return [
            'id' => $user->id,
            'name' => $user->name ?? '',
            'employeeCode' => $user->employee_code ?? '',
            'designation' => $this->firstNonEmptyString($master?->designation, $user->designation),
            'department' => $this->firstNonEmptyString($master?->department, $departmentName),
            'departmentName' => $this->firstNonEmptyString($master?->department, $departmentName),
            'dateOfJoining' => $user->date_of_joining?->format('Y-m-d') ?? '',
            'aadhaar' => $this->firstNonEmptyString($master?->aadhaar, $user->aadhaar),
            'pan' => $this->firstNonEmptyString($master?->pan, $user->pan),
            'uanNumber' => $this->firstNonEmptyString($master?->uan, $user->uan_number),
            'pfNumber' => $cpfNo,
            'cpfNumber' => $cpfNo,
            'esicNumber' => $user->esic_number ?? '',
            'governmentPayLevel' => $user->government_pay_level,
        ];
    }

    private function currentMasterForEmployee(string $companyId, string $employeeUserId): ?HrmsPayrollMaster
    {
        return HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->where(function ($q) use ($employeeUserId) {
                $q->where('employee_user_id', $employeeUserId)
                    ->orWhere('user_id', $employeeUserId);
            })
            ->whereNull('effective_to')
            ->orderByDesc('effective_start_date')
            ->orderByDesc('effective_from')
            ->first();
    }

    private function resolveMasterForSlip(
        ?HrmsGovernmentMonthlyPayroll $gov,
        ?HrmsPayrollMaster $currentMaster,
    ): ?HrmsPayrollMaster {
        if ($gov?->payroll_master_id) {
            $fromSlip = $this->masterService->findMasterOrHistoryById($gov->payroll_master_id);
            if ($fromSlip) {
                return $fromSlip;
            }
        }

        return $currentMaster;
    }

    /**
     * @return array{bank_name: string, bank_account_number: string, bank_ifsc: string}
     */
    private function resolveBankDetails(
        HrmsPayslip $payslip,
        ?HrmsPayrollMaster $master,
        ?HrmsUser $user,
    ): array {
        return [
            'bank_name' => $this->firstNonEmptyString($payslip->bank_name, $master?->bank_name, $user?->bank_name),
            'bank_account_number' => $this->firstNonEmptyString(
                $payslip->bank_account_number,
                $master?->bank_account_number,
                $user?->bank_account_number,
            ),
            'bank_ifsc' => $this->firstNonEmptyString($payslip->bank_ifsc, $master?->bank_ifsc, $user?->bank_ifsc),
        ];
    }

    private function firstNonEmptyString(mixed ...$values): string
    {
        foreach ($values as $value) {
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return '';
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

    public function myPayrollHistory(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['history' => []]);
        }

        $limit = min(24, max(1, (int) $request->query('limit', 12)));
        $data = $this->buildPayslipsResponse((string) $user->company_id, $user->id);
        $history = array_slice($data['payslips'], 0, $limit);

        return response()->json([
            'history' => array_map(fn (array $slip) => $this->formatPayrollHistoryRow($slip), $history),
        ]);
    }

    public function myLatestPayroll(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['latest' => null]);
        }

        $data = $this->buildPayslipsResponse((string) $user->company_id, $user->id);
        $slips = $data['payslips'];
        if ($slips === []) {
            return response()->json(['latest' => null]);
        }

        return response()->json([
            'latest' => $this->formatLatestPayrollRow($slips[0]),
        ]);
    }

    public function myPayslipByPeriod(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['payslip' => null, 'company' => null, 'user' => null]);
        }

        $month = str_pad((string) ($request->query('month') ?? ''), 2, '0', STR_PAD_LEFT);
        $year = trim((string) ($request->query('year') ?? ''));
        if (! preg_match('/^\d{2}$/', $month) || ! preg_match('/^\d{4}$/', $year)) {
            return response()->json(['error' => 'Valid month and year are required.'], 422);
        }

        $periodKey = "{$year}-{$month}";
        $data = $this->buildPayslipsResponse((string) $user->company_id, $user->id);
        foreach ($data['payslips'] as $slip) {
            if (($slip['periodMonth'] ?? '') === $periodKey) {
                return response()->json([
                    'payslip' => $slip,
                    'company' => $data['company'],
                    'user' => $data['user'],
                ]);
            }
        }

        return response()->json([
            'payslip' => null,
            'company' => $data['company'],
            'user' => $data['user'],
        ]);
    }

    /** @param array<string, mixed> $slip */
    private function formatPayrollHistoryRow(array $slip): array
    {
        $periodMonth = (string) ($slip['periodMonth'] ?? '');
        [$year, $month] = array_pad(explode('-', $periodMonth), 2, '0');
        $amounts = $this->resolveSlipAmounts($slip);

        return [
            'id' => $slip['id'] ?? null,
            'month' => (int) $month,
            'year' => (int) $year,
            'periodMonth' => $periodMonth,
            'periodLabel' => $this->periodLabelFromKey($periodMonth),
            'grossEarnings' => $amounts['gross'],
            'deductions' => $amounts['deductions'],
            'netPay' => (float) ($slip['netPay'] ?? 0),
            'payDays' => (float) ($slip['payDays'] ?? 0),
            'workingDays' => $this->workingDaysFromSlip($slip),
            'status' => 'Paid',
            'generatedAt' => $slip['generatedAt'] ?? null,
        ];
    }

    /** @param array<string, mixed> $slip */
    private function formatLatestPayrollRow(array $slip): array
    {
        $row = $this->formatPayrollHistoryRow($slip);
        $row['periodFormatted'] = $slip['periodFormatted'] ?? $row['periodLabel'];

        return $row;
    }

    /** @param array<string, mixed> $slip */
    private function resolveSlipAmounts(array $slip): array
    {
        $gov = is_array($slip['governmentMonthly'] ?? null) ? $slip['governmentMonthly'] : null;
        if ($gov) {
            $gross = (float) ($gov['total_earnings'] ?? $gov['totalEarnings'] ?? $slip['grossPay'] ?? 0);
            $deductions = (float) ($gov['total_deductions'] ?? $gov['totalDeductions'] ?? $slip['deductions'] ?? 0);
        } else {
            $gross = (float) ($slip['grossPay'] ?? 0);
            $deductions = (float) ($slip['deductions'] ?? 0);
        }

        return ['gross' => $gross, 'deductions' => $deductions];
    }

    /** @param array<string, mixed> $slip */
    private function workingDaysFromSlip(array $slip): int
    {
        $start = (string) ($slip['periodStart'] ?? '');
        $end = (string) ($slip['periodEnd'] ?? '');
        if ($start === '' || $end === '') {
            return 0;
        }
        $startTs = strtotime($start);
        $endTs = strtotime($end);
        if ($startTs === false || $endTs === false) {
            return 0;
        }

        return (int) round(($endTs - $startTs) / 86400) + 1;
    }

    private function periodLabelFromKey(string $periodMonth): string
    {
        if (! preg_match('/^(\d{4})-(\d{2})$/', $periodMonth, $m)) {
            return $periodMonth;
        }
        $months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        $mi = (int) $m[2];

        return ($months[max(0, min(11, $mi - 1))] ?? $m[2]).' '.$m[1];
    }
}
