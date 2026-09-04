<?php

namespace App\Services;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use Illuminate\Support\Facades\Schema;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Separate from Payroll Master "Export Master".
 * Employee identity + master payroll fields + selected run months (max 3) + optional quarter filter (max 3).
 */
class EmployeePayrollExportService
{
    public function __construct(
        private readonly PayrollMasterService $masterService,
    ) {}

    /**
     * @param  list<string>  $periodIds
     * @param  list<string>  $quarterIds
     */
    public function export(string $companyId, array $periodIds, array $quarterIds = []): StreamedResponse
    {
        $periodIds = array_values(array_unique(array_filter($periodIds, static fn ($id) => is_string($id) && $id !== '')));
        $quarterIds = array_values(array_unique(array_filter($quarterIds, static fn ($id) => is_string($id) && $id !== '')));

        if ($periodIds === []) {
            abort(422, 'Select at least one payroll run month.');
        }
        if (count($periodIds) > 3) {
            abort(422, 'Select at most 3 payroll run months.');
        }
        if (count($quarterIds) > 3) {
            abort(422, 'Select at most 3 quarters.');
        }

        $periods = HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereIn('id', $periodIds)
            ->orderBy('period_start')
            ->get();

        if ($periods->count() !== count($periodIds)) {
            abort(422, 'One or more selected payroll periods were not found.');
        }

        $masters = $this->loadMasters($companyId, $quarterIds);
        $monthlyByUserPeriod = $this->loadMonthlyByUserAndPeriod($companyId, $periodIds);

        $headers = $this->buildHeaders($periods);
        $sheet = new Spreadsheet;
        $active = $sheet->getActiveSheet();
        $active->setTitle('Employee Payroll');
        $active->fromArray($headers, null, 'A1');
        $active->getStyle('A1:'.$this->colLetter(count($headers)).'1')->getFont()->setBold(true);

        $rowNum = 2;
        foreach ($masters as $master) {
            $active->fromArray(
                $this->buildDataRow($master, $periods, $monthlyByUserPeriod),
                null,
                'A'.$rowNum,
            );
            $rowNum++;
        }

        $filename = 'cirt_employee_payroll_export_'.date('Ymd_His').'.xlsx';

        return response()->streamDownload(function () use ($sheet) {
            (new Xlsx($sheet))->save('php://output');
        }, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /**
     * @param  list<string>  $quarterIds
     * @return list<array<string, mixed>>
     */
    private function loadMasters(string $companyId, array $quarterIds): array
    {
        $q = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->where(function ($w) {
                $w->whereNotNull('employee_user_id')->orWhereNotNull('user_id');
            });
        if ($quarterIds !== []) {
            $q->whereIn('quarter_id', $quarterIds);
        }
        $q->orderBy('employee_code')->orderBy('name');

        $rows = [];
        foreach ($q->get() as $master) {
            $rows[] = $this->masterService->formatRow($master);
        }

        return $rows;
    }

    /**
     * @param  list<string>  $periodIds
     * @return array<string, array<string, HrmsGovernmentMonthlyPayroll>>
     */
    private function loadMonthlyByUserAndPeriod(string $companyId, array $periodIds): array
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return [];
        }

        $map = [];
        $q = HrmsGovernmentMonthlyPayroll::query()
            ->whereIn('payroll_period_id', $periodIds);
        if (Schema::hasColumn('cirt_monthly_payroll', 'company_id')) {
            $q->where('company_id', $companyId);
        }
        $rows = $q->get();

        foreach ($rows as $row) {
            $uid = (string) ($row->employee_user_id ?? '');
            $pid = (string) ($row->payroll_period_id ?? '');
            if ($uid === '' || $pid === '') {
                continue;
            }
            $map[$uid][$pid] = $row;
        }

        return $map;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, HrmsPayrollPeriod>  $periods
     * @return list<string>
     */
    private function buildHeaders($periods): array
    {
        $headers = [
            'Employee Code',
            'Name',
            'Email',
            'Phone',
            'Designation',
            'Department',
            'Division',
            'Pay Level',
            'Status',
            'Date of Joining',
            'Date of Birth',
            'PAN',
            'Aadhaar',
            'UAN',
            'CPF No',
            'Bank Name',
            'Bank Account Number',
            'IFSC',
            'Gross Basic',
            'DA %',
            'DA Amount',
            'HRA %',
            'HRA Amount',
            'Medical',
            'Transport Total',
            'Total Earnings (Master)',
            'Income Tax',
            'Professional Tax',
            'LIC',
            'CPF',
            'DA CPF',
            'VPF',
            'PF Loan',
            'Post Office',
            'Credit Society',
            'Std Licence Fee',
            'Electricity',
            'Water',
            'Mess',
            'Loan Recovery',
            'Welfare',
            'Vehicle Charge',
            'Other Deduction',
            'Advance',
            'Take Home (Master)',
            'Quarter Assigned',
            'Quarter Name',
            'Quarter Type',
            'Quarter Rent',
            'Effective From',
        ];

        foreach ($periods as $period) {
            $label = $this->periodLabel($period);
            foreach ($this->runFieldLabels() as $fieldLabel) {
                $headers[] = $label.' - '.$fieldLabel;
            }
        }

        return $headers;
    }

    /** @return list<string> */
    private function runFieldLabels(): array
    {
        return [
            'Basic Paid',
            'DA Paid',
            'HRA Paid',
            'Transport Paid',
            'Medical Paid',
            'Night Allowance',
            'Total Earnings',
            'Income Tax',
            'PT',
            'CPF',
            'Electricity',
            'Electricity Units',
            'Water',
            'Mess',
            'Quarter Rent',
            'Total Deductions',
            'Net Salary',
        ];
    }

    /**
     * @param  array<string, mixed>  $master
     * @param  \Illuminate\Support\Collection<int, HrmsPayrollPeriod>  $periods
     * @param  array<string, array<string, HrmsGovernmentMonthlyPayroll>>  $monthlyByUserPeriod
     * @return list<string|int|float|null>
     */
    private function buildDataRow(array $master, $periods, array $monthlyByUserPeriod): array
    {
        $n = static fn ($v): float|int|string => is_numeric($v) ? (0 + $v) : ($v ?? '');
        $row = [
            $master['employeeCode'] ?? '',
            $master['name'] ?? '',
            $master['email'] ?? '',
            $master['phone'] ?? '',
            $master['designation'] ?? '',
            $master['department'] ?? '',
            $master['division'] ?? '',
            $master['payLevel'] ?? '',
            $master['status'] ?? '',
            $master['dateOfJoining'] ?? '',
            $master['dateOfBirth'] ?? '',
            $master['pan'] ?? '',
            $master['aadhaar'] ?? '',
            $master['uan'] ?? '',
            $master['cpfNo'] ?? '',
            $master['bankName'] ?? '',
            $master['bankAccountNumber'] ?? '',
            $master['bankIfsc'] ?? '',
            $n($master['grossBasicPay'] ?? 0),
            $n($master['daPercent'] ?? 0),
            $n($master['daAmount'] ?? 0),
            $n($master['hraPercent'] ?? 0),
            $n($master['hraAmount'] ?? 0),
            $n($master['medical'] ?? 0),
            $n($master['transportTotal'] ?? 0),
            $n($master['totalEarnings'] ?? 0),
            $n($master['incomeTax'] ?? 0),
            $n($master['professionalTax'] ?? 0),
            $n($master['lic'] ?? 0),
            $n($master['cpfDefault'] ?? $master['cpfEffective'] ?? 0),
            $n($master['daCpf'] ?? 0),
            $n($master['vpf'] ?? 0),
            $n($master['pfLoan'] ?? 0),
            $n($master['postOffice'] ?? 0),
            $n($master['creditSociety'] ?? 0),
            $n($master['standardLicenceFee'] ?? 0),
            $n($master['electricity'] ?? 0),
            $n($master['water'] ?? 0),
            $n($master['mess'] ?? 0),
            $n($master['loanRecovery'] ?? 0),
            $n($master['welfare'] ?? 0),
            $n($master['vehicleCharge'] ?? 0),
            $n($master['otherDeduction'] ?? 0),
            $n($master['advance'] ?? 0),
            $n($master['takeHome'] ?? 0),
            ! empty($master['quarterAssigned'] ?? $master['hasQuarter'] ?? false) ? 'Yes' : 'No',
            $master['quarterName'] ?? '',
            $master['quarterType'] ?? '',
            $n($master['quarterRent'] ?? 0),
            $master['effectiveFrom'] ?? '',
        ];

        $uid = (string) ($master['employeeUserId'] ?? $master['userId'] ?? '');
        foreach ($periods as $period) {
            $gov = $monthlyByUserPeriod[$uid][(string) $period->id] ?? null;
            $row = array_merge($row, $this->runValues($gov));
        }

        return $row;
    }

    /**
     * @return list<string|int|float>
     */
    private function runValues(?HrmsGovernmentMonthlyPayroll $gov): array
    {
        if (! $gov) {
            return array_fill(0, count($this->runFieldLabels()), '');
        }
        $n = static fn ($v): float => is_numeric($v) ? (float) $v : 0.0;

        return [
            $n($gov->basic_paid),
            $n($gov->da_paid),
            $n($gov->hra_paid),
            $n($gov->transport_paid),
            $n($gov->medical_paid),
            $n($gov->night_allowance_paid ?? $gov->night_allowance_amount ?? 0),
            $n($gov->total_earnings),
            $n($gov->income_tax_amount ?? 0),
            $n($gov->pt_amount ?? 0),
            $n($gov->cpf_amount ?? 0),
            $n($gov->electricity_amount ?? $gov->electricity_total ?? 0),
            $n($gov->electricity_units_consumed ?? 0),
            $n($gov->water_amount ?? 0),
            $n($gov->mess_amount ?? 0),
            $n($gov->quarter_rent_amount ?? 0),
            $n($gov->total_deductions),
            $n($gov->net_salary),
        ];
    }

    private function periodLabel(HrmsPayrollPeriod $period): string
    {
        $name = trim((string) ($period->period_name ?? ''));
        if ($name !== '') {
            return $name;
        }
        $start = $period->period_start;
        if ($start) {
            return $start->format('M Y');
        }

        return 'Period';
    }

    private function colLetter(int $index1Based): string
    {
        $index1Based = max(1, $index1Based);
        $letter = '';
        while ($index1Based > 0) {
            $index1Based--;
            $letter = chr(65 + ($index1Based % 26)).$letter;
            $index1Based = intdiv($index1Based, 26);
        }

        return $letter;
    }
}
