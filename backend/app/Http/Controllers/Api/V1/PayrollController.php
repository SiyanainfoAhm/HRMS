<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsDepartment;
use App\Models\HrmsDivision;
use App\Models\HrmsEmployee;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Support\ApiPagination;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use App\Support\BankDetailsService;
use App\Support\BankDetailsValidator;
use App\Services\NightAllowanceRateService;
use App\Services\PayrollArrearService;
use App\Services\PayrollFieldService;
use App\Services\QuarterService;
use App\Services\PayrollMasterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollController extends Controller
{
    public function __construct(
        private readonly PayrollArrearService $arrearService,
        private readonly PayrollMasterService $masterService,
        private readonly PayrollFieldService $fieldService,
        private readonly QuarterService $quarterService,
        private readonly NightAllowanceRateService $nightAllowanceService,
    ) {}

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
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $period = HrmsPayrollPeriod::where('id', $id)
            ->where('company_id', $user->company_id)
            ->first();

        if (! $period) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $data = $request->validate([
            'period_name' => ['sometimes', 'string', 'max:255'],
            'period_start' => ['sometimes', 'date'],
            'period_end' => ['sometimes', 'date'],
            'is_locked' => ['sometimes', 'boolean'],
            'excel_file_path' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $period->update($data);

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
                        'transportDaPercent' => $m->da_percent ?? $m->transport_da_percent,
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
                        'loanRecoveryDefault' => $m->loan_recovery_default,
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

        $master = $this->masterService->createOrUpdatePayrollMasterRevision(
            $data,
            (string) $user->company_id,
            (string) $user->id,
        );

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
            ->where('company_id', $user->company_id)
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
        $data['effective_from'] = $data['effective_from'] ?? $data['effective_start_date'];

        $master = $this->masterService->createOrUpdatePayrollMasterRevision(
            $data,
            (string) $user->company_id,
            (string) $user->id,
            $existing,
        );

        return response()->json(['master' => $master->refresh()], $existing ? 200 : 201);
    }

    public function runPreview(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $year = (int) $request->query('year', 0);
        $month = (int) $request->query('month', 0);
        $runDay = (int) $request->query('runDay', 0);

        if ($year < 2000 || $month < 1 || $month > 12) {
            return response()->json(['error' => 'year and month query parameters are required'], 422);
        }

        $periodStart = sprintf('%04d-%02d-01', $year, $month);
        $periodEnd = date('Y-m-t', strtotime($periodStart));
        $daysInMonth = (int) date('t', strtotime($periodStart));
        $effectiveRunDay = $runDay < 1 || $runDay > $daysInMonth ? $daysInMonth : $runDay;
        $periodEndThroughRun = sprintf('%04d-%02d-%02d', $year, $month, $effectiveRunDay);

        $returnAll = $request->query('all') === '1' || $request->boolean('all');
        $page = ApiPagination::resolvePage($request->query('page'));
        $perPage = ApiPagination::resolvePerPage($request->query('per_page', $request->query('perPage')));
        $search = trim((string) $request->query('search', ''));
        $filterDepartment = trim((string) $request->query('department', ''));
        $filterDivision = trim((string) $request->query('division', ''));

        $existingPeriod = HrmsPayrollPeriod::where('company_id', $user->company_id)
            ->whereDate('period_start', $periodStart)
            ->first();

        $companyId = (string) $user->company_id;
        $employeeUserIds = $this->collectPayrollEmployeeUserIds($companyId);

        $usersById = HrmsUser::whereIn('id', $employeeUserIds)->get()->keyBy('id');
        $employeesByUserId = HrmsEmployee::whereIn('user_id', $employeeUserIds)
            ->with(['division', 'department'])
            ->get()
            ->keyBy('user_id');

        $companyDivisions = HrmsDivision::where('company_id', $companyId)
            ->where('is_active', true)
            ->get();
        $companyDepartments = HrmsDepartment::where('company_id', $companyId)
            ->where('is_active', true)
            ->get();
        $divisionsById = $companyDivisions->keyBy('id');
        $departmentsById = $companyDepartments->keyBy('id');
        $divisionsByNameLower = $companyDivisions->keyBy(
            fn (HrmsDivision $d) => strtolower(trim((string) $d->name)),
        );
        $departmentsByNameLower = $companyDepartments->keyBy(
            fn (HrmsDepartment $d) => strtolower(trim((string) $d->name)),
        );

        $ndaRatesPreloaded = $this->nightAllowanceService->listForCompany($companyId, true);
        $payrollConfig = $this->fieldService->getPayrollConfig($companyId);
        $customFieldsByMasterId = $this->fieldService->getCustomFieldValuesForMasters(
            $companyId,
            HrmsPayrollMaster::query()
                ->where('company_id', $companyId)
                ->whereNull('effective_to')
                ->pluck('id')
                ->all(),
        );

        $employees = [];
        foreach ($employeeUserIds as $employeeUserId) {
            $m = $this->resolveMasterForPayrollDate($companyId, $employeeUserId, $periodEnd)
                ?? $this->currentMasterForEmployee($companyId, $employeeUserId);
            if (! $m) {
                continue;
            }

            $empUser = $usersById->get($employeeUserId);
            if (! $empUser) {
                continue;
            }

            $empRecord = $employeesByUserId->get($employeeUserId);
            $dateOfJoining = $empUser->date_of_joining?->format('Y-m-d')
                ?? $empRecord?->date_of_joining?->format('Y-m-d')
                ?? $m->date_of_joining?->format('Y-m-d');
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

            if ($search !== '') {
                $term = mb_strtolower($search);
                $hay = mb_strtolower(implode(' ', array_filter([
                    (string) ($m->employee_code ?? ''),
                    (string) ($m->name ?? ''),
                    (string) ($m->email ?? ''),
                    (string) ($empUser->name ?? ''),
                ])));
                if (! str_contains($hay, $term)) {
                    continue;
                }
            }

            if ($filterDepartment !== '' && strcasecmp((string) ($m->department ?? ''), $filterDepartment) !== 0) {
                continue;
            }
            if ($filterDivision !== '' && strcasecmp((string) ($m->division ?? ''), $filterDivision) !== 0) {
                continue;
            }

            $payrollMode = $m->payroll_mode ?? 'government';
            $grossBasic = (float) ($m->gross_basic_pay ?? $m->gross_basic ?? 0);
            $daPercent = (float) ($m->da_percent ?? 53);
            $hraPercent = (float) ($m->hra_percent ?? 30);
            $medicalFixed = (float) ($m->medical_fixed ?? $m->medical ?? 3000);
            $tds = (float) ($m->income_tax ?? $m->tds ?? 0);
            $ptDefault = (float) ($m->professional_tax ?? $m->pt_default ?? $m->pt ?? 200);
            $advanceBonus = (float) ($m->advance ?? $m->advance_bonus ?? 0);
            $payLevel = (int) ($m->pay_level ?? $empUser->government_pay_level ?? 5);
            $org = $this->resolveEmployeeOrgFromSettings(
                $empUser,
                $empRecord,
                $m,
                $divisionsById,
                $departmentsById,
                $divisionsByNameLower,
                $departmentsByNameLower,
            );

            $row = [
                'employeeUserId' => $employeeUserId,
                'employeeName' => $empUser->name,
                'employeeEmail' => $empUser->email,
                'department' => $org['department'],
                'division' => $org['division'],
                'departmentId' => $org['departmentId'],
                'divisionId' => $org['divisionId'],
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
                'tds' => $tds,
                'ptDefault' => $ptDefault,
                'advanceBonus' => $advanceBonus,
                'pfEligible' => (bool) $m->pf_eligible,
                'esicEligible' => (bool) $m->esic_eligible,
            ];

            if ($payrollMode === 'government') {
                $quarterMeta = $this->quarterService->quarterMetaForMaster($m, (string) $user->company_id);
                $row = array_merge($row, $quarterMeta);
                $row['govRecalc'] = [
                    'grossBasic' => $grossBasic,
                    'daPercent' => $daPercent,
                    'hraPercent' => $hraPercent,
                    'medicalFixed' => $medicalFixed,
                    'payLevel' => $payLevel,
                    'hplDays' => 0,
                    'eolDays' => 0,
                    'leaveRemarks' => null,
                    'eolReferenceMonth' => $month,
                    'eolReferenceYear' => $year,
                    'hplReferenceMonth' => $month,
                    'hplReferenceYear' => $year,
                    'electricityUnitsConsumed' => 0,
                    'hasQuarter' => $quarterMeta['hasQuarter'],
                    'quarterRent' => $quarterMeta['quarterRent'],
                    'quarterId' => $quarterMeta['quarterId'],
                    'quarterName' => $quarterMeta['quarterName'],
                    'quarterType' => $quarterMeta['quarterType'],
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
                        'loanRecovery' => (float) ($m->loan_recovery_default ?? 0),
                        'welfare' => (float) ($m->welfare_default ?? 0),
                        'hpl' => 0,
                        'eol' => 0,
                        'vehCharge' => (float) ($m->veh_charge_default ?? 0),
                        'other' => (float) ($m->other_deduction_default ?? 0),
                        'quarterRent' => (float) ($quarterMeta['quarterRent'] ?? 0),
                    ],
                ];
                $customValues = $customFieldsByMasterId[$m->id] ?? [];
                $row['govRecalc']['customEarnings'] = $this->fieldService->customEarningsFromValues((string) $user->company_id, $customValues);
                $row['govRecalc']['customDeductions'] = $this->fieldService->customDeductionsFromValues((string) $user->company_id, $customValues);
                $cpfResolved = $this->fieldService->resolveCpfConfigForMaster((string) $user->company_id, $m);
                $row['govRecalc']['cpfConfig'] = [
                    'cpfPercentage' => $cpfResolved['cpf_percentage'],
                    'cpfBasisFieldKeys' => $cpfResolved['cpf_basis_field_keys'],
                    'cpfCalculationMode' => $cpfResolved['cpf_calculation_mode'] ?? 'percentage',
                    'cpfFixedAmount' => $cpfResolved['cpf_fixed_amount'] ?? 0,
                    'source' => $cpfResolved['source'],
                ];
                $nightResolved = $this->nightAllowanceService->resolveFromPreloadedRates(
                    $ndaRatesPreloaded,
                    $payLevel,
                    $periodEndThroughRun,
                );
                $row['govRecalc']['nightHours'] = 0;
                $row['govRecalc']['nightAllowanceRate'] = $nightResolved['rate'];
                $row['govRecalc']['nightAllowanceSlabNo'] = $nightResolved['slabNo'];
                $row['govRecalc']['nightAllowanceWarning'] = $nightResolved['warning'];
                $row['customFieldValues'] = $customValues;
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

        $totalEmployees = count($employees);
        if ($returnAll) {
            $employeesPage = $employees;
            $paginationMeta = ApiPagination::meta($totalEmployees, 1, max(1, $totalEmployees));
        } else {
            $employeesPage = array_slice($employees, ($page - 1) * $perPage, $perPage);
            $paginationMeta = ApiPagination::meta($totalEmployees, $page, $perPage);
        }

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

        if (! $existingPeriod || ! HrmsPayslip::where('payroll_period_id', $existingPeriod->id)->exists()) {
            $arrearEnriched = $this->enrichPreviewWithArrears(
                $employeesPage,
                (string) $user->company_id,
                $year,
                $month,
                $existingPeriod?->id,
                false,
            );

            return response()->json([
                'preview' => array_merge($previewBase, [
                    'alreadyRun' => false,
                    'existingPeriodId' => $existingPeriod?->id,
                    'payrollComplete' => true,
                    'missingPayslipCount' => 0,
                    'rows' => $arrearEnriched['rows'],
                    'meta' => $paginationMeta,
                    'arrearWarnings' => $arrearEnriched['warnings'],
                    'arrearPeriods' => $arrearEnriched['arrearPeriods'] ?? [],
                ]),
                'payrollConfig' => array_merge($payrollConfig, [
                    'nightAllowanceRates' => $ndaRatesPreloaded,
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

        $merged = [];

        foreach ($employees as $fr) {
            $uid = $fr['employeeUserId'];
            $slip = $payslips->get($uid);
            if ($slip) {
                $merged[] = array_merge(
                    $this->mapSavedPayslipToPreviewRow(
                        $slip,
                        $usersById->get($uid),
                        $govRows->get($uid),
                    ),
                    [
                        'department' => $fr['department'] ?? null,
                        'division' => $fr['division'] ?? null,
                        'departmentId' => $fr['departmentId'] ?? null,
                        'divisionId' => $fr['divisionId'] ?? null,
                    ],
                );
            } else {
                $merged[] = array_merge($fr, ['payslipPending' => true]);
            }
        }

        $missingPayslipCount = collect($merged)->where('payslipPending', true)->count();

        $mergedTotal = count($merged);
        if ($returnAll) {
            $mergedPage = $merged;
            $mergedMeta = ApiPagination::meta($mergedTotal, 1, max(1, $mergedTotal));
        } else {
            $mergedPage = array_slice($merged, ($page - 1) * $perPage, $perPage);
            $mergedMeta = ApiPagination::meta($mergedTotal, $page, $perPage);
        }

        $arrearEnriched = $this->enrichPreviewWithArrears(
            $mergedPage,
            (string) $user->company_id,
            $year,
            $month,
            $existingPeriod->id,
            true,
        );

        return response()->json([
            'preview' => array_merge($previewBase, [
                'periodName' => $existingPeriod->period_name ?? $periodNameDefault,
                'alreadyRun' => true,
                'existingPeriodId' => $existingPeriod->id,
                'payrollComplete' => $missingPayslipCount === 0,
                'missingPayslipCount' => $missingPayslipCount,
                'rows' => $arrearEnriched['rows'],
                'meta' => $mergedMeta,
                'arrearWarnings' => $arrearEnriched['warnings'],
                'arrearPeriods' => $arrearEnriched['arrearPeriods'] ?? [],
            ]),
            'payrollConfig' => array_merge($payrollConfig, [
                'nightAllowanceRates' => $ndaRatesPreloaded,
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
            if (! is_array($rows) || $rows === []) {
                return response()->json(['error' => 'rows are required (pending employee payroll data)'], 422);
            }

            $periodStart = sprintf('%04d-%02d-01', $year, $month);
            $existingPeriod = HrmsPayrollPeriod::where('company_id', $user->company_id)
                ->whereDate('period_start', $periodStart)
                ->first();

            if (! $existingPeriod) {
                return response()->json([
                    'error' => 'No payroll period found for this month. Run full payroll first.',
                ], 400);
            }

            if (! HrmsPayslip::where('payroll_period_id', $existingPeriod->id)->exists()) {
                return response()->json([
                    'error' => 'No payslips exist yet for this period. Run full payroll first.',
                ], 400);
            }

            return $this->executePayrollRun(
                $user,
                $existingPeriod,
                $rows,
                $year,
                $month,
                $runDay,
                true,
            );
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

        return $this->executePayrollRun(
            $user,
            $period,
            $rows,
            $year,
            $month,
            $runDay,
            false,
        );
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function executePayrollRun(
        HrmsUser $user,
        HrmsPayrollPeriod $period,
        array $rows,
        int $year,
        int $month,
        int $runDay,
        bool $completeMissing,
    ): JsonResponse {
        $periodStart = $period->period_start?->format('Y-m-d') ?? sprintf('%04d-%02d-01', $year, $month);
        $daysInMonth = (int) date('t', strtotime($periodStart));
        $effectiveRunDay = min(max(1, $runDay), $daysInMonth);
        $periodEnd = sprintf('%04d-%02d-%02d', $year, $month, $effectiveRunDay);

        $generated = 0;
        $createdByEmployeeId = $this->employeeRecordIdForUser($user->id, $user->company_id);
        $masterEmployeeIds = array_flip($this->collectPayrollEmployeeUserIds((string) $user->company_id));
        $monthlyPayrollIdsByEmployee = [];
        $arrearLineIdsByEmployee = [];
        $payrollConfig = $this->fieldService->getPayrollConfig((string) $user->company_id);
        $companyId = (string) $user->company_id;

        $normalizedRows = array_values(array_filter($rows, static fn ($row) => is_array($row)));
        usort($normalizedRows, static function (array $a, array $b): int {
            $aId = (string) ($a['employee_user_id'] ?? $a['employeeUserId'] ?? '');
            $bId = (string) ($b['employee_user_id'] ?? $b['employeeUserId'] ?? '');

            return strcmp($aId, $bId);
        });

        $employeeUserIds = array_values(array_unique(array_filter(array_map(
            static fn (array $row) => is_string($row['employee_user_id'] ?? $row['employeeUserId'] ?? null)
                ? ($row['employee_user_id'] ?? $row['employeeUserId'])
                : null,
            $normalizedRows,
        ))));

        $existingPayslipUserIds = HrmsPayslip::query()
            ->where('payroll_period_id', $period->id)
            ->whereIn('employee_user_id', $employeeUserIds)
            ->pluck('employee_user_id')
            ->flip()
            ->all();

        $usersById = HrmsUser::query()
            ->where('company_id', $user->company_id)
            ->whereIn('id', $employeeUserIds)
            ->get()
            ->keyBy('id');

        $mastersByUserId = HrmsPayrollMaster::query()
            ->where('company_id', $user->company_id)
            ->whereIn('employee_user_id', $employeeUserIds)
            ->whereNull('effective_to')
            ->orderByDesc('effective_start_date')
            ->get()
            ->unique('employee_user_id')
            ->keyBy('employee_user_id');

        $processRow = function (array $row) use (
            $user,
            $period,
            $year,
            $month,
            $daysInMonth,
            $periodEnd,
            $createdByEmployeeId,
            $masterEmployeeIds,
            $payrollConfig,
            $companyId,
            $existingPayslipUserIds,
            $usersById,
            $mastersByUserId,
            &$generated,
            &$monthlyPayrollIdsByEmployee,
            &$arrearLineIdsByEmployee,
        ): void {
            $employeeUserId = $row['employee_user_id'] ?? $row['employeeUserId'] ?? null;
            if (! is_string($employeeUserId) || $employeeUserId === '') {
                return;
            }

            $lineIds = $row['arrear_line_ids'] ?? $row['arrearLineIds'] ?? null;
            if (! is_array($lineIds) && is_array($row['arrear_lines'] ?? $row['arrearLines'] ?? null)) {
                $lineIds = array_values(array_filter(array_map(
                    static fn ($line) => is_array($line) ? ($line['id'] ?? null) : null,
                    $row['arrear_lines'] ?? $row['arrearLines'],
                )));
            }
            if (is_array($lineIds) && $lineIds !== []) {
                $arrearLineIdsByEmployee[$employeeUserId] = array_values(array_unique(array_filter(
                    array_map(static fn ($id) => is_string($id) ? $id : null, $lineIds),
                )));
            }

            if (! isset($masterEmployeeIds[$employeeUserId])) {
                return;
            }

            $empUser = $usersById->get($employeeUserId);
            if (! $empUser) {
                return;
            }

            if (isset($existingPayslipUserIds[$employeeUserId])) {
                return;
            }

            $payDays = (float) ($row['pay_days'] ?? $row['payDays'] ?? 0);
            $payrollMode = $row['payroll_mode'] ?? $row['payrollMode'] ?? 'private';
            $gm = $row['government_monthly'] ?? $row['governmentMonthly'] ?? null;
            if (is_array($gm)) {
                try {
                    $gm['leaveRemarks'] = $this->normalizeLeaveRemarks(
                        $row['leaveRemarks'] ?? $row['leave_remarks'] ?? $gm['leaveRemarks'] ?? $gm['leave_remarks'] ?? null,
                    );
                } catch (\InvalidArgumentException $e) {
                    abort(422, $e->getMessage());
                }
            }
            $subjectEmployeeId = $this->employeeRecordIdForUser($employeeUserId, $user->company_id);
            $master = $mastersByUserId->get($employeeUserId);
            $bank = $this->bankDetailsForPayslip($master, $empUser);

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
                    'bank_name' => $bank['bank_name'],
                    'bank_account_number' => $bank['bank_account_number'],
                    'bank_ifsc' => $bank['bank_ifsc'],
                    'generated_at' => now(),
                    'created_by' => $createdByEmployeeId,
                ]);

                $govMonthlyId = $this->insertGovernmentMonthlyFromPreview(
                    $companyId,
                    $period->id,
                    $employeeUserId,
                    $payslip->id,
                    $master?->id,
                    $year,
                    $month,
                    $daysInMonth,
                    (int) round($payDays),
                    $gm,
                    (int) ($master?->pay_level ?? $empUser->government_pay_level ?? 0),
                    (float) ($master?->da_percent ?? 53),
                    $periodEnd,
                    $payrollConfig,
                );
                if ($govMonthlyId) {
                    $monthlyPayrollIdsByEmployee[$employeeUserId] = $govMonthlyId;
                }
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
                    'bank_name' => $bank['bank_name'],
                    'bank_account_number' => $bank['bank_account_number'],
                    'bank_ifsc' => $bank['bank_ifsc'],
                    'generated_at' => now(),
                    'created_by' => $createdByEmployeeId,
                ]);
            }

            $generated++;
        };

        foreach (array_chunk($normalizedRows, 25) as $chunk) {
            DB::transaction(function () use ($chunk, $processRow): void {
                foreach ($chunk as $row) {
                    $processRow($row);
                }
            });
        }

        DB::transaction(function () use ($user, $period, $year, $month, &$monthlyPayrollIdsByEmployee, &$arrearLineIdsByEmployee): void {
            $this->arrearService->persistArrearLinesForPayrollConfirm(
                (string) $user->company_id,
                $year,
                $month,
                (string) $period->id,
            );

            $this->arrearService->markArrearLinesAsPaidForPayrollRun(
                $period,
                (string) $user->id,
                $monthlyPayrollIdsByEmployee,
                $arrearLineIdsByEmployee,
            );
        });

        if ($generated === 0) {
            return response()->json([
                'error' => $completeMissing
                    ? 'No missing payslips were created. All listed employees may already have payslips for this period.'
                    : 'No payslips were created. Check pay days, payroll master, and that payroll was not already run.',
            ], 400);
        }

        return response()->json([
            'ok' => true,
            'periodId' => $period->id,
            'periodName' => $period->period_name,
            'periodStart' => $period->period_start?->format('Y-m-d'),
            'periodEnd' => $period->period_end?->format('Y-m-d'),
            'payslipsGenerated' => $generated,
            'completeMissing' => $completeMissing,
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
                $master = $this->currentMasterForEmployee((string) $user->company_id, $slip['employee_user_id']);
                $bank = $this->bankDetailsForPayslip($master, $empUser);
                $slip['bank_name'] = $bank['bank_name'];
                $slip['bank_account_number'] = $bank['bank_account_number'];
                $slip['bank_ifsc'] = $bank['bank_ifsc'];
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

        $employeeUserIdsRaw = $request->input('employee_user_ids') ?? $request->input('employeeUserIds');
        $divisionIdFilter = trim((string) ($request->input('division_id') ?? $request->input('divisionId') ?? ''));
        $departmentIdFilter = trim((string) ($request->input('department_id') ?? $request->input('departmentId') ?? ''));
        $divisionFilter = trim((string) ($request->input('division') ?? ''));
        $departmentFilter = trim((string) ($request->input('department') ?? ''));

        if (is_string($employeeUserIdsRaw) && trim($employeeUserIdsRaw) !== '') {
            $allowedIds = collect(explode(',', $employeeUserIdsRaw))
                ->map(fn (string $id) => trim($id))
                ->filter()
                ->values();
            $payslips = $payslips->whereIn('employee_user_id', $allowedIds)->values();
        } elseif ($divisionIdFilter !== '' || $departmentIdFilter !== '' || $divisionFilter !== '' || $departmentFilter !== '') {
            $slipUserIds = $payslips->pluck('employee_user_id')->filter()->unique();
            $employeesByUserId = HrmsEmployee::whereIn('user_id', $slipUserIds)
                ->with(['division', 'department'])
                ->get()
                ->keyBy('user_id');
            $usersById = HrmsUser::whereIn('id', $slipUserIds)
                ->get(['id', 'division_id', 'department_id'])
                ->keyBy('id');

            $payslips = $payslips->filter(function (HrmsPayslip $slip) use (
                $employeesByUserId,
                $usersById,
                $divisionIdFilter,
                $departmentIdFilter,
                $divisionFilter,
                $departmentFilter,
            ) {
                $uid = (string) $slip->employee_user_id;
                $emp = $employeesByUserId->get($uid);
                $usr = $usersById->get($uid);
                $divId = $emp?->division_id ?? $usr?->division_id;
                $depId = $emp?->department_id ?? $usr?->department_id;

                if ($divisionIdFilter !== '' && (string) $divId !== $divisionIdFilter) {
                    return false;
                }
                if ($departmentIdFilter !== '' && (string) $depId !== $departmentIdFilter) {
                    return false;
                }
                if ($divisionFilter !== '' && $divisionIdFilter === '') {
                    $divName = $emp?->division?->name ?? '';
                    if (strcasecmp(trim((string) $divName), $divisionFilter) !== 0) {
                        return false;
                    }
                }
                if ($departmentFilter !== '' && $departmentIdFilter === '') {
                    $depName = $emp?->department?->name ?? '';
                    if (strcasecmp(trim((string) $depName), $departmentFilter) !== 0) {
                        return false;
                    }
                }

                return true;
            })->values();
        }

        if ($payslips->isEmpty()) {
            return response()->json(['error' => 'No payslips match the selected filters'], 404);
        }

        $userIds = $payslips->pluck('employee_user_id')->filter()->unique()->values();
        $users = HrmsUser::whereIn('id', $userIds)->get(['id', 'name', 'email']);

        $governmentMonthly = HrmsGovernmentMonthlyPayroll::where('payroll_period_id', $periodId)
            ->where('company_id', $user->company_id)
            ->whereIn('employee_user_id', $userIds)
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
            'payrollConfig' => array_merge(
                $this->fieldService->getPayrollConfig((string) $user->company_id),
                [
                    'nightAllowanceRates' => $this->nightAllowanceService->listForCompany((string) $user->company_id, true),
                ],
            ),
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
            'grossArrear' => $num($gov->gross_arrear ?? 0),
            'cpfArrear' => $num($gov->cpf_arrear ?? 0),
            'netArrear' => $num($gov->net_arrear ?? 0),
            'encashmentPaid' => $num($gov->encashment_paid),
            'encashmentDaPaid' => $num($gov->encashment_da_paid),
            'customEarnings' => $this->customFieldMapFromGov($gov, 'custom_earnings'),
            'customDeductions' => $this->customFieldMapFromGov($gov, 'custom_deductions'),
            'totalEarnings' => $num($gov->total_earnings),
            'totalDeductions' => $num($gov->total_deductions),
            'netSalary' => $num($gov->net_salary),
            'hplDays' => (int) ($gov->hpl_days ?? 0),
            'eolDays' => (int) ($gov->eol_days ?? 0),
            'hpl_days' => (int) ($gov->hpl_days ?? 0),
            'eol_days' => (int) ($gov->eol_days ?? 0),
            'leaveRemarks' => $this->normalizeLeaveRemarksSafe($gov->leave_remarks ?? null),
            'leave_remarks' => $this->normalizeLeaveRemarksSafe($gov->leave_remarks ?? null),
            'eolReferenceMonth' => $gov->eol_reference_month ? (int) $gov->eol_reference_month : null,
            'eolReferenceYear' => $gov->eol_reference_year ? (int) $gov->eol_reference_year : null,
            'hplReferenceMonth' => $gov->hpl_reference_month ? (int) $gov->hpl_reference_month : null,
            'hplReferenceYear' => $gov->hpl_reference_year ? (int) $gov->hpl_reference_year : null,
            'eolBasisAmount' => $num($gov->eol_basis_amount ?? 0),
            'hplBasisAmount' => $num($gov->hpl_basis_amount ?? 0),
            'electricityUnitsConsumed' => $num($gov->electricity_units_consumed ?? 0),
            'electricityUnitRate' => $num($gov->electricity_unit_rate ?? 0),
            'nightHours' => $num($gov->night_hours ?? 0),
            'nightAllowanceRate' => $num($gov->night_allowance_rate ?? 0),
            'nightAllowanceAmount' => $num($gov->night_allowance_amount ?? 0),
            'nightAllowanceSlabNo' => $gov->night_allowance_slab_no ? (int) $gov->night_allowance_slab_no : null,
            'nightAllowanceManualOverride' => (bool) ($gov->night_allowance_manual_override ?? false),
            'nightAllowanceBasicCeiling' => $num($gov->night_allowance_basic_ceiling ?? 0),
            'nightAllowanceEligible' => (bool) ($gov->night_allowance_eligible ?? true),
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
                'loanRecovery' => $num($gov->loan_recovery_amount),
                'welfare' => $num($gov->welfare_amount),
                'hpl' => $num($gov->hpl_amount ?? 0),
                'eol' => $num($gov->eol_amount ?? 0),
                'vehCharge' => $num($gov->veh_charge_amount),
                'other' => $num($gov->other_deduction_amount),
                'quarterRent' => $num($gov->quarter_rent_amount ?? 0),
            ],
        ];
    }

    /**
     * Normalize optional leave remarks for monthly payroll (not used in calculations).
     *
     * @throws \InvalidArgumentException
     */
    private function normalizeLeaveRemarks(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) && ! is_numeric($value)) {
            throw new \InvalidArgumentException('Remarks must be a string.');
        }
        $text = trim((string) $value);
        if ($text === '') {
            return null;
        }
        if (mb_strlen($text) > 2000) {
            throw new \InvalidArgumentException('Remarks must not exceed 2000 characters.');
        }

        return $text;
    }

    /** Read-path normalize: never throw on existing DB values. */
    private function normalizeLeaveRemarksSafe(mixed $value): ?string
    {
        try {
            return $this->normalizeLeaveRemarks($value);
        } catch (\InvalidArgumentException) {
            if (! is_string($value) && ! is_numeric($value)) {
                return null;
            }
            $text = trim((string) $value);

            return $text === '' ? null : mb_substr($text, 0, 2000);
        }
    }

    /** @return array<string, float> */
    private function customFieldMapFromGov(HrmsGovernmentMonthlyPayroll $gov, string $column): array
    {
        $raw = $gov->{$column} ?? null;
        if (! is_array($raw)) {
            return [];
        }

        $out = [];
        foreach ($raw as $key => $value) {
            if (! is_string($key) && ! is_int($key)) {
                continue;
            }
            $out[(string) $key] = is_numeric($value) ? (float) $value : 0.0;
        }

        return $out;
    }

    /** cirt_payslips.created_by references cirt_employees.id, not cirt_users.id. */
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
        float $daPercent,
        string $periodEnd,
        ?array $payrollConfig = null,
    ): ?string {
        if (! $masterId) {
            return null;
        }

        $ded = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
        $slab = is_array($gm['transportSlab'] ?? $gm['transport_slab'] ?? null)
            ? ($gm['transportSlab'] ?? $gm['transport_slab'])
            : [];
        $unpaidDays = max(0, $daysInMonth - $payDays);

        $num = static fn ($v): float => is_numeric($v) ? (float) $v : 0.0;

        $payrollConfig ??= $this->fieldService->getPayrollConfig($companyId);
        $nightCeiling = (float) (
            $payrollConfig['calculationSettings']['nightAllowanceBasicCeiling']
            ?? NightAllowanceRateService::DEFAULT_BASIC_CEILING
        );
        $this->nightAllowanceService->enforceCeilingOnGovernmentMonthly($gm, $nightCeiling);

        $record = HrmsGovernmentMonthlyPayroll::create([
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
            'transport_da_percent' => $daPercent,
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
            'loan_recovery_amount' => $num($ded['loanRecovery'] ?? $ded['loan_recovery'] ?? $ded['horticulture'] ?? 0),
            'welfare_amount' => $num($ded['welfare'] ?? 0),
            'hpl_amount' => $num($ded['hpl'] ?? 0),
            'hpl_days' => max(0, (int) ($gm['hplDays'] ?? $gm['hpl_days'] ?? 0)),
            'eol_amount' => $num($ded['eol'] ?? 0),
            'eol_days' => max(0, (int) ($gm['eolDays'] ?? $gm['eol_days'] ?? 0)),
            'leave_remarks' => $this->normalizeLeaveRemarksSafe(
                $gm['leaveRemarks'] ?? $gm['leave_remarks'] ?? null,
            ),
            'eol_reference_month' => isset($gm['eolReferenceMonth']) ? (int) $gm['eolReferenceMonth'] : null,
            'eol_reference_year' => isset($gm['eolReferenceYear']) ? (int) $gm['eolReferenceYear'] : null,
            'hpl_reference_month' => isset($gm['hplReferenceMonth']) ? (int) $gm['hplReferenceMonth'] : null,
            'hpl_reference_year' => isset($gm['hplReferenceYear']) ? (int) $gm['hplReferenceYear'] : null,
            'eol_basis_amount' => $num($gm['eolBasisAmount'] ?? $gm['eol_basis_amount'] ?? 0),
            'hpl_basis_amount' => $num($gm['hplBasisAmount'] ?? $gm['hpl_basis_amount'] ?? 0),
            'electricity_units_consumed' => $num($gm['electricityUnitsConsumed'] ?? $gm['electricity_units_consumed'] ?? 0),
            'electricity_unit_rate' => $num($gm['electricityUnitRate'] ?? $gm['electricity_unit_rate'] ?? 0),
            'electricity_manual_override' => (bool) ($gm['electricityManualOverride'] ?? $gm['electricity_manual_override'] ?? false),
            'night_hours' => $num($gm['nightHours'] ?? $gm['night_hours'] ?? 0),
            'night_allowance_rate' => $num($gm['nightAllowanceRate'] ?? $gm['night_allowance_rate'] ?? 0),
            'night_allowance_amount' => $num($gm['nightAllowanceAmount'] ?? $gm['night_allowance_amount'] ?? $gm['nightAllowancePaid'] ?? $gm['night_allowance_paid'] ?? 0),
            'night_allowance_slab_no' => isset($gm['nightAllowanceSlabNo']) || isset($gm['night_allowance_slab_no'])
                ? (int) ($gm['nightAllowanceSlabNo'] ?? $gm['night_allowance_slab_no'] ?? 0) ?: null
                : null,
            'night_allowance_manual_override' => (bool) ($gm['nightAllowanceManualOverride'] ?? $gm['night_allowance_manual_override'] ?? false),
            'night_allowance_basic_ceiling' => $num($gm['nightAllowanceBasicCeiling'] ?? $gm['night_allowance_basic_ceiling'] ?? $nightCeiling),
            'night_allowance_eligible' => (bool) ($gm['nightAllowanceEligible'] ?? $gm['night_allowance_eligible'] ?? true),
            'quarter_rent_manual_override' => (bool) ($gm['quarterRentManualOverride'] ?? $gm['quarter_rent_manual_override'] ?? false),
            'cpf_calculation_mode' => $gm['cpfCalculationMode'] ?? $gm['cpf_calculation_mode'] ?? null,
            'cpf_fixed_amount' => isset($gm['cpfFixedAmount']) || isset($gm['cpf_fixed_amount'])
                ? $num($gm['cpfFixedAmount'] ?? $gm['cpf_fixed_amount'] ?? 0)
                : null,
            'veh_charge_amount' => $num($ded['vehCharge'] ?? $ded['veh_charge'] ?? 0),
            'other_deduction_amount' => $num($ded['other'] ?? 0),
            'total_earnings' => $num($gm['totalEarnings'] ?? $gm['total_earnings'] ?? 0),
            'total_deductions' => $num($gm['totalDeductions'] ?? $gm['total_deductions'] ?? 0),
            'net_salary' => $num($gm['netSalary'] ?? $gm['net_salary'] ?? 0),
            'gross_arrear' => $num($gm['grossArrear'] ?? $gm['gross_arrear'] ?? 0),
            'cpf_arrear' => $num($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? ($gm['arrearDeductions']['cpfArrear'] ?? 0)),
            'net_arrear' => $num($gm['netArrear'] ?? $gm['net_arrear'] ?? 0),
            'arrear_batch_id' => $gm['arrearBatchId'] ?? $gm['arrear_batch_id'] ?? null,
            'custom_earnings' => $gm['customEarnings'] ?? $gm['custom_earnings'] ?? null,
            'custom_deductions' => $gm['customDeductions'] ?? $gm['custom_deductions'] ?? null,
            'quarter_rent_amount' => $num($ded['quarterRent'] ?? $ded['quarter_rent'] ?? 0),
            'has_quarter' => (bool) ($gm['hasQuarter'] ?? $gm['has_quarter'] ?? false),
            'quarter_id' => $gm['quarterId'] ?? $gm['quarter_id'] ?? null,
            'quarter_name' => $gm['quarterName'] ?? $gm['quarter_name'] ?? null,
            'quarter_type' => $gm['quarterType'] ?? $gm['quarter_type'] ?? null,
        ]);

        return (string) $record->id;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{rows: list<array<string, mixed>>, warnings: list<string>}
     */
    private function enrichPreviewWithArrears(
        array $rows,
        string $companyId,
        int $year,
        int $month,
        ?string $periodId,
        bool $alreadyRun,
    ): array {
        if ($alreadyRun) {
            return [
                'rows' => $this->mergeSavedArrearsIntoRows($rows, $periodId),
                'warnings' => [],
                'arrearPeriods' => [],
            ];
        }

        $result = $this->arrearService->previewArrearsForRun(
            $companyId,
            $year,
            $month,
        );

        $arrearPeriods = array_map(function (array $batch) {
            $from = $batch['arrear_from'] ?? null;
            $to = $batch['arrear_to'] ?? null;

            return [
                'revisionEventId' => $batch['revisionEventId'] ?? $batch['da_revision_event_id'] ?? null,
                'from' => $from instanceof \Carbon\Carbon ? $from->format('Y-m-d') : null,
                'to' => $to instanceof \Carbon\Carbon ? $to->format('Y-m-d') : null,
                'status' => $batch['status'] ?? 'preview',
                'monthCount' => ($from && $to)
                    ? $this->arrearService->countEligibleArrearMonths($from, $to)
                    : 0,
                'periodLabel' => ($from && $to)
                    ? $from->format('M Y').' to '.$to->format('M Y')
                    : null,
            ];
        }, $result['batches']);

        return [
            'rows' => $this->mergeArrearTotalsIntoRows($rows, $result['employeeTotals']),
            'warnings' => $result['warnings'],
            'arrearPeriods' => $arrearPeriods,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, array<string, mixed>>  $employeeTotals
     * @return list<array<string, mixed>>
     */
    private function mergeArrearTotalsIntoRows(array $rows, array $employeeTotals): array
    {
        return array_map(function (array $row) use ($employeeTotals) {
            $uid = (string) ($row['employeeUserId'] ?? '');
            $totals = $employeeTotals[$uid] ?? null;
            if (! $totals || ($row['payrollMode'] ?? '') !== 'government') {
                return $row;
            }

            return array_merge($row, [
                'daArrear' => round((float) $totals['daArrear'], 2),
                'transportArrear' => round((float) $totals['transportArrear'], 2),
                'grossArrear' => round((float) $totals['grossArrear'], 2),
                'cpfArrear' => round((float) $totals['cpfArrear'], 2),
                'netArrear' => round((float) $totals['netArrear'], 2),
                'arrearLines' => array_map(static fn (array $line): array => [
                    'id' => $line['id'] ?? null,
                    'arrearYear' => (int) ($line['arrear_year'] ?? 0),
                    'arrearMonth' => (int) ($line['arrear_month'] ?? 0),
                    'oldDaPercent' => (float) ($line['old_da_percent'] ?? 0),
                    'newDaPercent' => (float) ($line['new_da_percent'] ?? 0),
                    'grossArrear' => (float) ($line['gross_arrear'] ?? 0),
                    'revisionEventId' => $line['da_revision_event_id'] ?? null,
                ], is_array($totals['lines'] ?? null) ? $totals['lines'] : []),
                'arrearLineIds' => array_values(array_unique($totals['arrearLineIds'] ?? [])),
            ]);
        }, $rows);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function mergeSavedArrearsIntoRows(array $rows, ?string $periodId): array
    {
        if (! $periodId) {
            return $rows;
        }

        $govByUser = HrmsGovernmentMonthlyPayroll::query()
            ->where('payroll_period_id', $periodId)
            ->get()
            ->keyBy('employee_user_id');

        return array_map(function (array $row) use ($govByUser) {
            $gov = $govByUser->get($row['employeeUserId'] ?? '');
            if (! $gov) {
                return $row;
            }

            return array_merge($row, [
                'daArrear' => (float) ($gov->da_arrears_paid ?? 0),
                'transportArrear' => (float) ($gov->transport_arrears_paid ?? 0),
                'grossArrear' => (float) ($gov->gross_arrear ?? 0),
                'cpfArrear' => (float) ($gov->cpf_arrear ?? 0),
                'netArrear' => (float) ($gov->net_arrear ?? 0),
            ]);
        }, $rows);
    }

    /**
     * Employees on the current payroll master list (same scope as Payroll Master screen).
     *
     * @return list<string>
     */
    private function collectPayrollEmployeeUserIds(string $companyId): array
    {
        return HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->get()
            ->map(fn (HrmsPayrollMaster $m) => $m->employee_user_id ?? $m->user_id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Payroll master version that was effective on a calendar date (supports effective_from/to fallbacks).
     */
    private function resolveMasterForPayrollDate(string $companyId, string $employeeUserId, string $asOfDate): ?HrmsPayrollMaster
    {
        return $this->masterService->getPayrollMasterForDate($companyId, $employeeUserId, $asOfDate);
    }

    /** Current (open) payroll master row for an employee. */
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

    /**
     * @return array{bank_name: ?string, bank_account_number: ?string, bank_ifsc: ?string}
     */
    private function bankDetailsForPayslip(?HrmsPayrollMaster $master, HrmsUser $empUser): array
    {
        return [
            'bank_name' => $this->firstNonEmptyString($master?->bank_name, $empUser->bank_name),
            'bank_account_number' => $this->firstNonEmptyString(
                $master?->bank_account_number,
                $empUser->bank_account_number,
            ),
            'bank_ifsc' => $this->firstNonEmptyString($master?->bank_ifsc, $empUser->bank_ifsc),
        ];
    }

    private function firstNonEmptyString(mixed ...$values): ?string
    {
        foreach ($values as $value) {
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
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

    /**
     * @param  \Illuminate\Support\Collection<string, HrmsDivision>  $divisionsById
     * @param  \Illuminate\Support\Collection<string, HrmsDepartment>  $departmentsById
     * @param  \Illuminate\Support\Collection<string, HrmsDivision>  $divisionsByNameLower
     * @param  \Illuminate\Support\Collection<string, HrmsDepartment>  $departmentsByNameLower
     * @return array{divisionId: ?string, departmentId: ?string, division: ?string, department: ?string}
     */
    private function resolveEmployeeOrgFromSettings(
        ?HrmsUser $empUser,
        ?HrmsEmployee $empRecord,
        HrmsPayrollMaster $m,
        $divisionsById,
        $departmentsById,
        $divisionsByNameLower,
        $departmentsByNameLower,
    ): array {
        $divisionId = $empRecord?->division_id ?? $empUser?->division_id;
        $departmentId = $empRecord?->department_id ?? $empUser?->department_id;

        $divisionName = $empRecord?->relationLoaded('division') && $empRecord->division
            ? $empRecord->division->name
            : ($divisionId ? $divisionsById->get((string) $divisionId)?->name : null);
        $departmentName = $empRecord?->relationLoaded('department') && $empRecord->department
            ? $empRecord->department->name
            : ($departmentId ? $departmentsById->get((string) $departmentId)?->name : null);

        if (! $divisionId && $m->division) {
            $matched = $divisionsByNameLower->get(strtolower(trim((string) $m->division)));
            if ($matched) {
                $divisionId = (string) $matched->id;
                $divisionName = $matched->name;
            } elseif (! $divisionName) {
                $divisionName = trim((string) $m->division);
            }
        }

        if (! $departmentId && $m->department) {
            $matched = $departmentsByNameLower->get(strtolower(trim((string) $m->department)));
            if ($matched) {
                $departmentId = (string) $matched->id;
                $departmentName = $matched->name;
                if (! $divisionId && $matched->division_id) {
                    $divisionId = (string) $matched->division_id;
                    $divisionName = $divisionsById->get($divisionId)?->name ?? $divisionName;
                }
            } elseif (! $departmentName) {
                $departmentName = trim((string) $m->department);
            }
        }

        return [
            'divisionId' => $divisionId ? (string) $divisionId : null,
            'departmentId' => $departmentId ? (string) $departmentId : null,
            'division' => $divisionName ?: null,
            'department' => $departmentName ?: null,
        ];
    }

    /** Dev-only: list pending unpaid arrear lines for diagnostics. */
    public function debugUnpaidArrears(Request $request): JsonResponse
    {
        if (! config('app.debug')) {
            abort(404);
        }

        $companyId = $request->user()->company_id;
        $runYear = $request->query('year') !== null ? (int) $request->query('year') : null;
        $runMonth = $request->query('month') !== null ? (int) $request->query('month') : null;

        return response()->json([
            'companyId' => $companyId,
            'runYear' => $runYear,
            'runMonth' => $runMonth,
            'unpaid' => $this->arrearService->getUnpaidArrearsForPayroll($companyId, $runYear, $runMonth),
        ]);
    }

    public function referenceSalary(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'employee_user_id' => ['required', 'uuid'],
            'year' => ['required', 'integer', 'min:2000'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
        ]);

        $companyId = (string) $user->company_id;
        $employeeUserId = $validated['employee_user_id'];
        $year = (int) $validated['year'];
        $month = (int) $validated['month'];
        $daysInMonth = (int) date('t', mktime(0, 0, 0, $month, 1, $year));
        $monthYear = sprintf('%04d-%02d-01', $year, $month);

        $monthly = HrmsGovernmentMonthlyPayroll::query()
            ->where('company_id', $companyId)
            ->where('employee_user_id', $employeeUserId)
            ->where('month_year', $monthYear)
            ->first();

        if ($monthly) {
            return response()->json([
                'basic' => (float) $monthly->basic_actual,
                'da' => (float) $monthly->da_actual,
                'hra' => (float) $monthly->hra_actual,
                'medical' => (float) $monthly->medical_actual,
                'daysInMonth' => (int) ($monthly->days_in_month ?? $daysInMonth),
                'source' => 'monthly_payroll',
            ]);
        }

        $asOf = sprintf('%04d-%02d-%02d', $year, $month, min(28, $daysInMonth));
        $master = $this->resolveMasterForPayrollDate($companyId, $employeeUserId, $asOf)
            ?? $this->currentMasterForEmployee($companyId, $employeeUserId);

        if (! $master) {
            return response()->json(['error' => 'No payroll master for employee'], 404);
        }

        $gb = (float) ($master->gross_basic_pay ?? $master->gross_salary ?? 0);
        $daPct = (float) ($master->da_percent ?? 0);
        $hraPct = (float) ($master->hra_percent ?? 0);
        $med = (float) ($master->medical ?? 0);
        $hasQuarter = (bool) ($master->has_quarter ?? false);
        $hra = $hasQuarter ? 0.0 : round($gb * $hraPct / 100);
        $da = round($gb * $daPct / 100);

        return response()->json([
            'basic' => $gb,
            'da' => $da,
            'hra' => $hra,
            'medical' => $med,
            'daysInMonth' => $daysInMonth,
            'source' => 'payroll_master',
            'warning' => 'Reference payroll not found. Current payroll master values are being used.',
        ]);
    }
}
