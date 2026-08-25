<?php

namespace App\Services;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsMonthlyPayrollAudit;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use App\Models\HrmsUser;
use InvalidArgumentException;
use RuntimeException;
use Illuminate\Support\Facades\DB;

/**
 * Controlled Admin amendment of already-generated monthly payroll.
 * Updates existing cirt_monthly_payroll rows; never inserts duplicates.
 */
class PayrollAmendmentService
{
    /** @var array<string, string> */
    public const FIELD_LABELS = [
        'paidDays' => 'Days',
        'unpaidDays' => 'Unpaid Days',
        'hplDays' => 'HPL Days',
        'eolDays' => 'EOL Days',
        'basicPaid' => 'Basic',
        'spPayPaid' => 'SP',
        'daPaid' => 'DA',
        'transportPaid' => 'Transport',
        'hraPaid' => 'HRA',
        'medicalPaid' => 'Medical',
        'extraWorkAllowancePaid' => 'EWA',
        'nightAllowancePaid' => 'Night Allowance',
        'uniformAllowancePaid' => 'Uniform',
        'educationAllowancePaid' => 'Education',
        'encashmentPaid' => 'Encashment',
        'encashmentDaPaid' => 'Encashment DA',
        'incomeTax' => 'Income Tax',
        'pt' => 'Professional Tax',
        'lic' => 'LIC',
        'cpf' => 'CPF',
        'daCpf' => 'DA CPF',
        'vpf' => 'VPF',
        'pfLoan' => 'PF Loan',
        'postOffice' => 'Post Office',
        'creditSociety' => 'Credit Society',
        'stdLicenceFee' => 'Std Licence Fee',
        'electricity' => 'Electricity',
        'water' => 'Water',
        'mess' => 'Mess',
        'loanRecovery' => 'Bank Recovery',
        'welfare' => 'Welfare',
        'hpl' => 'HPL',
        'eol' => 'EOL',
        'vehCharge' => 'Vehicle Charge',
        'quarterRent' => 'Quarter Rent',
        'other' => 'Other',
        'daArrear' => 'DA Arrear',
        'transportArrear' => 'Transport Arrear',
        'grossArrear' => 'Gross Arrear',
        'cpfArrear' => 'CPF Arrear',
        'netArrear' => 'Net Arrear',
        'customEarnings' => 'Custom Earnings',
        'customDeductions' => 'Custom Deductions',
        'totalEarnings' => 'Total Earnings',
        'totalDeductions' => 'Total Deductions',
        'netSalary' => 'Net Pay',
        'leaveRemarks' => 'Remarks',
    ];

    public static function normalizeReason(mixed $reason): string
    {
        if (! is_string($reason) && ! is_numeric($reason)) {
            return '';
        }

        return trim((string) $reason);
    }

    public static function assertReason(mixed $reason): string
    {
        $text = self::normalizeReason($reason);
        if ($text === '') {
            throw new InvalidArgumentException('A reason for the payroll amendment is required.');
        }
        if (mb_strlen($text) > 2000) {
            throw new InvalidArgumentException('Amendment reason must not exceed 2000 characters.');
        }

        return $text;
    }

    /** Preserve explicit 0; non-numeric becomes 0. */
    public static function amount(mixed $v): float
    {
        if ($v === true || $v === false) {
            return 0.0;
        }
        if (is_string($v)) {
            $v = trim($v);
        }
        if ($v === null || $v === '') {
            return 0.0;
        }
        $n = is_numeric($v) ? (float) $v : 0.0;

        return round(max(0, $n), 2);
    }

