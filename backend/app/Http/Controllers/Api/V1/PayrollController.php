<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsEmployee;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use App\Support\BankDetailsService;
use App\Support\BankDetailsValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollController extends Controller
{
    public function periods(Request $request): JsonResponse
    {
        $periods = HrmsPayrollPeriod::where('company_id', $request->user()->company_id)
            ->orderBy('period_start', 'desc')
            ->get();

        $runPeriodIds = HrmsPayslip::whereIn('payroll_period_id', $periods->pluck('id'))
            ->distinct()
            ->pluck('payroll_period_id')
            ->flip();

        $payload = $periods->map(function (HrmsPayrollPeriod $period) use ($runPeriodIds) {
            $row = $period->toArray();
            $row['payroll_run'] = $runPeriodIds->has($period->id);

            return $row;
        });

        return response()->json(['periods' => $payload]);
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
                    'bankName' => $empUser?->bank_name ?? '',
                    'bankAccountHolderName' => $empUser?->bank_account_holder_name ?? '',
                    'bankAccountNumber' => $empUser?->bank_account_number ?? '',
                    'bankIfsc' => $empUser?->bank_ifsc ?? '',
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
            'bank_account_holder_name' => ['nullable', 'string'],
            'bank_account_number' => ['nullable', 'string'],
            'bank_ifsc' => ['nullable', 'string'],
        ]);

        $employeeUserId = $data['employee_user_id'];

        if (! empty($data['update_bank_only'])) {
            $empUser = HrmsUser::findOrFail($employeeUserId);
            if ($empUser->company_id !== $user->company_id) {
                return response()->json(['error' => 'Forbidden'], 403);
            }
            $merged = [
                'bank_name' => $data['bank_name'] ?? $empUser->bank_name ?? '',
                'bank_account_holder_name' => $data['bank_account_holder_name'] ?? $empUser->bank_account_holder_name ?? '',
                'bank_account_number' => $data['bank_account_number'] ?? $empUser->bank_account_number ?? '',
                'bank_ifsc' => $data['bank_ifsc'] ?? $empUser->bank_ifsc ?? '',
            ];
            $normalized = BankDetailsValidator::normalizeAndValidate(
                $merged,
                $empUser->name,
                true,
            );
            BankDetailsService::applyToUser($empUser, $normalized, $user->id);

            return response()->json(['message' => 'Bank details updated', 'user' => $empUser->refresh()]);
        }

        $existing = HrmsPayrollMaster::where('employee_user_id', $employeeUserId)
            ->whereNull('effective_end_date')
            ->orderBy('effective_start_date', 'desc')
            ->first();

        unset(
            $data['update_bank_only'],
            $data['bank_name'],
            $data['bank_account_holder_name'],
            $data['bank_account_number'],
            $data['bank_ifsc'],
        );
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
        $effectiveRunDay = min(max(1, $runDay), $daysInMonth);

        $employees = [];
        foreach ($masters as $m) {
            $empUser = HrmsUser::find($m->employee_user_id);
            if (! $empUser || $empUser->employment_status?->value !== 'current') {
                continue;
            }

            $empRecord = HrmsEmployee::where('user_id', $empUser->id)->first();
            $dateOfJoining = $empUser->date_of_joining?->format('Y-m-d')
                ?? $empRecord?->date_of_joining?->format('Y-m-d');
            $dateOfLeaving = $empUser->date_of_leaving?->format('Y-m-d')
                ?? $empRecord?->date_of_leaving?->format('Y-m-d');

            $payCalc = $this->computePayDaysForPeriod(
                $dateOfJoining,
                $dateOfLeaving,
                $year,
                $month,
                $runDay,
                $daysInMonth,
            );
            if ($payCalc['exclude']) {
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
                'dateOfJoining' => $dateOfJoining,
                'payDays' => $payCalc['payDays'],
                'rawPayDays' => $payCalc['rawPayDays'],
                'unpaidLeaveDays' => $payCalc['unpaidLeaveDays'],
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

        $periodEndThroughRun = sprintf('%04d-%02d-%02d', $year, $month, $effectiveRunDay);
        $periodNameDefault = date('F Y', strtotime($periodStart)).' (through day '.$effectiveRunDay.')';

        $previewBase = [
            'year' => $year,
            'month' => $month,
            'runDay' => $effectiveRunDay,
            'periodStart' => $periodStart,
            'periodEnd' => $periodEndThroughRun,
            'periodName' => $periodNameDefault,
            'daysInMonth' => $daysInMonth,
            'workingDaysInFullMonth' => $daysInMonth,
            'workingDaysThroughRunDay' => $effectiveRunDay,
            'effectiveRunDay' => $effectiveRunDay,
        ];

        $existingPeriod = HrmsPayrollPeriod::where('company_id', $user->company_id)
            ->whereDate('period_start', $periodStart)
            ->first();

        if (! $existingPeriod || ! HrmsPayslip::where('payroll_period_id', $existingPeriod->id)->exists()) {
            return response()->json([
                'preview' => array_merge($previewBase, [
                    'alreadyRun' => false,
                    'existingPeriodId' => null,
                    'payrollComplete' => true,
                    'missingPayslipCount' => 0,
                    'rows' => $employees,
                ]),
            ]);
        }

        $payslips = HrmsPayslip::where('payroll_period_id', $existingPeriod->id)
            ->where('company_id', $user->company_id)
            ->get()
            ->keyBy('employee_user_id');

        $govRows = HrmsGovernmentMonthlyPayroll::where('payroll_period_id', $existingPeriod->id)
            ->where('company_id', $user->company_id)
            ->get()
            ->keyBy('employee_user_id');

        $slipUserIds = $payslips->keys()
            ->merge(collect($employees)->pluck('employeeUserId'))
            ->unique()
            ->filter();
        $usersById = HrmsUser::whereIn('id', $slipUserIds)->get()->keyBy('id');

        $freshByUser = collect($employees)->keyBy('employeeUserId');
        $merged = [];

        foreach ($employees as $fr) {
            $uid = $fr['employeeUserId'];
            $slip = $payslips->get($uid);
            if ($slip) {
                $merged[] = $this->mapSavedPayslipToPreviewRow(
                    $slip,
                    $usersById->get($uid),
                    $govRows->get($uid),
                );
            } else {
                $merged[] = array_merge($fr, ['payslipPending' => true]);
            }
        }

        foreach ($payslips as $uid => $slip) {
            if (! $freshByUser->has($uid)) {
                $merged[] = $this->mapSavedPayslipToPreviewRow(
                    $slip,
                    $usersById->get($uid),
                    $govRows->get($uid),
                );
            }
        }

        $missingPayslipCount = collect($merged)->where('payslipPending', true)->count();

        return response()->json([
            'preview' => array_merge($previewBase, [
                'periodName' => $existingPeriod->period_name ?? $periodNameDefault,
                'alreadyRun' => true,
                'existingPeriodId' => $existingPeriod->id,
                'payrollComplete' => $missingPayslipCount === 0,
                'missingPayslipCount' => $missingPayslipCount,
                'rows' => $merged,
            ]),
        ]);
    }

    public function run(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $body = $request->all();
        $year = (int) ($body['year'] ?? 0);
        $month = (int) ($body['month'] ?? 0);
        $runDay = (int) ($body['run_day'] ?? $body['runDay'] ?? 0);
        $rows = $body['rows'] ?? null;
        $completeMissing = filter_var(
            $body['complete_missing_payslips'] ?? $body['completeMissingPayslips'] ?? false,
            FILTER_VALIDATE_BOOLEAN,
        );

        if ($year < 2000 || $month < 1 || $month > 12 || $runDay < 1) {
            return response()->json(['error' => 'year, month, and runDay are required'], 422);
        }

        if ($completeMissing) {
            return response()->json([
                'error' => 'Adding missing payslips is not implemented on the API yet. Re-run with the full employee list.',
            ], 501);
        }

        if (! is_array($rows) || $rows === []) {
            return response()->json(['error' => 'rows are required (payroll preview data)'], 422);
        }

        $periodStart = sprintf('%04d-%02d-01', $year, $month);
        $daysInMonth = (int) date('t', strtotime($periodStart));
        $effectiveRunDay = min(max(1, $runDay), $daysInMonth);
        $periodEnd = sprintf('%04d-%02d-%02d', $year, $month, $effectiveRunDay);
        $periodName = date('F Y', strtotime($periodStart)).' (through day '.$effectiveRunDay.')';

        $existingPeriod = HrmsPayrollPeriod::where('company_id', $user->company_id)
            ->whereDate('period_start', $periodStart)
            ->first();

        if ($existingPeriod) {
            $hasSlips = HrmsPayslip::where('payroll_period_id', $existingPeriod->id)->exists();
            if ($hasSlips) {
                return response()->json([
                    'error' => 'Payroll has already been run for this calendar month.',
                ], 400);
            }
            $period = $existingPeriod;
            $period->update([
                'period_name' => $periodName,
                'period_end' => $periodEnd,
            ]);
        } else {
            $period = HrmsPayrollPeriod::create([
                'company_id' => $user->company_id,
                'period_name' => $periodName,
                'period_start' => $periodStart,
                'period_end' => $periodEnd,
                'is_locked' => false,
            ]);
        }

        $generated = 0;
        $createdByEmployeeId = $this->employeeRecordIdForUser($user->id, $user->company_id);

        DB::transaction(function () use ($user, $period, $rows, $year, $month, $daysInMonth, $periodEnd, $createdByEmployeeId, &$generated) {
            foreach ($rows as $row) {
                if (! is_array($row)) {
                    continue;
                }

                $employeeUserId = $row['employee_user_id'] ?? $row['employeeUserId'] ?? null;
                if (! is_string($employeeUserId) || $employeeUserId === '') {
                    continue;
                }

                $empUser = HrmsUser::where('id', $employeeUserId)
                    ->where('company_id', $user->company_id)
                    ->first();
                if (! $empUser || $empUser->role?->value === 'super_admin') {
                    continue;
                }

                if (HrmsPayslip::where('payroll_period_id', $period->id)
                    ->where('employee_user_id', $employeeUserId)
                    ->exists()) {
                    continue;
                }

                $payDays = (float) ($row['pay_days'] ?? $row['payDays'] ?? 0);
                $payrollMode = $row['payroll_mode'] ?? $row['payrollMode'] ?? 'private';
                $gm = $row['government_monthly'] ?? $row['governmentMonthly'] ?? null;
                $subjectEmployeeId = $this->employeeRecordIdForUser($employeeUserId, $user->company_id);

                if ($payrollMode === 'government' && is_array($gm)) {
                    $ded = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
                    $pfEmpGov = (float) ($row['pf_employee'] ?? $row['pfEmployee'] ?? 0);
                    if ($pfEmpGov <= 0) {
                        $pfEmpGov = (float) (($ded['cpf'] ?? 0) + ($ded['daCpf'] ?? $ded['da_cpf'] ?? 0)
                            + ($ded['vpf'] ?? 0) + ($ded['pfLoan'] ?? $ded['pf_loan'] ?? 0));
                    }

                    $payslip = HrmsPayslip::create([
                        'company_id' => $user->company_id,
                        'employee_id' => $subjectEmployeeId,
                        'employee_user_id' => $employeeUserId,
                        'payroll_period_id' => $period->id,
                        'payroll_mode' => 'government',
                        'basic' => (float) ($gm['basicPaid'] ?? $gm['basic_paid'] ?? 0),
                        'hra' => (float) ($gm['hraPaid'] ?? $gm['hra_paid'] ?? 0),
                        'medical' => (float) ($gm['medicalPaid'] ?? $gm['medical_paid'] ?? 0),
                        'trans' => (float) ($gm['transportPaid'] ?? $gm['transport_paid'] ?? 0),
                        'lta' => 0,
                        'personal' => 0,
                        'allowances' => 0,
                        'deductions' => (float) ($gm['totalDeductions'] ?? $gm['total_deductions'] ?? $row['deductions'] ?? 0),
                        'gross_pay' => (float) ($gm['totalEarnings'] ?? $gm['total_earnings'] ?? $row['grossPay'] ?? $row['gross_pay'] ?? 0),
                        'net_pay' => (float) ($row['takeHome'] ?? $row['take_home'] ?? $gm['netSalary'] ?? $gm['net_salary'] ?? $row['netPay'] ?? 0),
                        'pay_days' => $payDays,
                        'ctc' => (float) ($row['ctc'] ?? 0),
                        'pf_employee' => $pfEmpGov,
                        'pf_employer' => 0,
                        'esic_employee' => 0,
                        'esic_employer' => 0,
                        'professional_tax' => (float) ($ded['pt'] ?? $row['profTax'] ?? $row['prof_tax'] ?? 0),
                        'incentive' => (float) ($row['incentive'] ?? 0),
                        'pr_bonus' => (float) ($row['pr_bonus'] ?? $row['prBonus'] ?? 0),
                        'reimbursement' => (float) ($row['reimbursement'] ?? 0),
                        'tds' => (float) ($ded['incomeTax'] ?? $ded['income_tax'] ?? $row['tds'] ?? 0),
                        'bank_name' => $empUser->bank_name,
                        'bank_account_number' => $empUser->bank_account_number,
                        'bank_ifsc' => $empUser->bank_ifsc,
                        'generated_at' => now(),
                        'created_by' => $createdByEmployeeId,
                    ]);

                    $master = HrmsPayrollMaster::where('employee_user_id', $employeeUserId)
                        ->where('company_id', $user->company_id)
                        ->orderByDesc('effective_start_date')
                        ->first();

                    $this->insertGovernmentMonthlyFromPreview(
                        $user->company_id,
                        $period->id,
                        $employeeUserId,
                        $payslip->id,
                        $master?->id,
                        $year,
                        $month,
                        $daysInMonth,
                        (int) round($payDays),
                        $gm,
                        (int) ($empUser->government_pay_level ?? 0),
                        (float) ($master?->transport_da_percent ?? 48.06),
                        $periodEnd,
                    );
                } else {
                    HrmsPayslip::create([
                        'company_id' => $user->company_id,
                        'employee_id' => $subjectEmployeeId,
                        'employee_user_id' => $employeeUserId,
                        'payroll_period_id' => $period->id,
                        'payroll_mode' => $payrollMode,
                        'basic' => (float) ($row['basic'] ?? 0),
                        'hra' => (float) ($row['hra'] ?? 0),
                        'medical' => (float) ($row['medical'] ?? 0),
                        'trans' => (float) ($row['trans'] ?? 0),
                        'lta' => (float) ($row['lta'] ?? 0),
                        'personal' => (float) ($row['personal'] ?? 0),
                        'allowances' => (float) ($row['allowances'] ?? 0),
                        'deductions' => (float) ($row['deductions'] ?? 0),
                        'gross_pay' => (float) ($row['gross_pay'] ?? $row['grossPay'] ?? 0),
                        'net_pay' => (float) ($row['take_home'] ?? $row['takeHome'] ?? $row['net_pay'] ?? $row['netPay'] ?? 0),
                        'pay_days' => $payDays,
                        'ctc' => (float) ($row['ctc'] ?? 0),
                        'pf_employee' => (float) ($row['pf_employee'] ?? $row['pfEmployee'] ?? 0),
                        'pf_employer' => (float) ($row['pf_employer'] ?? $row['pfEmployer'] ?? 0),
                        'esic_employee' => (float) ($row['esic_employee'] ?? $row['esicEmployee'] ?? 0),
                        'esic_employer' => (float) ($row['esic_employer'] ?? $row['esicEmployer'] ?? 0),
                        'professional_tax' => (float) ($row['prof_tax'] ?? $row['profTax'] ?? 0),
                        'incentive' => (float) ($row['incentive'] ?? 0),
                        'pr_bonus' => (float) ($row['pr_bonus'] ?? $row['prBonus'] ?? 0),
                        'reimbursement' => (float) ($row['reimbursement'] ?? 0),
                        'tds' => (float) ($row['tds'] ?? 0),
                        'bank_name' => $empUser->bank_name,
                        'bank_account_number' => $empUser->bank_account_number,
                        'bank_ifsc' => $empUser->bank_ifsc,
                        'generated_at' => now(),
                        'created_by' => $createdByEmployeeId,
                    ]);
                }

                $generated++;
            }
        });

        if ($generated === 0) {
            return response()->json([
                'error' => 'No payslips were created. Check pay days, payroll master, and that payroll was not already run.',
            ], 400);
        }

        return response()->json([
            'ok' => true,
            'periodId' => $period->id,
            'periodName' => $period->period_name,
            'periodStart' => $period->period_start?->format('Y-m-d'),
            'periodEnd' => $period->period_end?->format('Y-m-d'),
            'payslipsGenerated' => $generated,
        ]);
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

        $createdByEmployeeId = $this->employeeRecordIdForUser($user->id, $user->company_id);
        $created = [];
        foreach ($data['payslips'] as $slip) {
            $slip['company_id'] = $user->company_id;
            $slip['generated_at'] = now();
            $slip['created_by'] = $createdByEmployeeId;

            $empUser = HrmsUser::find($slip['employee_user_id']);
            if ($empUser) {
                $slip['bank_name'] = $empUser->bank_name;
                $slip['bank_account_number'] = $empUser->bank_account_number;
                $slip['bank_ifsc'] = $empUser->bank_ifsc;
                $slip['employee_id'] = $this->employeeRecordIdForUser(
                    $slip['employee_user_id'],
                    $user->company_id,
                );
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

        $periodId = $request->input('period_id') ?? $request->input('periodId');
        if (! $periodId) {
            return response()->json(['error' => 'period_id required'], 422);
        }

        $period = HrmsPayrollPeriod::where('id', $periodId)
            ->where('company_id', $user->company_id)
            ->first();

        if (! $period) {
            return response()->json(['error' => 'Period not found'], 404);
        }

        $payslips = HrmsPayslip::where('payroll_period_id', $periodId)
            ->where('company_id', $user->company_id)
            ->get();

        if ($payslips->isEmpty()) {
            return response()->json(['error' => 'No payslips found for this period'], 404);
        }

        $userIds = $payslips->pluck('employee_user_id')->filter()->unique()->values();
        $users = HrmsUser::whereIn('id', $userIds)->get(['id', 'name', 'email']);

        $governmentMonthly = HrmsGovernmentMonthlyPayroll::where('payroll_period_id', $periodId)
            ->where('company_id', $user->company_id)
            ->get();

        return response()->json([
            'period' => [
                'id' => $period->id,
                'periodStart' => $period->period_start?->format('Y-m-d'),
                'periodName' => $period->period_name,
            ],
            'payslips' => $payslips,
            'users' => $users,
            'governmentMonthly' => $governmentMonthly,
        ]);
    }

    private function mapSavedPayslipToPreviewRow(
        HrmsPayslip $payslip,
        ?HrmsUser $user,
        ?HrmsGovernmentMonthlyPayroll $gov,
    ): array {
        $net = (float) ($payslip->net_pay ?? 0);
        $tds = (float) ($payslip->tds ?? 0);
        $inc = (float) ($payslip->incentive ?? 0);
        $bonus = (float) ($payslip->pr_bonus ?? 0);
        $reimb = (float) ($payslip->reimbursement ?? 0);
        $takeHome = $net - $tds + $inc + $bonus + $reimb;
        $isGov = ($payslip->payroll_mode ?? '') === 'government' || $gov !== null;

        return [
            'employeeUserId' => $payslip->employee_user_id,
            'employeeName' => $user?->name,
            'employeeEmail' => $user?->email ?? '',
            'payDays' => (int) ($payslip->pay_days ?? 0),
            'unpaidLeaveDays' => $gov ? (int) ($gov->unpaid_days ?? 0) : 0,
            'grossPay' => (int) round((float) ($payslip->gross_pay ?? 0)),
            'pfEmployee' => (int) round((float) ($payslip->pf_employee ?? 0)),
            'pfEmployer' => (int) round((float) ($payslip->pf_employer ?? 0)),
            'esicEmployee' => (int) round((float) ($payslip->esic_employee ?? 0)),
            'esicEmployer' => (int) round((float) ($payslip->esic_employer ?? 0)),
            'profTax' => (int) round((float) ($payslip->professional_tax ?? 0)),
            'deductions' => (int) round((float) ($payslip->deductions ?? 0)),
            'netPay' => (int) round($net),
            'incentive' => $inc,
            'prBonus' => $bonus,
            'reimbursement' => $reimb,
            'tds' => $tds,
            'takeHome' => (int) round($takeHome),
            'ctc' => (int) round((float) ($payslip->ctc ?? 0)),
            'payrollMode' => $isGov ? 'government' : 'private',
            'governmentMonthly' => $this->governmentMonthlyPreviewFromDb($gov),
            'payslipPending' => false,
        ];
    }

    /** @return array<string, mixed>|null */
    private function governmentMonthlyPreviewFromDb(?HrmsGovernmentMonthlyPayroll $gov): ?array
    {
        if (! $gov) {
            return null;
        }

        $num = static fn ($v): float => is_numeric($v) ? (float) $v : 0.0;

        return [
            'basicPaid' => $num($gov->basic_paid),
            'spPayPaid' => $num($gov->sp_pay_paid),
            'daPaid' => $num($gov->da_paid),
            'transportPaid' => $num($gov->transport_paid),
            'hraPaid' => $num($gov->hra_paid),
            'medicalPaid' => $num($gov->medical_paid),
            'extraWorkAllowancePaid' => $num($gov->extra_work_allowance_paid),
            'nightAllowancePaid' => $num($gov->night_allowance_paid),
            'uniformAllowancePaid' => $num($gov->uniform_allowance_paid),
            'educationAllowancePaid' => $num($gov->education_allowance_paid),
            'daArrearsPaid' => $num($gov->da_arrears_paid),
            'transportArrearsPaid' => $num($gov->transport_arrears_paid),
            'encashmentPaid' => $num($gov->encashment_paid),
            'encashmentDaPaid' => $num($gov->encashment_da_paid),
            'totalEarnings' => $num($gov->total_earnings),
            'totalDeductions' => $num($gov->total_deductions),
            'netSalary' => $num($gov->net_salary),
            'deductions' => [
                'incomeTax' => $num($gov->income_tax_amount),
                'pt' => $num($gov->pt_amount),
                'lic' => $num($gov->lic_amount),
                'cpf' => $num($gov->cpf_amount),
                'daCpf' => $num($gov->da_cpf_amount),
                'vpf' => $num($gov->vpf_amount),
                'pfLoan' => $num($gov->pf_loan_amount),
                'postOffice' => $num($gov->post_office_amount),
                'creditSociety' => $num($gov->credit_society_amount),
                'stdLicenceFee' => $num($gov->std_licence_fee_amount),
                'electricity' => $num($gov->electricity_amount),
                'water' => $num($gov->water_amount),
                'mess' => $num($gov->mess_amount),
                'horticulture' => $num($gov->horticulture_amount),
                'welfare' => $num($gov->welfare_amount),
                'vehCharge' => $num($gov->veh_charge_amount),
                'other' => $num($gov->other_deduction_amount),
            ],
        ];
    }

    /** HRMS_payslips.created_by references HRMS_employees.id, not HRMS_users.id. */
    private function employeeRecordIdForUser(string $userId, string $companyId): ?string
    {
        return HrmsEmployee::where('user_id', $userId)
            ->where('company_id', $companyId)
            ->value('id');
    }

    /**
     * @param  array<string, mixed>  $gm  governmentMonthly preview (camelCase from frontend)
     */
    private function insertGovernmentMonthlyFromPreview(
        string $companyId,
        string $periodId,
        string $employeeUserId,
        string $payslipId,
        ?string $masterId,
        int $year,
        int $month,
        int $daysInMonth,
        int $payDays,
        array $gm,
        int $payLevel,
        float $transportDaPercent,
        string $periodEnd,
    ): void {
        if (! $masterId) {
            return;
        }

        $ded = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
        $slab = is_array($gm['transportSlab'] ?? $gm['transport_slab'] ?? null)
            ? ($gm['transportSlab'] ?? $gm['transport_slab'])
            : [];
        $unpaidDays = max(0, $daysInMonth - $payDays);

        $num = static fn ($v): float => is_numeric($v) ? (float) $v : 0.0;

        HrmsGovernmentMonthlyPayroll::create([
            'company_id' => $companyId,
            'payroll_period_id' => $periodId,
            'payroll_master_id' => $masterId,
            'employee_user_id' => $employeeUserId,
            'payslip_id' => $payslipId,
            'month_year' => sprintf('%04d-%02d-01', $year, $month),
            'salary_date' => $periodEnd,
            'days_in_month' => $daysInMonth,
            'paid_days' => $payDays,
            'unpaid_days' => $unpaidDays,
            'pay_level' => $payLevel,
            'transport_slab_group' => $slab['transportSlabGroup'] ?? $slab['transport_slab_group'] ?? null,
            'transport_base' => $num($slab['transportBase'] ?? $slab['transport_base'] ?? 0),
            'transport_da_percent' => $transportDaPercent,
            'basic_actual' => $num($gm['basicActual'] ?? $gm['basic_actual'] ?? 0),
            'basic_paid' => $num($gm['basicPaid'] ?? $gm['basic_paid'] ?? 0),
            'sp_pay_actual' => $num($gm['spPayActual'] ?? $gm['sp_pay_actual'] ?? 0),
            'sp_pay_paid' => $num($gm['spPayPaid'] ?? $gm['sp_pay_paid'] ?? 0),
            'da_actual' => $num($gm['daActual'] ?? $gm['da_actual'] ?? 0),
            'da_paid' => $num($gm['daPaid'] ?? $gm['da_paid'] ?? 0),
            'transport_actual' => $num($gm['transportActual'] ?? $gm['transport_actual'] ?? 0),
            'transport_paid' => $num($gm['transportPaid'] ?? $gm['transport_paid'] ?? 0),
            'hra_actual' => $num($gm['hraActual'] ?? $gm['hra_actual'] ?? 0),
            'hra_paid' => $num($gm['hraPaid'] ?? $gm['hra_paid'] ?? 0),
            'medical_actual' => $num($gm['medicalActual'] ?? $gm['medical_actual'] ?? 0),
            'medical_paid' => $num($gm['medicalPaid'] ?? $gm['medical_paid'] ?? 0),
            'extra_work_allowance_actual' => $num($gm['extraWorkAllowanceActual'] ?? $gm['extra_work_allowance_actual'] ?? 0),
            'extra_work_allowance_paid' => $num($gm['extraWorkAllowancePaid'] ?? $gm['extra_work_allowance_paid'] ?? 0),
            'night_allowance_actual' => $num($gm['nightAllowanceActual'] ?? $gm['night_allowance_actual'] ?? 0),
            'night_allowance_paid' => $num($gm['nightAllowancePaid'] ?? $gm['night_allowance_paid'] ?? 0),
            'uniform_allowance_actual' => $num($gm['uniformAllowanceActual'] ?? $gm['uniform_allowance_actual'] ?? 0),
            'uniform_allowance_paid' => $num($gm['uniformAllowancePaid'] ?? $gm['uniform_allowance_paid'] ?? 0),
            'education_allowance_actual' => $num($gm['educationAllowanceActual'] ?? $gm['education_allowance_actual'] ?? 0),
            'education_allowance_paid' => $num($gm['educationAllowancePaid'] ?? $gm['education_allowance_paid'] ?? 0),
            'da_arrears_actual' => $num($gm['daArrearsActual'] ?? $gm['da_arrears_actual'] ?? 0),
            'da_arrears_paid' => $num($gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? 0),
            'transport_arrears_actual' => $num($gm['transportArrearsActual'] ?? $gm['transport_arrears_actual'] ?? 0),
            'transport_arrears_paid' => $num($gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? 0),
            'encashment_actual' => $num($gm['encashmentActual'] ?? $gm['encashment_actual'] ?? 0),
            'encashment_paid' => $num($gm['encashmentPaid'] ?? $gm['encashment_paid'] ?? 0),
            'encashment_da_actual' => $num($gm['encashmentDaActual'] ?? $gm['encashment_da_actual'] ?? 0),
            'encashment_da_paid' => $num($gm['encashmentDaPaid'] ?? $gm['encashment_da_paid'] ?? 0),
            'income_tax_amount' => $num($ded['incomeTax'] ?? $ded['income_tax'] ?? 0),
            'pt_amount' => $num($ded['pt'] ?? 0),
            'lic_amount' => $num($ded['lic'] ?? 0),
            'cpf_amount' => $num($ded['cpf'] ?? 0),
            'da_cpf_amount' => $num($ded['daCpf'] ?? $ded['da_cpf'] ?? 0),
            'vpf_amount' => $num($ded['vpf'] ?? 0),
            'pf_loan_amount' => $num($ded['pfLoan'] ?? $ded['pf_loan'] ?? 0),
            'post_office_amount' => $num($ded['postOffice'] ?? $ded['post_office'] ?? 0),
            'credit_society_amount' => $num($ded['creditSociety'] ?? $ded['credit_society'] ?? 0),
            'std_licence_fee_amount' => $num($ded['stdLicenceFee'] ?? $ded['std_licence_fee'] ?? 0),
            'electricity_amount' => $num($ded['electricity'] ?? 0),
            'water_amount' => $num($ded['water'] ?? 0),
            'mess_amount' => $num($ded['mess'] ?? 0),
            'horticulture_amount' => $num($ded['horticulture'] ?? 0),
            'welfare_amount' => $num($ded['welfare'] ?? 0),
            'veh_charge_amount' => $num($ded['vehCharge'] ?? $ded['veh_charge'] ?? 0),
            'other_deduction_amount' => $num($ded['other'] ?? 0),
            'total_earnings' => $num($gm['totalEarnings'] ?? $gm['total_earnings'] ?? 0),
            'total_deductions' => $num($gm['totalDeductions'] ?? $gm['total_deductions'] ?? 0),
            'net_salary' => $num($gm['netSalary'] ?? $gm['net_salary'] ?? 0),
        ]);
    }

    /**
     * Paid days = calendar days from join date (in-period) through run date (inclusive).
     * Example: joined on 26th, run date 27th → 2 paid days.
     *
     * @return array{payDays: int, rawPayDays: int, unpaidLeaveDays: int, effectiveRunDay: int, exclude: bool}
     */
    private function computePayDaysForPeriod(
        ?string $dateOfJoining,
        ?string $dateOfLeaving,
        int $year,
        int $month,
        int $runDay,
        int $daysInMonth,
    ): array {
        $effectiveRunDay = min(max(1, $runDay), $daysInMonth);
        $startDay = 1;
        $endDay = $effectiveRunDay;

        if ($dateOfJoining) {
            $joinTs = strtotime($dateOfJoining);
            $joinY = (int) date('Y', $joinTs);
            $joinM = (int) date('n', $joinTs);
            $joinD = (int) date('j', $joinTs);
            if ($joinY > $year || ($joinY === $year && $joinM > $month)) {
                return [
                    'payDays' => 0,
                    'rawPayDays' => 0,
                    'unpaidLeaveDays' => $daysInMonth,
                    'effectiveRunDay' => $effectiveRunDay,
                    'exclude' => true,
                ];
            }
            if ($joinY === $year && $joinM === $month) {
                $startDay = max(1, $joinD);
            }
        }

        if ($dateOfLeaving) {
            $leaveTs = strtotime($dateOfLeaving);
            $leaveY = (int) date('Y', $leaveTs);
            $leaveM = (int) date('n', $leaveTs);
            $leaveD = (int) date('j', $leaveTs);
            if ($leaveY < $year || ($leaveY === $year && $leaveM < $month)) {
                return [
                    'payDays' => 0,
                    'rawPayDays' => 0,
                    'unpaidLeaveDays' => $daysInMonth,
                    'effectiveRunDay' => $effectiveRunDay,
                    'exclude' => true,
                ];
            }
            if ($leaveY === $year && $leaveM === $month) {
                $endDay = min($endDay, $leaveD);
            }
        }

        $payDays = $startDay > $endDay ? 0 : ($endDay - $startDay + 1);

        return [
            'payDays' => $payDays,
            'rawPayDays' => $payDays,
            'unpaidLeaveDays' => max(0, $daysInMonth - $payDays),
            'effectiveRunDay' => $effectiveRunDay,
            'exclude' => false,
        ];
    }
}
