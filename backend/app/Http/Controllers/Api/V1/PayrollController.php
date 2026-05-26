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
        $targetUserId = $request->query('user_id') ?? $request->input('user_id');

        // If a specific user is requested, return their masters
        if ($targetUserId) {
            if ($targetUserId !== $user->id && ! $user->role?->isManagerial()) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $masters = HrmsPayrollMaster::where('employee_user_id', $targetUserId)
                ->orderBy('effective_start_date', 'desc')
                ->get();
            $current = $masters->first(fn ($m) => $m->effective_end_date === null || $m->effective_end_date >= now()->toDateString());
            return response()->json(['masters' => $masters, 'current' => $current]);
        }

        // For managers/admins: return all company payroll masters (current/active ones)
        if ($user->role?->isManagerial()) {
            $rawMasters = HrmsPayrollMaster::where('company_id', $user->company_id)
                ->whereNull('effective_end_date')
                ->orderBy('created_at', 'desc')
                ->get();

            $masters = $rawMasters->map(function ($m) {
                $empUser = HrmsUser::find($m->employee_user_id);
                return [
                    'employeeUserId' => $m->employee_user_id,
                    'employeeName' => $empUser?->name ?? '—',
                    'employeeEmail' => $empUser?->email ?? '—',
                    'governmentPayLevel' => $empUser?->government_pay_level,
                    'master' => [
                        'id' => $m->id,
                        'payrollMode' => $m->payroll_mode ?? 'government',
                        'grossBasic' => $m->gross_basic,
                        'grossSalary' => $m->gross_salary ?? $m->gross_basic,
                        'basic' => $m->basic,
                        'hra' => $m->hra,
                        'medical' => $m->medical,
                        'trans' => $m->trans,
                        'lta' => $m->lta,
                        'personal' => $m->personal,
                        'ctc' => $m->ctc,
                        'pfEligible' => $m->pf_eligible,
                        'esicEligible' => $m->esic_eligible,
                        'pfEmployee' => $m->pf_employee,
                        'pfEmployer' => $m->pf_employer,
                        'esicEmployee' => $m->esic_employee,
                        'esicEmployer' => $m->esic_employer,
                        'pt' => $m->pt ?? $m->pt_default,
                        'tds' => $m->tds,
                        'takeHome' => $m->take_home,
                        'advanceBonus' => $m->advance_bonus,
                        'effectiveStartDate' => $m->effective_start_date,
                        'effectiveEndDate' => $m->effective_end_date,
                        'daPercent' => $m->da_percent,
                        'hraPercent' => $m->hra_percent,
                        'medicalFixed' => $m->medical_fixed,
                        'transportDaPercent' => $m->transport_da_percent,
                        'transportSlabGroup' => $m->transport_slab_group,
                        'transportBase' => $m->transport_base,
                        'incomeTaxDefault' => $m->income_tax_default ?? $m->tds,
                        'ptDefault' => $m->pt_default,
                        'licDefault' => $m->lic_default,
                        'cpfDefault' => $m->cpf_default,
                        'daCpfDefault' => $m->da_cpf_default,
                        'vpfDefault' => $m->vpf_default,
                        'pfLoanDefault' => $m->pf_loan_default,
                        'postOfficeDefault' => $m->post_office_default,
                        'creditSocietyDefault' => $m->credit_society_default,
                        'stdLicenceFeeDefault' => $m->std_licence_fee_default,
                        'electricityDefault' => $m->electricity_default,
                        'waterDefault' => $m->water_default,
                        'messDefault' => $m->mess_default,
                        'horticultureDefault' => $m->horticulture_default,
                        'welfareDefault' => $m->welfare_default,
                        'vehChargeDefault' => $m->veh_charge_default,
                        'otherDeductionDefault' => $m->other_deduction_default,
                    ],
                ];
            });

            return response()->json(['masters' => $masters->values()]);
        }

        // For regular employees: return their own
        $masters = HrmsPayrollMaster::where('employee_user_id', $user->id)
            ->orderBy('effective_start_date', 'desc')
            ->get();
        $current = $masters->first(fn ($m) => $m->effective_end_date === null || $m->effective_end_date >= now()->toDateString());
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

    public function upsertMaster(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'employee_user_id' => ['required', 'uuid'],
            'effective_start_date' => ['nullable', 'date'],
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
            'payroll_mode' => ['nullable', 'in:private,government'],
            'gross_basic' => ['nullable', 'numeric'],
            'da_percent' => ['nullable', 'numeric'],
            'hra_percent' => ['nullable', 'numeric'],
            'medical_fixed' => ['nullable', 'numeric'],
            'transport_da_percent' => ['nullable', 'numeric'],
            'update_bank_only' => ['nullable', 'boolean'],
            'bank_name' => ['nullable', 'string'],
            'bank_account_number' => ['nullable', 'string'],
            'bank_ifsc' => ['nullable', 'string'],
        ]);

        $employeeUserId = $data['employee_user_id'];

        if (! empty($data['update_bank_only'])) {
            $empUser = HrmsUser::findOrFail($employeeUserId);
            $empUser->update([
                'bank_name' => $data['bank_name'] ?? $empUser->bank_name,
                'bank_account_number' => $data['bank_account_number'] ?? $empUser->bank_account_number,
                'bank_ifsc' => $data['bank_ifsc'] ?? $empUser->bank_ifsc,
            ]);
            return response()->json(['message' => 'Bank details updated', 'user' => $empUser->refresh()]);
        }

        $existing = HrmsPayrollMaster::where('employee_user_id', $employeeUserId)
            ->whereNull('effective_end_date')
            ->orderBy('effective_start_date', 'desc')
            ->first();

        unset($data['update_bank_only'], $data['bank_name'], $data['bank_account_number'], $data['bank_ifsc']);
        $data['company_id'] = $user->company_id;
        $data['created_by'] = $user->id;
        $data['effective_start_date'] = $data['effective_start_date'] ?? now()->toDateString();

        if ($existing) {
            $existing->update($data);
            return response()->json(['master' => $existing->refresh()]);
        }

        $master = HrmsPayrollMaster::create($data);

        return response()->json(['master' => $master], 201);
    }

    public function runPreview(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $year = (int) $request->query('year', now()->year);
        $month = (int) $request->query('month', now()->month);
        $runDay = (int) $request->query('runDay', now()->day);

        $periodStart = sprintf('%04d-%02d-01', $year, $month);
        $periodEnd = date('Y-m-t', strtotime($periodStart));

        // Get all active payroll masters for this company
        $masters = HrmsPayrollMaster::where('company_id', $user->company_id)
            ->where(function ($q) use ($periodEnd) {
                $q->whereNull('effective_end_date')
                  ->orWhere('effective_end_date', '>=', $periodEnd);
            })
            ->where('effective_start_date', '<=', $periodEnd)
            ->get();

        $daysInMonth = (int) date('t', strtotime($periodStart));

        $employees = [];
        foreach ($masters as $m) {
            $empUser = HrmsUser::find($m->employee_user_id);
            if (! $empUser || $empUser->employment_status?->value !== 'current') {
                continue;
            }

            $payrollMode = $m->payroll_mode ?? 'government';
            $grossBasic = (float) ($m->gross_basic ?? 0);
            $daPercent = (float) ($m->da_percent ?? 53);
            $hraPercent = (float) ($m->hra_percent ?? 30);
            $medicalFixed = (float) ($m->medical_fixed ?? 3000);
            $transportDaPercent = (float) ($m->transport_da_percent ?? 48.06);
            $tds = (float) ($m->tds ?? 0);
            $ptDefault = (float) ($m->pt_default ?? 200);
            $advanceBonus = (float) ($m->advance_bonus ?? 0);
            $payLevel = (int) ($empUser->government_pay_level ?? 5);

            $row = [
                'employeeUserId' => $m->employee_user_id,
                'employeeName' => $empUser->name,
                'employeeEmail' => $empUser->email,
                'payrollMode' => $payrollMode,
                'governmentPayLevel' => $payLevel,
                'payDays' => $daysInMonth,
                'rawPayDays' => $daysInMonth,
                'grossBasic' => $grossBasic,
                'grossSalary' => (float) ($m->gross_salary ?? $grossBasic),
                'daPercent' => $daPercent,
                'hraPercent' => $hraPercent,
                'medicalFixed' => $medicalFixed,
                'transportDaPercent' => $transportDaPercent,
                'tds' => $tds,
                'ptDefault' => $ptDefault,
                'advanceBonus' => $advanceBonus,
                'pfEligible' => (bool) $m->pf_eligible,
                'esicEligible' => (bool) $m->esic_eligible,
            ];

            if ($payrollMode === 'government') {
                $row['govRecalc'] = [
                    'grossBasic' => $grossBasic,
                    'daPercent' => $daPercent,
                    'hraPercent' => $hraPercent,
                    'medicalFixed' => $medicalFixed,
                    'transportDaPercent' => $transportDaPercent,
                    'payLevel' => $payLevel,
                    'deductionDefaults' => [
                        'incomeTax' => $tds,
                        'pt' => $ptDefault,
                        'lic' => (float) ($m->lic_default ?? 0),
                        'cpf' => (float) ($m->cpf_default ?? 0),
                        'daCpf' => (float) ($m->da_cpf_default ?? 0),
                        'vpf' => (float) ($m->vpf_default ?? 0),
                        'pfLoan' => (float) ($m->pf_loan_default ?? 0),
                        'postOffice' => (float) ($m->post_office_default ?? 0),
                        'creditSociety' => (float) ($m->credit_society_default ?? 0),
                        'stdLicenceFee' => (float) ($m->std_licence_fee_default ?? 0),
                        'electricity' => (float) ($m->electricity_default ?? 0),
                        'water' => (float) ($m->water_default ?? 0),
                        'mess' => (float) ($m->mess_default ?? 0),
                        'horticulture' => (float) ($m->horticulture_default ?? 0),
                        'welfare' => (float) ($m->welfare_default ?? 0),
                        'vehCharge' => (float) ($m->veh_charge_default ?? 0),
                        'other' => (float) ($m->other_deduction_default ?? 0),
                    ],
                ];
                $row['grossPay'] = 0;
                $row['netPay'] = 0;
                $row['pfEmployee'] = 0;
                $row['pfEmployer'] = 0;
                $row['esicEmployee'] = 0;
                $row['esicEmployer'] = 0;
                $row['profTax'] = $ptDefault;
                $row['deductions'] = 0;
                $row['takeHome'] = 0;
                $row['ctc'] = 0;
            } else {
                $gross = (float) ($m->gross_salary ?? 0);
                $row['grossPay'] = $gross;
                $row['netPay'] = $gross - $tds - $ptDefault;
                $row['pfEmployee'] = 0;
                $row['pfEmployer'] = 0;
                $row['esicEmployee'] = 0;
                $row['esicEmployer'] = 0;
                $row['profTax'] = $ptDefault;
                $row['deductions'] = $tds + $ptDefault;
                $row['takeHome'] = $gross - $tds - $ptDefault;
                $row['ctc'] = $gross;
                $row['basic'] = (float) ($m->basic ?? 0);
                $row['hra'] = (float) ($m->hra ?? 0);
                $row['medical'] = (float) ($m->medical ?? 0);
                $row['trans'] = (float) ($m->trans ?? 0);
                $row['lta'] = (float) ($m->lta ?? 0);
                $row['personal'] = (float) ($m->personal ?? 0);
            }

            $employees[] = $row;
        }

        return response()->json([
            'preview' => [
                'year' => $year,
                'month' => $month,
                'runDay' => min($runDay, $daysInMonth),
                'periodStart' => $periodStart,
                'periodEnd' => $periodEnd,
                'daysInMonth' => $daysInMonth,
                'workingDaysInFullMonth' => $daysInMonth,
                'effectiveRunDay' => min($runDay, $daysInMonth),
                'alreadyRun' => false,
                'payrollComplete' => false,
                'rows' => $employees,
            ],
        ]);
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
