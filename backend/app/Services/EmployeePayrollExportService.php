<?php

namespace App\Services;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsQuarter;
use Illuminate\Support\Facades\Schema;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Separate from Payroll Master "Export Master".
 * Long / row-based employee payroll Excel: one row per employee × selected month.
 * Month-specific amounts come from generated cirt_monthly_payroll snapshots only.
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

        $mastersByUser = $this->loadMastersByUser($companyId);
        $monthlyByPeriod = $this->loadMonthlyByPeriod($companyId, $periodIds);
        $mastersById = $this->loadMastersByIdForMonthly($companyId, $monthlyByPeriod);
        $quartersById = $this->loadQuartersById($companyId);
        $customKeys = $this->collectCustomFieldKeys($monthlyByPeriod);

        $headers = $this->buildHeaders($customKeys);
        $amountColIndexes = $this->amountColumnIndexes($headers);

        $sheet = new Spreadsheet;
        $active = $sheet->getActiveSheet();
        $active->setTitle('Employee Payroll');
        $active->fromArray($headers, null, 'A1');
        $lastHeaderCol = $this->colLetter(count($headers));
        $active->getStyle('A1:'.$lastHeaderCol.'1')->getFont()->setBold(true);
        $active->freezePane('A2');

        $rowNum = 2;
        // Month first (periods already ordered by period_start), then employee code.
        foreach ($periods as $period) {
            $pid = (string) $period->id;
            $monthRows = $monthlyByPeriod[$pid] ?? [];
            usort($monthRows, function (HrmsGovernmentMonthlyPayroll $a, HrmsGovernmentMonthlyPayroll $b) use ($mastersByUser) {
                $codeA = $this->employeeCodeFor($a, $mastersByUser);
                $codeB = $this->employeeCodeFor($b, $mastersByUser);

                return strnatcasecmp($codeA, $codeB);
            });

            foreach ($monthRows as $gov) {
                $uid = (string) ($gov->employee_user_id ?? '');
                $master = $mastersByUser[$uid] ?? null;
                $quarterMeta = $this->resolveQuarterMeta($gov, $master, $mastersById, $quartersById);

                if ($quarterIds !== [] && ! $this->quarterMetaMatchesFilter($quarterMeta, $quarterIds)) {
                    continue;
                }

                $values = $this->buildDataRow($master, $period, $gov, $customKeys, $quarterMeta);

                foreach ($values as $colIndex0 => $value) {
                    $col = $colIndex0 + 1;
                    $coord = $this->colLetter($col).$rowNum;
                    if ($colIndex0 === 0) {
                        // Preserve leading zeroes on Employee Code (e.g. 001).
                        $active->setCellValueExplicit($coord, (string) $value, DataType::TYPE_STRING);
                    } elseif (in_array($colIndex0, $amountColIndexes, true) && $value !== '' && $value !== null && is_numeric($value)) {
                        $active->setCellValue($coord, 0 + $value);
                        $active->getStyle($coord)->getNumberFormat()->setFormatCode('#,##0.00');
                    } else {
                        $active->setCellValue($coord, $value);
                    }
                }
                $rowNum++;
            }
        }

        $lastDataRow = max(1, $rowNum - 1);
        $active->setAutoFilter('A1:'.$lastHeaderCol.$lastDataRow);
        foreach (range(1, count($headers)) as $i) {
            $active->getColumnDimension($this->colLetter($i))->setAutoSize(true);
        }

        $filename = 'cirt_employee_payroll_export_'.date('Ymd_His').'.xlsx';

        return response()->streamDownload(function () use ($sheet) {
            (new Xlsx($sheet))->save('php://output');
        }, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function loadMastersByUser(string $companyId): array
    {
        $q = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereNull('effective_to')
            ->where(function ($w) {
                $w->whereNotNull('employee_user_id')->orWhereNotNull('user_id');
            })
            ->orderBy('employee_code')
            ->orderBy('name');

        $map = [];
        foreach ($q->get() as $master) {
            $formatted = $this->masterService->formatRow($master);
            $uid = (string) ($formatted['employeeUserId'] ?? $formatted['userId'] ?? '');
            if ($uid === '') {
                continue;
            }
            $map[$uid] = $formatted;
        }

        return $map;
    }

    /**
     * @param  list<string>  $periodIds
     * @return array<string, list<HrmsGovernmentMonthlyPayroll>>
     */
    private function loadMonthlyByPeriod(string $companyId, array $periodIds): array
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return [];
        }

        $map = [];
        foreach ($periodIds as $pid) {
            $map[$pid] = [];
        }

        $q = HrmsGovernmentMonthlyPayroll::query()
            ->whereIn('payroll_period_id', $periodIds);
        if (Schema::hasColumn('cirt_monthly_payroll', 'company_id')) {
            $q->where('company_id', $companyId);
        }

        foreach ($q->get() as $row) {
            $pid = (string) ($row->payroll_period_id ?? '');
            if ($pid === '' || ! array_key_exists($pid, $map)) {
                continue;
            }
            $map[$pid][] = $row;
        }

        return $map;
    }

    /**
     * Masters linked from monthly.payroll_master_id (used when snapshot quarter name/type were not stored).
     *
     * @param  array<string, list<HrmsGovernmentMonthlyPayroll>>  $monthlyByPeriod
     * @return array<string, array{quarterId: ?string, hasQuarter: bool, quarterName: ?string, quarterType: ?string}>
     */
    private function loadMastersByIdForMonthly(string $companyId, array $monthlyByPeriod): array
    {
        $ids = [];
        foreach ($monthlyByPeriod as $rows) {
            foreach ($rows as $gov) {
                $mid = (string) ($gov->payroll_master_id ?? '');
                if ($mid !== '') {
                    $ids[$mid] = true;
                }
            }
        }
        if ($ids === []) {
            return [];
        }

        $map = [];
        $masters = HrmsPayrollMaster::query()
            ->where('company_id', $companyId)
            ->whereIn('id', array_keys($ids))
            ->get();
        foreach ($masters as $master) {
            $formatted = $this->masterService->formatRow($master);
            $map[(string) $master->id] = [
                'quarterId' => isset($formatted['quarterId']) ? (string) $formatted['quarterId'] : (string) ($master->quarter_id ?? ''),
                'hasQuarter' => (bool) ($formatted['hasQuarter'] ?? $formatted['quarterAssigned'] ?? $master->has_quarter ?? false),
                'quarterName' => $formatted['quarterName'] ?? null,
                'quarterType' => $formatted['quarterType'] ?? null,
            ];
            if ($map[(string) $master->id]['quarterId'] === '') {
                $map[(string) $master->id]['quarterId'] = null;
            }
        }

        return $map;
    }

    /**
     * @return array<string, array{name: string, type: string}>
     */
    private function loadQuartersById(string $companyId): array
    {
        if (! Schema::hasTable('cirt_quarters')) {
            return [];
        }

        $map = [];
        $q = HrmsQuarter::query()->where('company_id', $companyId);
        if (method_exists(HrmsQuarter::class, 'quarterType')) {
            $q->with('quarterType');
        }
        foreach ($q->get() as $quarter) {
            $type = '';
            if (isset($quarter->quarterType) && is_object($quarter->quarterType)) {
                $type = trim((string) ($quarter->quarterType->name ?? ''));
            }
            if ($type === '') {
                $type = trim((string) ($quarter->quarter_type ?? ''));
            }
            $map[(string) $quarter->id] = [
                'name' => trim((string) ($quarter->quarter_name ?? '')),
                'type' => $type,
            ];
        }

        return $map;
    }

    /**
     * Prefer snapshot quarter fields; if generation left name/type blank, resolve via quarter_id
     * or the payroll_master_id linked at run time (then current master as last resort when still assigned).
     *
     * @param  array<string, mixed>|null  $master
     * @param  array<string, array{quarterId: ?string, hasQuarter: bool, quarterName: ?string, quarterType: ?string}>  $mastersById
     * @param  array<string, array{name: string, type: string}>  $quartersById
     * @return array{assigned: bool, quarterId: ?string, name: string, type: string}
     */
    public function resolveQuarterMeta(
        HrmsGovernmentMonthlyPayroll $gov,
        ?array $master,
        array $mastersById = [],
        array $quartersById = [],
    ): array {
        $rent = is_numeric($gov->quarter_rent_amount ?? null) ? (float) $gov->quarter_rent_amount : 0.0;
        $assigned = ! empty($gov->has_quarter) || $rent > 0.0;

        $name = trim((string) ($gov->quarter_name ?? ''));
        $type = trim((string) ($gov->quarter_type ?? ''));
        $quarterId = trim((string) ($gov->quarter_id ?? ''));
        if ($quarterId === '') {
            $quarterId = null;
        }

        $fillFromQuarterId = function (?string $id) use (&$name, &$type, &$quarterId, $quartersById): void {
            if ($id === null || $id === '' || ! isset($quartersById[$id])) {
                return;
            }
            $quarterId = $id;
            if ($name === '') {
                $name = $quartersById[$id]['name'];
            }
            if ($type === '') {
                $type = $quartersById[$id]['type'];
            }
        };

        $fillFromQuarterId($quarterId);

        if ($assigned && ($name === '' || $type === '' || $quarterId === null)) {
            $linkedId = (string) ($gov->payroll_master_id ?? '');
            $linked = $linkedId !== '' ? ($mastersById[$linkedId] ?? null) : null;
            if ($linked && ! empty($linked['hasQuarter'])) {
                if ($name === '' && ! empty($linked['quarterName'])) {
                    $name = trim((string) $linked['quarterName']);
                }
                if ($type === '' && ! empty($linked['quarterType'])) {
                    $type = trim((string) $linked['quarterType']);
                }
                $fillFromQuarterId($linked['quarterId'] ?? null);
            }
        }

        // Last resort: current master quarter meta when this month still shows quarter assigned/rent.
        if ($assigned && ($name === '' || $type === '') && is_array($master)) {
            if (! empty($master['hasQuarter']) || ! empty($master['quarterAssigned']) || ! empty($master['quarterId'])) {
                if ($name === '' && ! empty($master['quarterName'])) {
                    $name = trim((string) $master['quarterName']);
                }
                if ($type === '' && ! empty($master['quarterType'])) {
                    $type = trim((string) $master['quarterType']);
                }
                $fillFromQuarterId(isset($master['quarterId']) ? (string) $master['quarterId'] : null);
            }
        }

        return [
            'assigned' => $assigned,
            'quarterId' => $quarterId,
            'name' => $name,
            'type' => $type,
        ];
    }

    /**
     * @param  array<string, list<HrmsGovernmentMonthlyPayroll>>  $monthlyByPeriod
     * @return array{earnings: list<string>, deductions: list<string>}
     */
    private function collectCustomFieldKeys(array $monthlyByPeriod): array
    {
        $earnings = [];
        $deductions = [];
        foreach ($monthlyByPeriod as $rows) {
            foreach ($rows as $gov) {
                foreach (array_keys($this->normalizeCustomMap($gov->custom_earnings)) as $key) {
                    $earnings[$key] = true;
                }
                foreach (array_keys($this->normalizeCustomMap($gov->custom_deductions)) as $key) {
                    $deductions[$key] = true;
                }
            }
        }
        $earnKeys = array_keys($earnings);
        $dedKeys = array_keys($deductions);
        natcasesort($earnKeys);
        natcasesort($dedKeys);

        return [
            'earnings' => array_values($earnKeys),
            'deductions' => array_values($dedKeys),
        ];
    }

    /**
     * @param  array{earnings: list<string>, deductions: list<string>}  $customKeys
     * @return list<string>
     */
    public function buildHeaders(array $customKeys = ['earnings' => [], 'deductions' => []]): array
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
            'Month',
            'Through Day',
            'Quarter Assigned',
            'Quarter Name',
            'Quarter Type',
            'Basic Paid',
            'DA Paid',
            'HRA Paid',
            'Transport Paid',
            'Medical Paid',
            'Night Allowance',
        ];

        foreach ($customKeys['earnings'] as $key) {
            $headers[] = $this->customHeaderLabel($key);
        }

        $headers = array_merge($headers, [
            'Total Earnings',
            'Income Tax',
            'Professional Tax',
            'LIC',
            'CPF',
            'DA CPF',
            'VPF',
            'PF Loan',
            'Post Office',
            'Credit Society',
            'Standard Licence Fee',
            'Electricity',
            'Electricity Units',
            'Water',
            'Mess',
            'Bank / Loan Recovery',
            'Welfare',
            'HPL',
            'EOL',
            'Vehicle Charge',
            'Quarter Rent',
            'Other Deduction',
        ]);

        foreach ($customKeys['deductions'] as $key) {
            $headers[] = $this->customHeaderLabel($key);
        }

        return array_merge($headers, [
            'Total Deductions',
            'DA Arrear',
            'Transport Arrear',
            'Gross Arrear',
            'CPF Arrear',
            'Net Arrear',
            'Net Salary',
        ]);
    }

    /**
     * @param  list<string>  $headers
     * @return list<int> zero-based indexes of numeric payroll amount columns
     */
    private function amountColumnIndexes(array $headers): array
    {
        $skip = [
            'Employee Code', 'Name', 'Email', 'Phone', 'Designation', 'Department', 'Division',
            'Pay Level', 'Status', 'Date of Joining', 'Date of Birth', 'PAN', 'Aadhaar', 'UAN',
            'CPF No', 'Bank Name', 'Bank Account Number', 'IFSC', 'Month', 'Through Day',
            'Quarter Assigned', 'Quarter Name', 'Quarter Type',
        ];
        $indexes = [];
        foreach ($headers as $i => $label) {
            if (! in_array($label, $skip, true)) {
                $indexes[] = $i;
            }
        }

        return $indexes;
    }

    /**
     * @param  array<string, mixed>|null  $master
     * @param  array{earnings: list<string>, deductions: list<string>}  $customKeys
     * @return list<string|int|float|null>
     */
    /**
     * @param  array{assigned?: bool, quarterId?: ?string, name?: string, type?: string}|null  $quarterMeta
     */
    public function buildDataRow(
        ?array $master,
        HrmsPayrollPeriod $period,
        HrmsGovernmentMonthlyPayroll $gov,
        array $customKeys = ['earnings' => [], 'deductions' => []],
        ?array $quarterMeta = null,
    ): array {
        $n = static fn ($v): float => is_numeric($v) ? (float) $v : 0.0;
        $master = $master ?? [];
        $quarterMeta ??= $this->resolveQuarterMeta($gov, $master);

        $payLevel = $gov->pay_level !== null && $gov->pay_level !== ''
            ? $gov->pay_level
            : ($master['payLevel'] ?? '');

        $row = [
            (string) ($master['employeeCode'] ?? ''),
            $master['name'] ?? '',
            $master['email'] ?? '',
            $master['phone'] ?? '',
            $master['designation'] ?? '',
            $master['department'] ?? '',
            $master['division'] ?? '',
            $payLevel,
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
            $this->monthLabel($period),
            $this->throughDay($period, $gov),
            ! empty($quarterMeta['assigned']) ? 'Yes' : 'No',
            (string) ($quarterMeta['name'] ?? ''),
            (string) ($quarterMeta['type'] ?? ''),
            $n($gov->basic_paid),
            $n($gov->da_paid),
            $n($gov->hra_paid),
            $n($gov->transport_paid),
            $n($gov->medical_paid),
            $n($gov->night_allowance_paid ?? $gov->night_allowance_amount ?? 0),
        ];

        $customEarnings = $this->normalizeCustomMap($gov->custom_earnings);
        foreach ($customKeys['earnings'] as $key) {
            $row[] = isset($customEarnings[$key]) ? $n($customEarnings[$key]) : '';
        }

        $row = array_merge($row, [
            $n($gov->total_earnings),
            $n($gov->income_tax_amount ?? 0),
            $n($gov->pt_amount ?? 0),
            $n($gov->lic_amount ?? 0),
            $n($gov->cpf_amount ?? 0),
            $n($gov->da_cpf_amount ?? 0),
            $n($gov->vpf_amount ?? 0),
            $n($gov->pf_loan_amount ?? 0),
            $n($gov->post_office_amount ?? 0),
            $n($gov->credit_society_amount ?? 0),
            $n($gov->std_licence_fee_amount ?? 0),
            $n($gov->electricity_amount ?? $gov->electricity_total ?? 0),
            $n($gov->electricity_units_consumed ?? 0),
            $n($gov->water_amount ?? 0),
            $n($gov->mess_amount ?? 0),
            $n($gov->loan_recovery_amount ?? 0),
            $n($gov->welfare_amount ?? 0),
            $n($gov->hpl_amount ?? 0),
            $n($gov->eol_amount ?? 0),
            $n($gov->veh_charge_amount ?? 0),
            $n($gov->quarter_rent_amount ?? 0),
            $n($gov->other_deduction_amount ?? 0),
        ]);

        $customDeductions = $this->normalizeCustomMap($gov->custom_deductions);
        foreach ($customKeys['deductions'] as $key) {
            $row[] = isset($customDeductions[$key]) ? $n($customDeductions[$key]) : '';
        }

        return array_merge($row, [
            $n($gov->total_deductions),
            $n($gov->da_arrears_paid ?? 0),
            $n($gov->transport_arrears_paid ?? 0),
            $n($gov->gross_arrear ?? 0),
            $n($gov->cpf_arrear ?? 0),
            $n($gov->net_arrear ?? 0),
            $n($gov->net_salary),
        ]);
    }

    /**
     * Clean month label: "June 2026" (never "June 2026 (through day 30) - Basic Paid").
     */
    public function monthLabel(HrmsPayrollPeriod $period): string
    {
        $start = $period->period_start;
        if ($start) {
            return $start->format('F Y');
        }

        $name = trim((string) ($period->period_name ?? ''));
        if ($name !== '' && preg_match('/^(.+?)\s*\(through day\s+\d+\)\s*$/i', $name, $m)) {
            return trim($m[1]);
        }

        return $name !== '' ? $name : 'Period';
    }

    public function throughDay(HrmsPayrollPeriod $period, ?HrmsGovernmentMonthlyPayroll $gov = null): string|int
    {
        $name = trim((string) ($period->period_name ?? ''));
        if ($name !== '' && preg_match('/\(through day\s+(\d+)\)/i', $name, $m)) {
            return (int) $m[1];
        }
        if ($gov && is_numeric($gov->days_in_month ?? null)) {
            return (int) $gov->days_in_month;
        }
        $end = $period->period_end;
        if ($end) {
            return (int) $end->format('j');
        }

        return '';
    }

    /**
     * @param  array<string, array<string, mixed>>  $mastersByUser
     */
    private function employeeCodeFor(HrmsGovernmentMonthlyPayroll $gov, array $mastersByUser): string
    {
        $uid = (string) ($gov->employee_user_id ?? '');
        $master = $mastersByUser[$uid] ?? null;

        return (string) ($master['employeeCode'] ?? '');
    }

    /**
     * @param  array{assigned: bool, quarterId: ?string, name: string, type: string}  $quarterMeta
     * @param  list<string>  $quarterIds
     */
    private function quarterMetaMatchesFilter(array $quarterMeta, array $quarterIds): bool
    {
        $qid = (string) ($quarterMeta['quarterId'] ?? '');
        if ($qid === '') {
            return false;
        }

        return in_array($qid, $quarterIds, true);
    }

    /**
     * @param  mixed  $raw
     * @return array<string, float|int|string>
     */
    private function normalizeCustomMap(mixed $raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $key => $value) {
            $label = trim((string) $key);
            if ($label === '') {
                continue;
            }
            $out[$label] = $value;
        }

        return $out;
    }

    private function customHeaderLabel(string $key): string
    {
        $key = trim($key);
        if ($key === '') {
            return 'Custom Field';
        }
        // Avoid recreating month-prefixed headers.
        if (preg_match('/^.+\s+-\s+.+$/', $key)) {
            $parts = preg_split('/\s+-\s+/', $key);
            $key = trim((string) end($parts));
        }

        return $key;
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