    /**
     * Canonical comparable snapshot of a generated monthly payroll row.
     *
     * @return array<string, mixed>
     */
    public function snapshotFromMonthly(HrmsGovernmentMonthlyPayroll $row): array
    {
        return [
            'id' => (string) $row->id,
            'payslipId' => $row->payslip_id ? (string) $row->payslip_id : null,
            'payrollPeriodId' => $row->payroll_period_id ? (string) $row->payroll_period_id : null,
            'employeeUserId' => (string) $row->employee_user_id,
            'paidDays' => self::amount($row->paid_days),
            'unpaidDays' => self::amount($row->unpaid_days),
            'hplDays' => (int) ($row->hpl_days ?? 0),
            'eolDays' => (int) ($row->eol_days ?? 0),
            'basicPaid' => self::amount($row->basic_paid),
            'spPayPaid' => self::amount($row->sp_pay_paid),
            'daPaid' => self::amount($row->da_paid),
            'transportPaid' => self::amount($row->transport_paid),
            'hraPaid' => self::amount($row->hra_paid),
            'medicalPaid' => self::amount($row->medical_paid),
            'extraWorkAllowancePaid' => self::amount($row->extra_work_allowance_paid),
            'nightAllowancePaid' => self::amount($row->night_allowance_paid),
            'uniformAllowancePaid' => self::amount($row->uniform_allowance_paid),
            'educationAllowancePaid' => self::amount($row->education_allowance_paid),
            'encashmentPaid' => self::amount($row->encashment_paid),
            'encashmentDaPaid' => self::amount($row->encashment_da_paid),
            'incomeTax' => self::amount($row->income_tax_amount),
            'pt' => self::amount($row->pt_amount),
            'lic' => self::amount($row->lic_amount),
            'cpf' => self::amount($row->cpf_amount),
            'daCpf' => self::amount($row->da_cpf_amount),
            'vpf' => self::amount($row->vpf_amount),
            'pfLoan' => self::amount($row->pf_loan_amount),
            'postOffice' => self::amount($row->post_office_amount),
            'creditSociety' => self::amount($row->credit_society_amount),
            'stdLicenceFee' => self::amount($row->std_licence_fee_amount),
            'electricity' => self::amount($row->electricity_amount),
            'water' => self::amount($row->water_amount),
            'mess' => self::amount($row->mess_amount),
            'loanRecovery' => self::amount($row->loan_recovery_amount),
            'welfare' => self::amount($row->welfare_amount),
            'hpl' => self::amount($row->hpl_amount),
            'eol' => self::amount($row->eol_amount),
            'vehCharge' => self::amount($row->veh_charge_amount),
            'quarterRent' => self::amount($row->quarter_rent_amount),
            'other' => self::amount($row->other_deduction_amount),
            'daArrear' => self::amount($row->da_arrears_paid),
            'transportArrear' => self::amount($row->transport_arrears_paid),
            'grossArrear' => self::amount($row->gross_arrear),
            'cpfArrear' => self::amount($row->cpf_arrear),
            'netArrear' => self::amount($row->net_arrear),
            'customEarnings' => $this->normalizeCustomMap($row->custom_earnings),
            'customDeductions' => $this->normalizeCustomMap($row->custom_deductions),
            'totalEarnings' => self::amount($row->total_earnings),
            'totalDeductions' => self::amount($row->total_deductions),
            'netSalary' => self::amount($row->net_salary),
            'leaveRemarks' => is_string($row->leave_remarks) ? $row->leave_remarks : null,
            'eolReferenceMonth' => $row->eol_reference_month !== null ? (int) $row->eol_reference_month : null,
            'eolReferenceYear' => $row->eol_reference_year !== null ? (int) $row->eol_reference_year : null,
            'hplReferenceMonth' => $row->hpl_reference_month !== null ? (int) $row->hpl_reference_month : null,
            'hplReferenceYear' => $row->hpl_reference_year !== null ? (int) $row->hpl_reference_year : null,
            'electricityUnitsConsumed' => self::amount($row->electricity_units_consumed),
            'nightHours' => self::amount($row->night_hours),
        ];
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return list<array{field: string, label: string, before: mixed, after: mixed}>
     */
    public function changedFields(array $before, array $after): array
    {
        $keys = array_values(array_unique([...array_keys($before), ...array_keys($after)]));
        $skip = ['id', 'payslipId', 'payrollPeriodId', 'employeeUserId'];
        $out = [];
        foreach ($keys as $key) {
            if (in_array($key, $skip, true)) {
                continue;
            }
            $a = $before[$key] ?? null;
            $b = $after[$key] ?? null;
            if ($this->valuesEqual($a, $b)) {
                continue;
            }
            $out[] = [
                'field' => $key,
                'label' => self::FIELD_LABELS[$key] ?? $key,
                'before' => $a,
                'after' => $b,
            ];
        }

        return $out;
    }

    /**
     * Apply validated preview values onto an existing monthly payroll + payslip.
     * Does not insert monthly payroll or payslip rows. Does not touch arrear line settlement.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return array{updated: int, audits: list<array<string, mixed>>, skipped: int}
     */
    public function amendGeneratedRows(
        HrmsUser $actor,
        string $reason,
        array $rows,
    ): array {
        $reason = self::assertReason($reason);
        if ($rows === []) {
            throw new InvalidArgumentException('At least one payroll row is required.');
        }

        $companyId = (string) $actor->company_id;
        $actorName = is_string($actor->name) ? $actor->name : null;

        return DB::transaction(function () use ($actor, $actorName, $companyId, $reason, $rows) {
            $updated = 0;
            $skipped = 0;
            $audits = [];

            foreach ($rows as $row) {
                if (! is_array($row)) {
                    throw new InvalidArgumentException('Each payroll row must be an object.');
                }

                $monthlyId = (string) ($row['monthly_payroll_id'] ?? $row['monthlyPayrollId'] ?? '');
                if ($monthlyId === '') {
                    throw new InvalidArgumentException('monthlyPayrollId is required for each amended row.');
                }

                /** @var HrmsGovernmentMonthlyPayroll|null $monthly */
                $monthly = HrmsGovernmentMonthlyPayroll::query()
                    ->where('id', $monthlyId)
                    ->where('company_id', $companyId)
                    ->lockForUpdate()
                    ->first();

                if (! $monthly) {
                    throw new InvalidArgumentException("Generated payroll row not found: {$monthlyId}");
                }

                if ($monthly->payroll_period_id) {
                    $period = HrmsPayrollPeriod::query()
                        ->where('id', $monthly->payroll_period_id)
                        ->where('company_id', $companyId)
                        ->lockForUpdate()
                        ->first();
                    if ($period && $period->is_locked) {
                        throw new RuntimeException(
                            'This payroll period is locked. Unlock the period before amending generated payroll.',
                        );
                    }
                }

                $before = $this->snapshotFromMonthly($monthly);
                $attrs = $this->monthlyAttributesFromPreview($monthly, $row);
                $monthly->fill($attrs);
                $after = $this->snapshotFromMonthly($monthly);
                $changed = $this->changedFields($before, $after);
                if ($changed === []) {
                    $skipped++;
                    continue;
                }

                $monthly->save();

                if ($monthly->payslip_id) {
                    $payslip = HrmsPayslip::query()
                        ->where('id', $monthly->payslip_id)
                        ->where('company_id', $companyId)
                        ->lockForUpdate()
                        ->first();
                    if ($payslip) {
                        $payslip->fill($this->payslipAttributesFromMonthly($monthly, $row));
                        $payslip->save();
                    }
                }

                $audit = HrmsMonthlyPayrollAudit::create([
                    'company_id' => $companyId,
                    'monthly_payroll_id' => $monthly->id,
                    'payroll_period_id' => $monthly->payroll_period_id,
                    'employee_user_id' => $monthly->employee_user_id,
                    'changed_by' => $actor->id,
                    'changed_by_name' => $actorName,
                    'change_reason' => $reason,
                    'before_payload' => $before,
                    'after_payload' => $after,
                    'changed_fields' => $changed,
                ]);

                $updated++;
                $audits[] = $this->formatAudit($audit);
            }

            if ($updated === 0) {
                throw new InvalidArgumentException('No payroll values were changed.');
            }

            return [
                'updated' => $updated,
                'skipped' => $skipped,
                'audits' => $audits,
            ];
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function historyForMonthly(string $companyId, string $monthlyPayrollId): array
    {
        return HrmsMonthlyPayrollAudit::query()
            ->where('company_id', $companyId)
            ->where('monthly_payroll_id', $monthlyPayrollId)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (HrmsMonthlyPayrollAudit $audit) => $this->formatAudit($audit))
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function formatAudit(HrmsMonthlyPayrollAudit $audit): array
    {
        return [
            'id' => $audit->id,
            'monthlyPayrollId' => $audit->monthly_payroll_id,
            'payrollPeriodId' => $audit->payroll_period_id,
            'employeeUserId' => $audit->employee_user_id,
            'changedBy' => $audit->changed_by,
            'changedByName' => $audit->changed_by_name,
            'changeReason' => $audit->change_reason,
            'beforePayload' => $audit->before_payload,
            'afterPayload' => $audit->after_payload,
            'changedFields' => $audit->changed_fields,
            'createdAt' => $audit->created_at?->toIso8601String(),
        ];
    }

    /**
     * Map a Run Payroll preview row onto existing monthly columns (UPDATE only).
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public function monthlyAttributesFromPreview(HrmsGovernmentMonthlyPayroll $existing, array $row): array
    {
        $gm = $row['government_monthly'] ?? $row['governmentMonthly'] ?? [];
        if (! is_array($gm)) {
            $gm = [];
        }
        $ded = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
        $daysInMonth = (int) ($existing->days_in_month ?? 30);
        $payDays = (int) round(self::amount(
            $row['pay_days'] ?? $row['payDays'] ?? $gm['paidDays'] ?? $existing->paid_days,
        ));
        $payDays = max(0, min($daysInMonth, $payDays));
        $unpaidDays = max(0, $daysInMonth - $payDays);

        $num = [self::class, 'amount'];

        return [
            'paid_days' => $payDays,
            'unpaid_days' => $unpaidDays,
            'basic_actual' => $num($gm['basicActual'] ?? $gm['basic_actual'] ?? $existing->basic_actual),
            'basic_paid' => $num($gm['basicPaid'] ?? $gm['basic_paid'] ?? $existing->basic_paid),
            'sp_pay_actual' => $num($gm['spPayActual'] ?? $gm['sp_pay_actual'] ?? $existing->sp_pay_actual),
            'sp_pay_paid' => $num($gm['spPayPaid'] ?? $gm['sp_pay_paid'] ?? $existing->sp_pay_paid),
            'da_actual' => $num($gm['daActual'] ?? $gm['da_actual'] ?? $existing->da_actual),
            'da_paid' => $num($gm['daPaid'] ?? $gm['da_paid'] ?? $existing->da_paid),
            'transport_actual' => $num($gm['transportActual'] ?? $gm['transport_actual'] ?? $existing->transport_actual),
            'transport_paid' => $num($gm['transportPaid'] ?? $gm['transport_paid'] ?? $existing->transport_paid),
            'hra_actual' => $num($gm['hraActual'] ?? $gm['hra_actual'] ?? $existing->hra_actual),
            'hra_paid' => $num($gm['hraPaid'] ?? $gm['hra_paid'] ?? $existing->hra_paid),
            'medical_actual' => $num($gm['medicalActual'] ?? $gm['medical_actual'] ?? $existing->medical_actual),
            'medical_paid' => $num($gm['medicalPaid'] ?? $gm['medical_paid'] ?? $existing->medical_paid),
            'extra_work_allowance_actual' => $num($gm['extraWorkAllowanceActual'] ?? $gm['extra_work_allowance_actual'] ?? $existing->extra_work_allowance_actual),
            'extra_work_allowance_paid' => $num($gm['extraWorkAllowancePaid'] ?? $gm['extra_work_allowance_paid'] ?? $existing->extra_work_allowance_paid),
            'night_allowance_actual' => $num($gm['nightAllowanceActual'] ?? $gm['night_allowance_actual'] ?? $existing->night_allowance_actual),
            'night_allowance_paid' => $num($gm['nightAllowancePaid'] ?? $gm['night_allowance_paid'] ?? $existing->night_allowance_paid),
            'uniform_allowance_actual' => $num($gm['uniformAllowanceActual'] ?? $gm['uniform_allowance_actual'] ?? $existing->uniform_allowance_actual),
            'uniform_allowance_paid' => $num($gm['uniformAllowancePaid'] ?? $gm['uniform_allowance_paid'] ?? $existing->uniform_allowance_paid),
            'education_allowance_actual' => $num($gm['educationAllowanceActual'] ?? $gm['education_allowance_actual'] ?? $existing->education_allowance_actual),
            'education_allowance_paid' => $num($gm['educationAllowancePaid'] ?? $gm['education_allowance_paid'] ?? $existing->education_allowance_paid),
            'da_arrears_actual' => $num($gm['daArrearsActual'] ?? $gm['da_arrears_actual'] ?? $row['daArrear'] ?? $existing->da_arrears_actual),
            'da_arrears_paid' => $num($gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? $row['daArrear'] ?? $existing->da_arrears_paid),
            'transport_arrears_actual' => $num($gm['transportArrearsActual'] ?? $gm['transport_arrears_actual'] ?? $row['transportArrear'] ?? $existing->transport_arrears_actual),
            'transport_arrears_paid' => $num($gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? $row['transportArrear'] ?? $existing->transport_arrears_paid),
            'encashment_actual' => $num($gm['encashmentActual'] ?? $gm['encashment_actual'] ?? $existing->encashment_actual),
            'encashment_paid' => $num($gm['encashmentPaid'] ?? $gm['encashment_paid'] ?? $existing->encashment_paid),
            'encashment_da_actual' => $num($gm['encashmentDaActual'] ?? $gm['encashment_da_actual'] ?? $existing->encashment_da_actual),
            'encashment_da_paid' => $num($gm['encashmentDaPaid'] ?? $gm['encashment_da_paid'] ?? $existing->encashment_da_paid),
            'income_tax_amount' => $num($ded['incomeTax'] ?? $ded['income_tax'] ?? $existing->income_tax_amount),
            'pt_amount' => $num($ded['pt'] ?? $existing->pt_amount),
            'lic_amount' => $num($ded['lic'] ?? $existing->lic_amount),
            'cpf_amount' => $num($ded['cpf'] ?? $existing->cpf_amount),
            'da_cpf_amount' => $num($ded['daCpf'] ?? $ded['da_cpf'] ?? $existing->da_cpf_amount),
            'vpf_amount' => $num($ded['vpf'] ?? $existing->vpf_amount),
            'pf_loan_amount' => $num($ded['pfLoan'] ?? $ded['pf_loan'] ?? $existing->pf_loan_amount),
            'post_office_amount' => $num($ded['postOffice'] ?? $ded['post_office'] ?? $existing->post_office_amount),
            'credit_society_amount' => $num($ded['creditSociety'] ?? $ded['credit_society'] ?? $existing->credit_society_amount),
            'std_licence_fee_amount' => $num($ded['stdLicenceFee'] ?? $ded['std_licence_fee'] ?? $existing->std_licence_fee_amount),
            'electricity_amount' => $num($ded['electricity'] ?? $existing->electricity_amount),
            'water_amount' => $num($ded['water'] ?? $existing->water_amount),
            'mess_amount' => $num($ded['mess'] ?? $existing->mess_amount),
            'loan_recovery_amount' => $num($ded['loanRecovery'] ?? $ded['loan_recovery'] ?? $existing->loan_recovery_amount),
            'welfare_amount' => $num($ded['welfare'] ?? $existing->welfare_amount),
            'hpl_amount' => $num($ded['hpl'] ?? $existing->hpl_amount),
            'hpl_days' => max(0, (int) ($gm['hplDays'] ?? $gm['hpl_days'] ?? $existing->hpl_days ?? 0)),
            'eol_amount' => $num($ded['eol'] ?? $existing->eol_amount),
            'eol_days' => max(0, (int) ($gm['eolDays'] ?? $gm['eol_days'] ?? $existing->eol_days ?? 0)),
            'leave_remarks' => $this->optionalString($gm['leaveRemarks'] ?? $gm['leave_remarks'] ?? $existing->leave_remarks),
            'eol_reference_month' => $this->optionalInt($gm['eolReferenceMonth'] ?? $gm['eol_reference_month'] ?? $existing->eol_reference_month),
            'eol_reference_year' => $this->optionalInt($gm['eolReferenceYear'] ?? $gm['eol_reference_year'] ?? $existing->eol_reference_year),
            'hpl_reference_month' => $this->optionalInt($gm['hplReferenceMonth'] ?? $gm['hpl_reference_month'] ?? $existing->hpl_reference_month),
            'hpl_reference_year' => $this->optionalInt($gm['hplReferenceYear'] ?? $gm['hpl_reference_year'] ?? $existing->hpl_reference_year),
            'eol_basis_amount' => $num($gm['eolBasisAmount'] ?? $gm['eol_basis_amount'] ?? $existing->eol_basis_amount),
            'hpl_basis_amount' => $num($gm['hplBasisAmount'] ?? $gm['hpl_basis_amount'] ?? $existing->hpl_basis_amount),
            'electricity_units_consumed' => $num($gm['electricityUnitsConsumed'] ?? $gm['electricity_units_consumed'] ?? $existing->electricity_units_consumed),
            'electricity_unit_rate' => $num($gm['electricityUnitRate'] ?? $gm['electricity_unit_rate'] ?? $existing->electricity_unit_rate),
            'night_hours' => $num($gm['nightHours'] ?? $gm['night_hours'] ?? $existing->night_hours),
            'night_allowance_rate' => $num($gm['nightAllowanceRate'] ?? $gm['night_allowance_rate'] ?? $existing->night_allowance_rate),
            'night_allowance_amount' => $num($gm['nightAllowanceAmount'] ?? $gm['night_allowance_amount'] ?? $gm['nightAllowancePaid'] ?? $existing->night_allowance_amount),
            'veh_charge_amount' => $num($ded['vehCharge'] ?? $ded['veh_charge'] ?? $existing->veh_charge_amount),
            'other_deduction_amount' => $num($ded['other'] ?? $existing->other_deduction_amount),
            'total_earnings' => $num($gm['totalEarnings'] ?? $gm['total_earnings'] ?? $row['grossPay'] ?? $row['gross_pay'] ?? $existing->total_earnings),
            'total_deductions' => $num($gm['totalDeductions'] ?? $gm['total_deductions'] ?? $row['deductions'] ?? $existing->total_deductions),
            'net_salary' => $num($gm['netSalary'] ?? $gm['net_salary'] ?? $row['netPay'] ?? $row['net_pay'] ?? $existing->net_salary),
            'gross_arrear' => $num($gm['grossArrear'] ?? $gm['gross_arrear'] ?? $row['grossArrear'] ?? $existing->gross_arrear),
            'cpf_arrear' => $num($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? $row['cpfArrear'] ?? $existing->cpf_arrear),
            'net_arrear' => $num($gm['netArrear'] ?? $gm['net_arrear'] ?? $row['netArrear'] ?? $existing->net_arrear),
            'custom_earnings' => $this->normalizeCustomMap($gm['customEarnings'] ?? $gm['custom_earnings'] ?? $existing->custom_earnings),
            'custom_deductions' => $this->normalizeCustomMap($gm['customDeductions'] ?? $gm['custom_deductions'] ?? $existing->custom_deductions),
            'quarter_rent_amount' => $num($ded['quarterRent'] ?? $ded['quarter_rent'] ?? $gm['quarterRent'] ?? $gm['quarter_rent'] ?? $existing->quarter_rent_amount),
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public function payslipAttributesFromMonthly(HrmsGovernmentMonthlyPayroll $monthly, array $row): array
    {
        $cpf = self::amount($monthly->cpf_amount)
            + self::amount($monthly->da_cpf_amount)
            + self::amount($monthly->vpf_amount)
            + self::amount($monthly->pf_loan_amount);

        return [
            'basic' => self::amount($monthly->basic_paid),
            'hra' => self::amount($monthly->hra_paid),
            'medical' => self::amount($monthly->medical_paid),
            'trans' => self::amount($monthly->transport_paid),
            'deductions' => self::amount($monthly->total_deductions),
            'gross_pay' => self::amount($monthly->total_earnings),
            'net_pay' => self::amount($monthly->net_salary),
            'pay_days' => self::amount($monthly->paid_days),
            'pf_employee' => $cpf,
            'professional_tax' => self::amount($monthly->pt_amount),
            'tds' => self::amount($monthly->income_tax_amount),
            'incentive' => self::amount($row['incentive'] ?? 0),
            'pr_bonus' => self::amount($row['pr_bonus'] ?? $row['prBonus'] ?? 0),
            'reimbursement' => self::amount($row['reimbursement'] ?? 0),
        ];
    }

    /**
     * @param  mixed  $raw
     * @return array<string, float>
     */
    public function normalizeCustomMap(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $key => $value) {
            if (! is_string($key) && ! is_int($key)) {
                continue;
            }
            $out[(string) $key] = self::amount($value);
        }

        return $out;
    }

    private function valuesEqual(mixed $a, mixed $b): bool
    {
        if (is_array($a) || is_array($b)) {
            return json_encode($this->normalizeComparable($a)) === json_encode($this->normalizeComparable($b));
        }
        if (is_numeric($a) && is_numeric($b)) {
            return abs((float) $a - (float) $b) < 0.005;
        }

        return $a === $b;
    }

    private function normalizeComparable(mixed $v): mixed
    {
        if (! is_array($v)) {
            return $v;
        }
        ksort($v);
        foreach ($v as $k => $item) {
            $v[$k] = $this->normalizeComparable($item);
        }

        return $v;
    }

    private function optionalString(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (! is_string($v) && ! is_numeric($v)) {
            return null;
        }
        $text = trim((string) $v);

        return $text === '' ? null : mb_substr($text, 0, 2000);
    }

    private function optionalInt(mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (! is_numeric($v)) {
            return null;
        }

        return (int) $v;
    }
}
