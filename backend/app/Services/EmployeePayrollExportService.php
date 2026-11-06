<?php

namespace App\Services;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsQuarter;
use App\Support\PayrollExportTotals;
use App\Support\PayrollLabels;
use App\Support\SpreadsheetLayout;
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
    /** @var list<string> Dedicated classifications emitted as fixed export columns. */
    private const FIXED_CUSTOM_COMPONENTS = ['telephone_allowance', 'gpf'];

    public function __construct(
        private readonly PayrollMasterService $masterService,
    ) {}

    /**
     * @param  list<string>  $periodIds
     * @param  list<string>  $employeeUserIds  When non-empty, only these employees are exported.
     */
    public function export(
        string $companyId,
        array $periodIds,
        array $employeeUserIds = [],
    ): StreamedResponse {
        $periodIds = array_values(array_unique(array_filter($periodIds, static fn ($id) => is_string($id) && $id !== '')));
        $employeeUserIds = array_values(array_unique(array_filter(
            $employeeUserIds,
            static fn ($id) => is_string($id) && $id !== '',
        )));
        $employeeUserIdSet = $employeeUserIds === [] ? null : array_fill_keys($employeeUserIds, true);

        if ($periodIds === []) {
            abort(422, 'Select at least one payroll run month.');
        }
        if (count($periodIds) > PeriodReportService::MAX_MONTHS) {
            abort(422, 'Select at most '.PeriodReportService::MAX_MONTHS.' payroll run months.');
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
        $customKeys = $this->resolveCustomKeys($companyId, $monthlyByPeriod);

        $sheet = $this->buildSpreadsheet(
            $periods->all(),
            $monthlyByPeriod,
            $mastersByUser,
            $mastersById,
            $quartersById,
            $customKeys,
            $employeeUserIdSet,
        );
        if ($sheet->getActiveSheet()->getHighestDataRow() < 3) {
            abort(422, 'No employees match the selected payroll months and explicit filters.');
        }

        $first = $periods->first()->period_start?->format('Y-m') ?? 'period';
        $last = $periods->last()->period_start?->format('Y-m') ?? 'period';
        $filename = 'cirt_employee_payroll_'.($first === $last ? $first : "{$first}_to_{$last}").'.xlsx';

        return response()->streamDownload(function () use ($sheet) {
            (new Xlsx($sheet))->save('php://output');
        }, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /**
     * Preview of the export (same loaders, same rows, same totals check as the download).
     *
     * @param  list<string>  $periodIds
     * @param  list<string>  $employeeUserIds
     * @return array{headers: list<string>, rows: list<list<mixed>>, totals: list<mixed>, moneyColumns: list<int>}
     */
    public function previewTable(string $companyId, array $periodIds, array $employeeUserIds = []): array
    {
        $periods = HrmsPayrollPeriod::query()->where('company_id', $companyId)->whereIn('id', $periodIds)->orderBy('period_start')->get();
        $monthlyByPeriod = $this->loadMonthlyByPeriod($companyId, $periodIds);

        return $this->buildTable(
            $periods->all(),
            $monthlyByPeriod,
            $this->loadMastersByUser($companyId),
            $this->loadMastersByIdForMonthly($companyId, $monthlyByPeriod),
            $this->loadQuartersById($companyId),
            $this->resolveCustomKeys($companyId, $monthlyByPeriod),
            $employeeUserIds === [] ? null : array_fill_keys($employeeUserIds, true),
        );
    }

    /**
     * Build the saved-snapshot workbook used by both the HTTP export and isolated
     * regression tests. Residential accommodation metadata is output-only; it
     * never selects or excludes payroll rows.
     *
     * @param  list<HrmsPayrollPeriod>  $periods
     * @param  array<string, list<HrmsGovernmentMonthlyPayroll>>  $monthlyByPeriod
     * @param  array<string, array<string, mixed>>  $mastersByUser
     * @param  array<string, array{quarterId: ?string, hasQuarter: bool, quarterName: ?string, quarterType: ?string}>  $mastersById
     * @param  array<string, array{name: string, type: string}>  $quartersById
     * @param  array{earnings: list<string>, deductions: list<string>}  $customKeys
     * @param  array<string, true>|null  $employeeUserIdSet
     */
    public function buildSpreadsheet(
        array $periods,
        array $monthlyByPeriod,
        array $mastersByUser,
        array $mastersById,
        array $quartersById,
        array $customKeys,
        ?array $employeeUserIdSet = null,
    ): Spreadsheet {
        $table = $this->buildTable($periods, $monthlyByPeriod, $mastersByUser, $mastersById, $quartersById, $customKeys, $employeeUserIdSet);
        $headers = $table['headers'];
        $amountColIndexes = $this->amountColumnIndexes($headers, $customKeys);
        $sheet = new Spreadsheet;
        $active = $sheet->getActiveSheet();
        $active->setTitle('Employee Payroll');
        $active->fromArray($headers, null, 'A1');
        $lastHeaderCol = $this->colLetter(count($headers));
        $active->getStyle('A1:'.$lastHeaderCol.'1')->getFont()->setBold(true);

        $rowNum = 2;
        foreach ($table['rows'] as $values) {
            foreach ($values as $colIndex0 => $value) {
                $coord = $this->colLetter($colIndex0 + 1).$rowNum;
                if ($colIndex0 === 0) {
                    $active->setCellValueExplicit($coord, (string) $value, DataType::TYPE_STRING);
                } elseif (in_array($colIndex0, $amountColIndexes, true) && $value !== '' && $value !== null && is_numeric($value)) {
                    $active->setCellValue($coord, 0 + $value);
                    $active->getStyle($coord)->getNumberFormat()->setFormatCode(\App\Support\SpreadsheetLayout::FORMAT_AMOUNT);
                } else {
                    $active->setCellValue($coord, $value);
                }
            }
            $rowNum++;
        }
        $lastDataRow = max(1, $rowNum - 1);
        // Totals row (bold, real numeric cells), outside the filter range so sorting never moves it.
        foreach ($table['totals'] as $colIndex0 => $value) {
            if ($value === '' || $value === null) continue;
            $coord = $this->colLetter($colIndex0 + 1).$rowNum;
            if (is_numeric($value) && $colIndex0 !== 0) {
                $active->setCellValue($coord, 0 + $value);
                $active->getStyle($coord)->getNumberFormat()->setFormatCode(\App\Support\SpreadsheetLayout::FORMAT_AMOUNT);
            } else {
                $active->setCellValue($coord, $value);
            }
        }
        $active->getStyle('A'.$rowNum.':'.$lastHeaderCol.$rowNum)->getFont()->setBold(true);
        SpreadsheetLayout::finish($active, [
            'header_row' => 1, 'freeze' => 'C2', 'autofilter' => 'A1:'.$lastHeaderCol.$lastDataRow,
            'date_columns' => array_fill_keys(SpreadsheetLayout::columnsByHeader($active, 1, ['Date of Joining', 'Date of Birth']), SpreadsheetLayout::FORMAT_DATE),
            'text_columns' => SpreadsheetLayout::columnsByHeader($active, 1, ['Employee Code', 'Phone', 'PAN', 'Aadhaar', 'UAN', 'CPF No', 'Bank Account Number', 'IFSC']),
            'wrap_columns' => SpreadsheetLayout::columnsByHeader($active, 1, ['Designation', 'Department', 'Division', 'Email']),
        ]);

        return $sheet;
    }

    /**
     * The report as data (used by the preview and the workbook): one row per employee per selected
     * period, grouped by employee (employee code, natural order), periods in chronological order.
     * Every row is the period's SAVED payroll row, and its totals are cross-checked (422 on mismatch).
     *
     * @param  list<HrmsPayrollPeriod>  $periods
     * @param  array<string, list<HrmsGovernmentMonthlyPayroll>>  $monthlyByPeriod
     * @param  array<string, array<string, mixed>>  $mastersByUser
     * @param  array<string, array{quarterId: ?string, hasQuarter: bool, quarterName: ?string, quarterType: ?string}>  $mastersById
     * @param  array<string, array{name: string, type: string}>  $quartersById
     * @param  array{earnings: list<string>, deductions: list<string>, labels?: array<string, string>}  $customKeys
     * @param  array<string, true>|null  $employeeUserIdSet
     * @return array{headers: list<string>, groups: list<string>, rows: list<list<mixed>>, totals: list<mixed>, moneyColumns: list<int>}
     */
    public function buildTable(
        array $periods,
        array $monthlyByPeriod,
        array $mastersByUser,
        array $mastersById,
        array $quartersById,
        array $customKeys,
        ?array $employeeUserIdSet = null,
    ): array {
        $headers = $this->buildHeaders($customKeys);
        SpreadsheetLayout::assertHeaders($headers, 'Export Employee Payroll');
        $skipSum = array_keys(array_intersect($headers, ['Electricity Units']));
        $amountCols = array_values(array_diff($this->amountColumnIndexes($headers, $customKeys), $skipSum));
        $items = [];
        foreach ($periods as $period) {
            foreach ($monthlyByPeriod[(string) $period->id] ?? [] as $gov) {
                $uid = (string) ($gov->employee_user_id ?? '');
                if ($employeeUserIdSet !== null && ! isset($employeeUserIdSet[$uid])) {
                    continue;
                }
                $items[] = [
                    'period' => $period, 'gov' => $gov, 'uid' => $uid,
                    'code' => $this->employeeCodeFor($gov, $mastersByUser),
                    'start' => $period->period_start?->getTimestamp() ?? 0,
                ];
            }
        }
        usort($items, fn (array $x, array $y) => strnatcasecmp($x['code'], $y['code']) ?: strcmp($x['uid'], $y['uid']) ?: $x['start'] <=> $y['start']);

        $rows = [];
        $totals = array_fill(0, count($headers), '');
        $sums = array_fill_keys($amountCols, 0.0);
        foreach ($items as $it) {
            /** @var HrmsGovernmentMonthlyPayroll $gov */
            $gov = $it['gov'];
            $attrs = $gov->getAttributes();
            $attrs['incentive'] = $gov->payslip?->incentive ?? 0;
            $attrs['pr_bonus'] = $gov->payslip?->pr_bonus ?? 0;
            $attrs['reimbursement'] = $gov->payslip?->reimbursement ?? 0;
            PayrollExportTotals::assertConsistent($attrs, trim($it['code'].' '.$this->monthLabel($it['period'])));
            $values = $this->buildDataRow(
                $mastersByUser[$it['uid']] ?? null,
                $it['period'],
                $gov,
                $customKeys,
                $this->resolveQuarterMeta($gov, $mastersByUser[$it['uid']] ?? null, $mastersById, $quartersById),
            );
            foreach ($amountCols as $i) {
                if (isset($values[$i]) && is_numeric($values[$i])) {
                    // Every amount shown is a whole rupee, so the Total row is the exact sum of the rows above it.
                    $values[$i] = \App\Support\Money::roundMoney($values[$i]);
                    $sums[$i] += $values[$i];
                }
            }
            $rows[] = $values;
        }
        if ($rows !== []) {
            $totals[0] = 'Total';
            foreach ($sums as $i => $sum) $totals[$i] = round($sum, 2);
        }

        $groups = array_column($this->columnDefinitions($customKeys), 'group');

        // Encashment DA is retired from payroll: leave its column out unless some row still carries an amount.
        $retired = array_search('Encashment DA', $headers, true);
        if ($retired !== false && $this->columnIsEmpty($rows, (int) $retired)) {
            $drop = static fn (array $list): array => array_values(array_filter($list, static fn ($k) => $k !== $retired, ARRAY_FILTER_USE_KEY));
            $headers = $drop($headers);
            $groups = $drop($groups);
            $totals = $drop($totals);
            $rows = array_map($drop, $rows);
            $amountCols = array_values(array_map(
                static fn (int $i): int => $i > $retired ? $i - 1 : $i,
                array_filter($amountCols, static fn (int $i): bool => $i !== $retired),
            ));
        }

        return ['headers' => $headers, 'groups' => $groups, 'rows' => $rows, 'totals' => $totals, 'moneyColumns' => $amountCols];
    }

    /** @param list<list<mixed>> $rows */
    private function columnIsEmpty(array $rows, int $index): bool
    {
        foreach ($rows as $row) {
            if (isset($row[$index]) && is_numeric($row[$index]) && (float) $row[$index] !== 0.0) {
                return false;
            }
        }

        return true;
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
            ->with('payslip')
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
     * Custom earning/deduction columns: every definition from Settings (active, or inactive with a
     * non-zero saved value) plus any saved key without a definition. Telephone Allowance and GPF keep
     * their dedicated columns.
     *
     * @param  array<string, list<HrmsGovernmentMonthlyPayroll>>  $monthlyByPeriod
     * @return array{earnings: list<string>, deductions: list<string>, labels: array<string, string>}
     */
    private function resolveCustomKeys(string $companyId, array $monthlyByPeriod): array
    {
        $bags = [];
        foreach ($monthlyByPeriod as $rows) {
            foreach ($rows as $gov) $bags[] = [$gov->custom_earnings, $gov->custom_deductions];
        }
        $cols = app(PeriodReportService::class)->customColumns($companyId, $bags, PeriodReportService::EMPLOYEE_FIXED_CUSTOM);

        return [
            'earnings' => array_keys($cols['earnings']),
            'deductions' => array_keys($cols['deductions']),
            'labels' => $cols['earnings'] + $cols['deductions'],
        ];
    }

    /**
     * THE column definition of Export Employee Payroll (preview and Excel both read it): header, group and
     * value of every column, in order. Groups: identity, info, earning, total_earnings, deduction,
     * total_deductions, net. Nothing that is an earning sits after Total Earnings, nothing that is a
     * deduction after Total Deductions, and Net Salary follows Total Deductions; memo columns come last.
     * Custom fields land in the earning or deduction block by their Settings group.
     *
     * @param  array{earnings: list<string>, deductions: list<string>, labels?: array<string, string>}  $customKeys
     * @return list<array{header: string, group: string, money: bool, value: callable}>
     */
    private function columnDefinitions(array $customKeys): array
    {
        $cols = [];
        $text = function (string $h, string $g, callable $v) use (&$cols): void {
            $cols[] = ['header' => $h, 'group' => $g, 'money' => false, 'value' => $v];
        };
        $money = function (string $h, string $g, callable $v) use (&$cols): void {
            $cols[] = ['header' => $h, 'group' => $g, 'money' => true, 'value' => $v];
        };
        $col = fn (string $attr) => fn (array $c): float => $c['n']($c['gov']->{$attr});

        // identity
        $text('Employee Code', 'identity', fn (array $c) => (string) ($c['master']['employeeCode'] ?? ''));
        $text('Name', 'identity', fn (array $c) => $c['master']['name'] ?? '');
        $text('Email', 'identity', fn (array $c) => $c['master']['email'] ?? '');
        $text('Phone', 'identity', fn (array $c) => $c['master']['phone'] ?? '');
        $text('Designation', 'identity', fn (array $c) => $c['master']['designation'] ?? '');
        $text('Department', 'identity', fn (array $c) => $c['master']['department'] ?? '');
        $text('Division', 'identity', fn (array $c) => $c['master']['division'] ?? '');
        $text('Pay Level', 'identity', fn (array $c) => $c['payLevel']);
        $text('Status', 'identity', fn (array $c) => $c['master']['status'] ?? '');
        $text('Date of Joining', 'identity', fn (array $c) => $c['master']['dateOfJoining'] ?? '');
        $text('Date of Birth', 'identity', fn (array $c) => $c['master']['dateOfBirth'] ?? '');
        $text('PAN', 'identity', fn (array $c) => $c['master']['pan'] ?? '');
        $text('Aadhaar', 'identity', fn (array $c) => $c['master']['aadhaar'] ?? '');
        $text('UAN', 'identity', fn (array $c) => $c['master']['uan'] ?? '');
        $text('CPF No', 'identity', fn (array $c) => $c['master']['cpfNo'] ?? '');
        $text('Bank Name', 'identity', fn (array $c) => $c['master']['bankName'] ?? '');
        $text('Bank Account Number', 'identity', fn (array $c) => $c['master']['bankAccountNumber'] ?? '');
        $text('IFSC', 'identity', fn (array $c) => $c['master']['bankIfsc'] ?? '');
        // period / quarter context (info)
        $text('Month', 'info', fn (array $c) => $this->monthLabel($c['period']));
        $text('Year', 'info', fn (array $c) => $c['period']->period_start ? (int) $c['period']->period_start->format('Y') : '');
        $text('Through Day', 'info', fn (array $c) => $this->throughDay($c['period'], $c['gov']));
        $text('Quarter Assigned', 'info', fn (array $c) => ! empty($c['quarterMeta']['assigned']) ? 'Yes' : 'No');
        $text('Quarter Name', 'info', fn (array $c) => (string) ($c['quarterMeta']['name'] ?? ''));
        $text('Quarter Type', 'info', fn (array $c) => (string) ($c['quarterMeta']['type'] ?? ''));

        // earnings
        $money('Basic Paid', 'earning', $col('basic_paid'));
        $money('DA Paid', 'earning', $col('da_paid'));
        $money('HRA Paid', 'earning', $col('hra_paid'));
        $money('Transport Paid', 'earning', $col('transport_paid'));
        $money('Medical Paid', 'earning', $col('medical_paid'));
        $money('Special Pay', 'earning', $col('sp_pay_paid'));
        $money('Night Allowance', 'earning', fn (array $c): float => $c['n']($c['gov']->night_allowance_paid ?? $c['gov']->night_allowance_amount ?? 0));
        $money('Education Allowance', 'earning', fn (array $c): float => $c['n']($c['gov']->education_allowance_paid ?? 0));
        $money('Telephone Allowance', 'earning', fn (array $c): float => $c['n']($c['customEarnings']['telephone_allowance'] ?? 0));
        $money('Encashment', 'earning', fn (array $c): float => $c['n']($c['gov']->encashment_paid ?? 0));
        $money('Encashment DA', 'earning', fn (array $c): float => $c['n']($c['gov']->encashment_da_paid ?? 0));
        $money('DA Arrear', 'earning', fn (array $c): float => $c['n']($c['gov']->da_arrears_paid ?? 0));
        $money('Transport Arrear', 'earning', fn (array $c): float => $c['n']($c['gov']->transport_arrears_paid ?? 0));
        $money(PayrollLabels::GROSS_ARREARS, 'earning', fn (array $c): float => $c['n']($c['gov']->gross_arrear ?? 0));
        $money('Incentive', 'earning', fn (array $c): float => $c['n']($c['gov']->payslip?->incentive ?? 0));
        $money('PR Bonus', 'earning', fn (array $c): float => $c['n']($c['gov']->payslip?->pr_bonus ?? 0));
        $money('Reimbursement', 'earning', fn (array $c): float => $c['n']($c['gov']->payslip?->reimbursement ?? 0));
        foreach ($customKeys['earnings'] as $key) {
            $money($this->uniqueHeader(array_column($cols, 'header'), $this->customHeaderLabel($customKeys['labels'][$key] ?? $key)), 'earning',
                fn (array $c) => isset($c['customEarnings'][$key]) ? $c['n']($c['customEarnings'][$key]) : '');
        }
        $money('Total Earnings', 'total_earnings', $col('total_earnings'));

        // deductions
        $money('Income Tax', 'deduction', fn (array $c): float => $c['n']($c['gov']->income_tax_amount ?? 0));
        $money('Professional Tax', 'deduction', fn (array $c): float => $c['n']($c['gov']->pt_amount ?? 0));
        $money('LIC', 'deduction', fn (array $c): float => $c['n']($c['gov']->lic_amount ?? 0));
        $money('CPF', 'deduction', fn (array $c): float => $c['n']($c['gov']->cpf_amount ?? 0));
        $money('DA CPF', 'deduction', fn (array $c): float => $c['n'](\App\Support\PayrollTotals::daCpf($c['gov'])));
        $money('GPF', 'deduction', fn (array $c): float => $c['n']($c['customDeductions']['gpf'] ?? 0));
        $money('VPF', 'deduction', fn (array $c): float => $c['n']($c['gov']->vpf_amount ?? 0));
        $money('PF Loan', 'deduction', fn (array $c): float => $c['n']($c['gov']->pf_loan_amount ?? 0));
        $money('Post Office', 'deduction', fn (array $c): float => $c['n']($c['gov']->post_office_amount ?? 0));
        $money('Credit Society', 'deduction', fn (array $c): float => $c['n']($c['gov']->credit_society_amount ?? 0));
        $money('Standard Licence Fee', 'deduction', fn (array $c): float => $c['n']($c['gov']->std_licence_fee_amount ?? 0));
        $money('Electricity', 'deduction', fn (array $c): float => $c['n']($c['gov']->electricity_amount ?? $c['gov']->electricity_total ?? 0));
        $money('Electricity Units', 'info', fn (array $c): float => $c['n']($c['gov']->electricity_units_consumed ?? 0));
        $money('Water', 'deduction', fn (array $c): float => $c['n']($c['gov']->water_amount ?? 0));
        $money('Mess', 'deduction', fn (array $c): float => $c['n']($c['gov']->mess_amount ?? 0));
        $money('Bank / Loan Recovery', 'deduction', fn (array $c): float => $c['n']($c['gov']->loan_recovery_amount ?? 0));
        $money('Welfare', 'deduction', fn (array $c): float => $c['n']($c['gov']->welfare_amount ?? 0));
        $money('HPL', 'deduction', fn (array $c): float => $c['n']($c['gov']->hpl_amount ?? 0));
        $money('EOL', 'deduction', fn (array $c): float => $c['n']($c['gov']->eol_amount ?? 0));
        $money('Vehicle Charge', 'deduction', fn (array $c): float => $c['n']($c['gov']->veh_charge_amount ?? 0));
        $money('Quarter Rent', 'deduction', fn (array $c): float => $c['n']($c['gov']->quarter_rent_amount ?? 0));
        $money('Other Deduction', 'deduction', fn (array $c): float => $c['n']($c['gov']->other_deduction_amount ?? 0));
        // CPF Arr is the same amount as DA CPF above (one shared value); it is a memo here so the deduction columns add up to Total Deductions.
        $money(PayrollLabels::CPF_ARREARS, 'info', fn (array $c): float => $c['n']($c['gov']->cpf_arrear ?? 0));
        foreach ($customKeys['deductions'] as $key) {
            $money($this->uniqueHeader(array_column($cols, 'header'), $this->customHeaderLabel($customKeys['labels'][$key] ?? $key)), 'deduction',
                fn (array $c) => isset($c['customDeductions'][$key]) ? $c['n']($c['customDeductions'][$key]) : '');
        }
        $money('Total Deductions', 'total_deductions', $col('total_deductions'));

        // net, then memo columns
        $money('Net Salary', 'net', $col('net_salary'));
        $money(PayrollLabels::NET_ARREARS, 'info', fn (array $c): float => $c['n']($c['gov']->net_arrear ?? 0));

        return $cols;
    }

    /**
     * @param  array{earnings: list<string>, deductions: list<string>, labels?: array<string, string>}  $customKeys
     * @return list<string>
     */
    public function buildHeaders(array $customKeys = ['earnings' => [], 'deductions' => []]): array
    {
        return array_column($this->columnDefinitions($customKeys), 'header');
    }

    /**
     * Group of every column, in column order (same definition as the headers and the values).
     *
     * @param  array{earnings: list<string>, deductions: list<string>, labels?: array<string, string>}  $customKeys
     * @return list<array{header: string, group: string}>
     */
    public function columnGroups(array $customKeys = ['earnings' => [], 'deductions' => []]): array
    {
        return array_map(fn (array $c) => ['header' => $c['header'], 'group' => $c['group']], $this->columnDefinitions($customKeys));
    }

    /**
     * @param  array<string, mixed>  $customKeys
     * @return list<int> zero-based indexes of numeric payroll amount columns
     */
    private function amountColumnIndexes(array $headers, array $customKeys = ['earnings' => [], 'deductions' => []]): array
    {
        $indexes = [];
        foreach ($this->columnDefinitions($customKeys) as $i => $c) {
            if ($c['money'] && ($headers[$i] ?? null) === $c['header']) $indexes[] = $i;
        }

        return $indexes;
    }

    /**
     * @param  array<string, mixed>|null  $master
     * @param  array{earnings: list<string>, deductions: list<string>}  $customKeys
     * @param  array{assigned?: bool, quarterId?: ?string, name?: string, type?: string}|null  $quarterMeta
     * @return list<string|int|float|null>
     */
    public function buildDataRow(
        ?array $master,
        HrmsPayrollPeriod $period,
        HrmsGovernmentMonthlyPayroll $gov,
        array $customKeys = ['earnings' => [], 'deductions' => []],
        ?array $quarterMeta = null,
    ): array {
        $master = $master ?? [];
        $c = [
            'n' => static fn ($v): float => is_numeric($v) ? (float) $v : 0.0,
            'master' => $master,
            'period' => $period,
            'gov' => $gov,
            'quarterMeta' => $quarterMeta ?? $this->resolveQuarterMeta($gov, $master),
            'customEarnings' => $this->normalizeCustomMap($gov->custom_earnings),
            'customDeductions' => $this->normalizeCustomMap($gov->custom_deductions),
            'payLevel' => $gov->pay_level !== null && $gov->pay_level !== '' ? $gov->pay_level : ($master['payLevel'] ?? ''),
        ];

        return array_map(fn (array $def) => ($def['value'])($c), $this->columnDefinitions($customKeys));
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

    /** A custom field named like a fixed column (e.g. the "Arrears" field) gets "(Custom)" so headers stay unambiguous. */
    private function uniqueHeader(array $headers, string $label): string
    {
        return in_array($label, $headers, true) ? $label.' (Custom)' : $label;
    }

    private function customHeaderLabel(string $key): string
    {
        $key = SpreadsheetLayout::safeHeader($key, 'Custom Field'); // blank or numeric labels never become a header
        if ($key === 'Custom Field') {
            return $key;
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
