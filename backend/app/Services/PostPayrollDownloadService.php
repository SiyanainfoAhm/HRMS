<?php

namespace App\Services;

use App\Support\PayrollLabels;
use App\Support\SpreadsheetLayout;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Shared\Date as XlDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * CIRT-11/12 Post Payroll Downloads: CPF, Division-Wise, TDS and Paybill workbooks built from the
 * GENERATED monthly payroll (cirt_monthly_payroll). Layouts follow the files in "System Format".
 * Every number is written as a number; totals are live formulas where the sample uses them.
 */
final class PostPayrollDownloadService
{
    public const INSTITUTE = 'Central Institute of Road Transport, Bhosari, Pune- 411 026';

    /** Employee categories of the Division-Wise sheets, in sample order. UNCONFIRMED source: no category field exists, everyone is CIRT. */
    public const CATEGORIES = ['CIRT', 'ITI', 'CONTRACT', 'CONSULTANT', 'LABOUR CONTRACTOR', 'SECURITY SERVICES'];

    public const DEFAULT_CATEGORY = 'CIRT';

    /** Division shown for a payroll row that has no usable division name (blank, an id or a code). Always listed last. */
    public const UNASSIGNED = 'Unassigned';

    /** Division-Wise Salary detail sheet (preview and Excel share these): one row per employee per month, grouped by division. */
    public const DIVISION_WISE_HEADERS = ['Division', 'Employee Code', 'Name', 'Designation', 'Pay Level', 'Month', 'Year', 'Category', 'Gross Salary', 'Total Deductions', 'Net Pay', 'CPF Employer Contr.', 'DA CPF', 'Total CPF'];

    /** 0-based money columns of DIVISION_WISE_HEADERS. */
    public const DIVISION_WISE_MONEY = [8, 9, 10, 11, 12, 13];

    /** Pay level groups of the Pay Level sheet. */
    public const PAY_GROUPS = ['A Pay Leave 10 - 18' => [10, 18], 'B Pay Leavel 6-9' => [6, 9], 'C Pay Level 1 -5' => [1, 5]];

    /** Paybill column => cirt_monthly_payroll field(s); null = no source field in payroll. */
    public const PAYBILL_EARNINGS = [
        'Basic' => ['basic_paid'], 'sp.pay' => ['sp_pay_paid'], 'D.A.' => ['da_paid'], 'H.R.A.' => ['hra_paid'],
        'UNIFORM' => ['uniform_allowance_paid'], 'EWA' => ['extra_work_allowance_paid'], 'Trpt.' => ['transport_paid'],
        'Medical' => ['medical_paid'],
        // All arrears (DA + transport + gross-only remainder): the legacy paybill has a single arrears column.
        'DA Arrs.' => ['@arrears'], 'En.DA' => ['encashment_da_paid'],
        'T.Fees.' => ['education_allowance_paid'], 'CCA' => null, 'NDA' => ['night_allowance_paid'],
        'Encash' => ['encashment_paid'],
        // Company-defined earnings (e.g. special_allowance, arrears, over_time_allowance) have no legacy column.
        // They are shown together so the printed columns add up to Tot. Pay.
        'Custom Earnings' => ['@custom_earnings'], 'Tot. Pay' => ['total_earnings'],
    ];

    public const PAYBILL_DEDUCTIONS = [
        'I.T.' => ['income_tax_amount'], 'P.T.' => ['pt_amount'], 'L.I.C.' => ['lic_amount'], 'PF(C)' => ['cpf_amount'],
        'FP' => null, 'PF(V)' => ['vpf_amount'], 'PF(L)' => ['pf_loan_amount'], 'P.O.' => ['post_office_amount'],
        'CR.SOCY' => ['credit_society_amount'], 'Veh.' => ['veh_charge_amount'], 'O.T.' => null,
        'Std.Lic.Fee' => ['std_licence_fee_amount'], 'Elec.' => ['electricity_amount'], 'TV' => null,
        'Water' => ['water_amount'], 'Furn.' => null, 'Mess' => ['mess_amount'], 'HOR' => ['loan_recovery_amount'],
        'TEL' => null, 'FEST.ADV' => null, 'CAR ADV' => null, 'SC.ADV' => null, 'CY.ADV' => null, 'INT.CY' => null,
        'INT.VEH' => null, 'HB.ADV' => null, 'INT.HB' => null, 'WEL' => ['welfare_amount'],
        'OTHER' => ['other_deduction_amount'],
        // The paybill's "DA CPF" column carries the renamed CPF Arr (CIRT-06): CPF on arrears + the DA CPF deduction.
        PayrollLabels::CPF_ARREARS => ['@da_cpf'], 'Lib.' => null, 'Union' => null,
        // No legacy column: shown so the deduction columns add up to TOT.DED.
        'Quarter Rent' => ['quarter_rent_amount'], 'HPL+EOL' => ['hpl_amount', 'eol_amount'],
        'Custom Deductions' => ['@custom_deductions'], 'TOT.DED.' => ['total_deductions'],
    ];

    /** @return list<string> paybill columns that have no payroll source field */
    public static function paybillColumnsWithoutSource(): array
    {
        return array_keys(array_filter([...self::PAYBILL_EARNINGS, ...self::PAYBILL_DEDUCTIONS], fn ($v) => $v === null));
    }

    // ---------------------------------------------------------------- data

    /** @return list<array<string, mixed>> */
    public function rows(string $companyId, int $fromYm, int $toYm): array
    {
        $from = sprintf('%04d-%02d-01', intdiv($fromYm, 100), $fromYm % 100);
        $to = sprintf('%04d-%02d-01', intdiv($toYm, 100), $toYm % 100);
        $monthly = DB::table('cirt_monthly_payroll')->where('company_id', $companyId)
            ->whereDate('month_year', '>=', $from)->whereDate('month_year', '<=', $to)
            ->orderBy('month_year')->get();
        $out = $this->attachMasters($companyId, $monthly);
        usort($out, fn ($a, $b) => [$a['_master']['employee_code'] ?? '', $a['_ym']] <=> [$b['_master']['employee_code'] ?? '', $b['_ym']]);

        return $out;
    }

    /** @return list<array<string, mixed>> monthly rows with the employee's master and user attached */
    private function attachMasters(string $companyId, \Illuminate\Support\Collection $monthly): array
    {
        $ids = $monthly->pluck('employee_user_id')->unique()->all();
        $masters = [];
        foreach (DB::table('cirt_payroll_master')->where('company_id', $companyId)->whereIn('employee_user_id', $ids)
            ->orderBy('effective_from')->get() as $m) {
            $masters[$m->employee_user_id] = $m; // latest effective_from wins
        }
        $users = DB::table('cirt_users')->whereIn('id', $ids)->get()->keyBy('id');
        $out = [];
        foreach ($monthly as $r) {
            $row = (array) $r;
            $m = $masters[$r->employee_user_id] ?? null;
            $u = $users[$r->employee_user_id] ?? null;
            $row['_master'] = $m ? (array) $m : [];
            $row['_user'] = $u ? (array) $u : [];
            $row['_ym'] = (int) date('Ym', strtotime((string) $r->month_year));
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Saved monthly rows of the chosen months (any set, across years) in ONE query, payslip lines
     * included for the totals check. Grouped by employee (code, natural order), months chronological.
     *
     * @param  list<string>  $months  YYYY-MM
     * @return list<array<string, mixed>>
     */
    public function rowsForMonths(string $companyId, array $months): array
    {
        $monthly = DB::table('cirt_monthly_payroll as m')
            ->leftJoin('cirt_payslips as p', 'p.id', '=', 'm.payslip_id')
            ->where('m.company_id', $companyId)
            ->whereIn(DB::raw("to_char(m.month_year, 'YYYY-MM')"), $months)
            ->select('m.*', 'p.incentive', 'p.pr_bonus', 'p.reimbursement')
            ->get();
        $out = $this->attachMasters($companyId, $monthly);
        usort($out, fn ($a, $b) => strnatcasecmp((string) ($a['_master']['employee_code'] ?? ''), (string) ($b['_master']['employee_code'] ?? ''))
            ?: strcmp((string) $a['employee_user_id'], (string) $b['employee_user_id'])
            ?: $a['_ym'] <=> $b['_ym']);

        return $out;
    }

    public static function n(array $row, string $key): float
    {
        return is_numeric($row[$key] ?? null) ? \App\Support\Money::roundMoney($row[$key]) : 0.0;
    }

    /** Custom (company-defined) field amounts of a monthly row; the bag is JSON text, [] or an object. @return array<string, float> */
    public static function customBag(array $row, string $column): array
    {
        $bag = $row[$column] ?? null;
        if (is_string($bag)) $bag = json_decode($bag, true);
        $out = [];
        foreach (is_array($bag) ? $bag : [] as $key => $value) {
            if (is_string($key) && is_numeric($value)) $out[$key] = \App\Support\Money::roundMoney($value);
        }

        return $out;
    }

    /**
     * TDS columns that receive company-defined earnings, by field key. UNCONFIRMED: any other custom earning
     * goes to TDS_CUSTOM_FALLBACK so taxable pay is never dropped from the TDS file.
     */
    public const TDS_CUSTOM_COLUMNS = ['arrears' => 'Total Arrears', 'encashment_arrears' => 'ENCASHMENT+ENCA DA', 'over_time_allowance' => 'OT ALLOWANCE'];

    public const TDS_CUSTOM_FALLBACK = 'PERKS';

    /** DA + transport arrears plus the part of Gross Arrears not already inside them. */
    public static function arrearsTotal(array $row): float
    {
        $da = self::n($row, 'da_arrears_paid');
        $tr = self::n($row, 'transport_arrears_paid');

        return \App\Support\PayrollTotals::arrearChain($da, $tr, 0)['grossArrear'];
    }

    private static function sum(array $row, array $keys): float
    {
        if (($keys[0] ?? '') === '@arrears') return round(self::arrearsTotal($row), 2);
        if (($keys[0] ?? '') === '@da_cpf') return \App\Support\PayrollTotals::daCpf($row);
        if (($keys[0] ?? '') === '@custom_earnings') return round(array_sum(self::customBag($row, 'custom_earnings')), 2);
        if (($keys[0] ?? '') === '@custom_deductions') return round(array_sum(self::customBag($row, 'custom_deductions')), 2);
        return array_sum(array_map(fn ($k) => self::n($row, $k), $keys));
    }

    public static function category(array $row): string
    {
        return self::DEFAULT_CATEGORY;
    }

    /** Pay-level group label for a level, or null. */
    public static function payGroup(int $level): ?string
    {
        foreach (self::PAY_GROUPS as $label => [$lo, $hi]) {
            if ($level >= $lo && $level <= $hi) return $label;
        }

        return null;
    }

    // ---------------------------------------------------------------- helpers

    private function sheetHeader(Worksheet $ws, int $row, array $headers, int $startCol = 1): void
    {
        SpreadsheetLayout::assertHeaders($headers, $ws->getTitle().' row '.$row);
        foreach ($headers as $i => $h) {
            $ws->setCellValue([$startCol + $i, $row], $h);
        }
        $range = Coordinate::stringFromColumnIndex($startCol).$row.':'.Coordinate::stringFromColumnIndex($startCol + count($headers) - 1).$row;
        $ws->getStyle($range)->getFont()->setBold(true);
        $ws->getStyle($range)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('D9D9D9');
        $ws->getStyle($range)->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER)->setWrapText(true);
    }

    private static function monthName(int $ym): string
    {
        return date('F Y', mktime(0, 0, 0, $ym % 100, 1, intdiv($ym, 100)));
    }

    public function save(Spreadsheet $wb): string
    {
        $path = tempnam(sys_get_temp_dir(), 'cirt_dl_').'.xlsx';
        (new Xlsx($wb))->save($path);

        return $path;
    }

    // ---------------------------------------------------------------- CPF

    /**
     * The employer-share rule from Settings (cirt_payroll_calculation_settings), or null when none of it is filled in.
     * Until the ASRTU CPF Trust rule is decided the three settings are empty and PENSION / EMP_ CONTR. stay blank.
     *
     * @return array{pensionPercentage: ?float, pensionWageCeiling: ?float, employerContributionPercentage: ?float}|null
     */
    public function employerShareRule(string $companyId): ?array
    {
        foreach (['pension_percentage', 'pension_wage_ceiling', 'employer_contribution_percentage'] as $column) {
            if (! \Illuminate\Support\Facades\Schema::hasColumn('cirt_payroll_calculation_settings', $column)) return null;
        }
        $s = DB::table('cirt_payroll_calculation_settings')->where('company_id', $companyId)->first();
        if (! $s) return null;
        $rule = [
            'pensionPercentage' => $s->pension_percentage !== null ? (float) $s->pension_percentage : null,
            'pensionWageCeiling' => $s->pension_wage_ceiling !== null ? (float) $s->pension_wage_ceiling : null,
            'employerContributionPercentage' => $s->employer_contribution_percentage !== null ? (float) $s->employer_contribution_percentage : null,
        ];

        return $rule['pensionPercentage'] === null && $rule['employerContributionPercentage'] === null ? null : $rule;
    }

    /**
     * @param  array{pensionPercentage?: ?float, pensionWageCeiling?: ?float, employerContributionPercentage?: ?float}|null  $employerRule
     *         null = no employer-share rule configured: PENSION and EMP_ CONTR. are left empty and the sheet says so.
     */
    public function buildCpf(array $rows, int $ym, ?array $employerRule = null): Spreadsheet
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('Sheet1');
        $ws->setCellValue('A1', self::INSTITUTE)->mergeCells('A1:R1');
        $ws->setCellValue('A2', 'Details of CPF, VPF, etc. for the month '.self::monthName($ym))->mergeCells('A2:R2');
        $ws->getStyle('A1:A2')->getFont()->setBold(true)->setSize(12);
        $ws->getStyle('A1:A2')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
        $this->sheetHeader($ws, 4, ['SR NO', 'UAN', 'NAME AS PER UAN', 'CPF  NO', 'GBASIC', 'NCP DAYS', 'BASIC', 'DA', 'HRA', 'TPT', 'MEDICAL', 'Total', 'CPF', 'DA CPF', 'Total CPF', 'VPF', 'PENSION', 'EMP_ CONTR.']);
        $pensionPct = $employerRule['pensionPercentage'] ?? null;
        $pensionCeiling = $employerRule['pensionWageCeiling'] ?? null;
        $employerPct = $employerRule['employerContributionPercentage'] ?? null;

        $groups = ['CIRT' => [], 'CONTRACT' => []];
        foreach ($rows as $r) {
            $groups[self::category($r) === 'CONTRACT' ? 'CONTRACT' : 'CIRT'][] = $r;
        }
        $line = 5;
        $sr = 1;
        $totalRows = [];
        foreach ($groups as $name => $set) {
            if ($name === 'CONTRACT') {
                $ws->setCellValue("A{$line}", 'CONTRACT EMPLOYEES FROM 01/03/2020');
                $ws->getStyle("A{$line}")->getFont()->setBold(true);
                $line++;
            }
            $first = $line;
            foreach ($set as $r) {
                $m = $r['_master'];
                $basis = self::sum($r, ['basic_paid', 'da_paid', 'hra_paid', 'transport_paid', 'medical_paid']);
                $daCpf = \App\Support\PayrollTotals::daCpf($r);
                $ws->setCellValue("A{$line}", $sr++);
                $ws->setCellValueExplicit("B{$line}", (string) ($m['uan'] ?? ''), \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                $ws->setCellValue("C{$line}", $m['name'] ?? '');
                $ws->setCellValueExplicit("D{$line}", (string) ($m['cpf_no'] ?? ''), \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                foreach ([
                    'E' => self::n($r, 'basic_actual'), 'F' => self::n($r, 'unpaid_days'), 'G' => self::n($r, 'basic_paid'),
                    'H' => self::n($r, 'da_paid'), 'I' => self::n($r, 'hra_paid'), 'J' => self::n($r, 'transport_paid'),
                    'K' => self::n($r, 'medical_paid'), 'L' => $basis, 'M' => self::n($r, 'cpf_amount'),
                    // DA CPF = CPF on the DA arrears (the Run Payroll "CPF Arr" line), through the one shared function.
                    'N' => $daCpf, 'O' => \App\Support\Money::roundMoney(self::n($r, 'cpf_amount') + $daCpf), 'P' => self::n($r, 'vpf_amount'),
                ] as $col => $v) {
                    $ws->setCellValue("{$col}{$line}", $v);
                }
                // Employer share: only when a rule is configured, and only for an employee who pays CPF (GPF members have none).
                if ($employerRule !== null && self::n($r, 'cpf_amount') > 0) {
                    if ($pensionPct !== null) {
                        $wage = $pensionCeiling !== null && $pensionCeiling > 0 ? min($basis, $pensionCeiling) : $basis;
                        $ws->setCellValue("Q{$line}", \App\Support\Money::percentOf($wage, $pensionPct));
                    }
                    if ($employerPct !== null) {
                        $ws->setCellValue("R{$line}", \App\Support\Money::percentOf($basis, $employerPct));
                    }
                }
                $line++;
            }
            $last = $line - 1;
            $ws->setCellValue('B'.$line, $name.' TOTAL');
            foreach (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'] as $col) {
                $ws->setCellValue("{$col}{$line}", $last >= $first ? "=SUBTOTAL(109,{$col}{$first}:{$col}{$last})" : 0);
            }
            $ws->getStyle("A{$line}:R{$line}")->getFont()->setBold(true);
            $totalRows[] = $line;
            $line += 2;
        }
        $grand = $line - 1;
        $ws->setCellValue('C'.$grand, 'GRAND TOTAL');
        foreach (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'] as $col) {
            $ws->setCellValue("{$col}{$grand}", "={$col}{$totalRows[0]}+{$col}{$totalRows[1]}");
        }
        $ws->getStyle("A{$grand}:R{$grand}")->getFont()->setBold(true);
        $s = $grand + 3;
        $this->sheetHeader($ws, $s, ['SL', 'PARTICULAR', 'AMOUNT'], 2); // the summary table starts in column B: no blank header cell in A
        // Employee deductions first (CPF + DA CPF, then VPF); the employer's share is Pension + Employer contribution.
        $ws->setCellValue('B'.($s + 1), 1)->setCellValue('C'.($s + 1), 'CPF Recovery')->setCellValue('D'.($s + 1), "=M{$grand}+N{$grand}");
        $ws->setCellValue('B'.($s + 2), 2)->setCellValue('C'.($s + 2), 'VPF Recovery')->setCellValue('D'.($s + 2), "=P{$grand}");
        $ws->setCellValue('B'.($s + 3), 3)->setCellValue('C'.($s + 3), 'Employers P F Contribution')->setCellValue('D'.($s + 3), "=Q{$grand}+R{$grand}");
        $ws->setCellValue('C'.($s + 5), 'TOTAL');
        $ws->setCellValue('D'.($s + 5), '=SUM(D'.($s + 1).':D'.($s + 3).')');
        $ws->getStyle('C'.($s + 5).':D'.($s + 5))->getFont()->setBold(true);
        if ($employerRule === null) {
            $ws->setCellValue('C'.($s + 6), 'Employer share (Pension / Employer contribution) not configured — confirm ASRTU CPF Trust rule.');
            $ws->getStyle('C'.($s + 6))->getFont()->setBold(true)->setItalic(true)->getColor()->setRGB('C00000');
        }
        $ws->setCellValue('A'.($s + 8), 'Put up for approval for remittance to ASRTU CPF Trust')->getStyle('A'.($s + 8))->getFont()->setBold(true);
        $ws->getStyle("E5:R{$grand}")->getNumberFormat()->setFormatCode('#,##0');
        $ws->getStyle("F5:F{$grand}")->getNumberFormat()->setFormatCode(SpreadsheetLayout::FORMAT_ID); // NCP DAYS: a day count, no separator
        SpreadsheetLayout::finish($ws, [
            'header_row' => 4, 'last_header_row' => $s, 'freeze' => 'D5', 'autofilter' => 'A4:R'.($grand - 1),
            'landscape' => true, 'fit_width' => true,
        ]);

        return $wb;
    }

    // ---------------------------------------------------------------- Division-wise

    /** A division / designation name as text: trimmed, inner whitespace collapsed; an id, a code or a blank is no name. */
    private static function cleanName(mixed $value): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', (string) $value));
        if ($text === '' || is_numeric($text) || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $text)) {
            return '';
        }

        return $text;
    }

    /** Division name of a payroll row: the name saved with the row for its month, else the Master division; '' when neither is a name. */
    public static function divisionName(array $row): string
    {
        $saved = self::cleanName($row['division_name'] ?? null);

        return $saved !== '' ? $saved : self::cleanName($row['_master']['division'] ?? null);
    }

    /** Case- and whitespace-insensitive identity of a division, so "Accounts " and "accounts" are one division. */
    public static function divisionKey(string $name): string
    {
        return mb_strtolower(self::cleanName($name));
    }

    /** @return list<string> the company's division names from Settings (their spelling is used when a saved name matches one) */
    public function settingsDivisionNames(string $companyId): array
    {
        return DB::table('cirt_divisions')->where('company_id', $companyId)->pluck('name')->map(fn ($n) => (string) $n)->all();
    }

    /**
     * Rows grouped by division: alphabetical (Unassigned last), spelling from Settings when it matches, else the first
     * saved spelling. Employees inside a division are in employee-code order, months chronological.
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  list<string>  $settingsNames
     * @return list<array{name: string, rows: list<array<string, mixed>>}>
     */
    private function divisionGroups(array $rows, array $settingsNames = []): array
    {
        $display = [];
        foreach ($settingsNames as $n) {
            $k = self::divisionKey($n);
            if ($k !== '') $display[$k] ??= self::cleanName($n);
        }
        $groups = [];
        foreach ($rows as $r) {
            $name = self::divisionName($r);
            $key = $name === '' ? '' : self::divisionKey($name);
            if ($key !== '') $display[$key] ??= $name;
            $groups['k'.$key][] = $r;
        }
        uksort($groups, fn ($a, $b) => ($a === 'k') <=> ($b === 'k') ?: strcmp($a, $b));
        $out = [];
        foreach ($groups as $key => $set) {
            usort($set, fn ($a, $b) => strnatcasecmp((string) ($a['_master']['employee_code'] ?? ''), (string) ($b['_master']['employee_code'] ?? ''))
                ?: strcmp((string) ($a['employee_user_id'] ?? ''), (string) ($b['employee_user_id'] ?? ''))
                ?: ($a['_ym'] ?? 0) <=> ($b['_ym'] ?? 0));
            $out[] = ['name' => $key === 'k' ? self::UNASSIGNED : $display[substr($key, 1)], 'rows' => $set];
        }

        return $out;
    }

    /**
     * Division-Wise Salary as data (preview and workbook read the same table): per division the employees, a subtotal row,
     * then a grand total. Whole rupees; every sum is an exact sum of the rounded lines. Fails loudly when the divisions do
     * not add up to the total of the rows given (gross, deductions, net, CPF, row count).
     *
     * @param  list<array<string, mixed>>  $rows  saved monthly payroll rows with _master / _user attached
     * @param  list<string>  $settingsNames  division names from Settings
     * @return array{headers: list<string>, rows: list<list<mixed>>, totals: list<mixed>, moneyColumns: list<int>, kinds: list<string>, divisions: array<string, array<string, float|int>>}
     */
    public function divisionWiseTable(array $rows, array $settingsNames = []): array
    {
        $headers = self::DIVISION_WISE_HEADERS;
        SpreadsheetLayout::assertHeaders($headers, 'Division-Wise Salary');
        $metrics = fn (array $r): array => [
            'gross' => self::n($r, 'total_earnings'), 'ded' => self::n($r, 'total_deductions'),
            'net' => self::n($r, 'net_salary'), 'cpf' => self::n($r, 'cpf_amount'),
            'dacpf' => \App\Support\PayrollTotals::daCpf($r), 'totalcpf' => \App\Support\PayrollTotals::totalCpf($r),
        ];
        $countText = function (array $set): string {
            $people = count(array_unique(array_map(fn ($r) => (string) ($r['employee_user_id'] ?? ''), $set)));
            $months = count(array_unique(array_map(fn ($r) => $r['_ym'] ?? 0, $set)));

            $who = $people === 1 ? '1 employee' : "{$people} employees";

            return $months > 1 ? "{$who}, ".count($set).' employee-months' : $who;
        };
        $out = [];
        $kinds = [];
        $divisions = [];
        $grand = ['gross' => 0.0, 'ded' => 0.0, 'net' => 0.0, 'cpf' => 0.0, 'dacpf' => 0.0, 'totalcpf' => 0.0, 'rows' => 0];
        foreach ($this->divisionGroups($rows, $settingsNames) as $g) {
            $sum = ['gross' => 0.0, 'ded' => 0.0, 'net' => 0.0, 'cpf' => 0.0, 'dacpf' => 0.0, 'totalcpf' => 0.0];
            foreach ($g['rows'] as $r) {
                $m = $r['_master'] ?? [];
                $u = $r['_user'] ?? [];
                $x = $metrics($r);
                foreach ($x as $k => $v) $sum[$k] += $v;
                $level = $r['pay_level'] ?? $m['pay_level'] ?? null;
                $designation = self::cleanName($r['designation_name'] ?? null) ?: self::cleanName($m['designation'] ?? null) ?: self::cleanName($u['designation'] ?? null);
                $ts = strtotime((string) ($r['month_year'] ?? ''));
                $out[] = [
                    $g['name'], (string) ($m['employee_code'] ?? ''), (string) ($m['name'] ?? $u['name'] ?? ''), $designation,
                    is_numeric($level) ? (int) $level : null, $ts ? date('F Y', $ts) : '', $ts ? (int) date('Y', $ts) : null, self::category($r),
                    $x['gross'], $x['ded'], $x['net'], $x['cpf'], $x['dacpf'], $x['totalcpf'],
                ];
                $kinds[] = 'detail';
            }
            $out[] = [$g['name'].' - Subtotal', '', $countText($g['rows']), '', null, '', null, '', $sum['gross'], $sum['ded'], $sum['net'], $sum['cpf'], $sum['dacpf'], $sum['totalcpf']];
            $kinds[] = 'subtotal';
            $divisions[$g['name']] = $sum + ['rows' => count($g['rows'])];
            foreach ($sum as $k => $v) $grand[$k] += $v;
            $grand['rows'] += count($g['rows']);
        }

        // The divisions must add up to the month total, taken straight from the rows (not from the groups).
        $direct = ['gross' => 0.0, 'ded' => 0.0, 'net' => 0.0, 'cpf' => 0.0, 'dacpf' => 0.0, 'totalcpf' => 0.0];
        foreach ($rows as $r) foreach ($metrics($r) as $k => $v) $direct[$k] += $v;
        foreach ($direct as $k => $v) {
            if (abs($v - $grand[$k]) > 0.004) {
                throw new \LogicException(sprintf('Division-Wise totals do not add up: divisions sum to %.2f but the payroll total is %.2f (%s).', $grand[$k], $v, $k));
            }
        }
        if ($grand['rows'] !== count($rows)) {
            throw new \LogicException("Division-Wise headcount does not add up: divisions list {$grand['rows']} rows but the payroll has ".count($rows).'.');
        }

        $totals = $rows === [] ? array_fill(0, count($headers), null)
            : ['Grand Total', '', $countText($rows), '', null, '', null, '', $grand['gross'], $grand['ded'], $grand['net'], $grand['cpf'], $grand['dacpf'], $grand['totalcpf']];

        return ['headers' => $headers, 'rows' => $out, 'totals' => $totals, 'moneyColumns' => self::DIVISION_WISE_MONEY, 'kinds' => $kinds, 'divisions' => $divisions];
    }

    /**
     * Division-Wise Salary workbook. Sheet 1 lists the employees under each real division (subtotals, grand total).
     * A single-month download also carries the monthly Division / Count / Pay Level summaries, with the real division names.
     *
     * @param  list<string>  $settingsNames
     */
    public function buildDivisionWise(array $rows, ?int $ym = null, array $settingsNames = []): Spreadsheet
    {
        $t = $this->divisionWiseTable($rows, $settingsNames);
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('Division-Wise');
        foreach ($t['headers'] as $i => $label) $ws->setCellValue([$i + 1, 1], $label);
        $line = 2;
        foreach ($t['rows'] as $n => $values) {
            $this->writeDivisionWiseRow($ws, $line, $values);
            if ($t['kinds'][$n] === 'subtotal') {
                $ws->getStyle("A{$line}:N{$line}")->getFont()->setBold(true);
                $ws->getStyle("A{$line}:N{$line}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('F2F2F2');
            }
            $line++;
        }
        if ($rows !== []) {
            $this->writeDivisionWiseRow($ws, $line, $t['totals']);
            $ws->getStyle("A{$line}:N{$line}")->getFont()->setBold(true);
            $ws->getStyle("A{$line}:N{$line}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('D9D9D9');
        }
        SpreadsheetLayout::finish($ws, [
            'header_row' => 1, 'freeze' => 'D2', 'landscape' => true, 'fit_width' => true,
            'text_columns' => ['B'], 'amount_columns' => array_map(fn ($i) => Coordinate::stringFromColumnIndex($i + 1), $t['moneyColumns']),
            'wrap_columns' => ['A', 'D'],
        ]);

        $months = array_values(array_unique(array_map(fn ($r) => $r['_ym'] ?? 0, $rows)));
        if (count($months) === 1) {
            $this->divisionSummarySheets($wb, $rows, $ym ?? $months[0], $settingsNames);
        }

        return $wb;
    }

    /** @param list<mixed> $values */
    private function writeDivisionWiseRow(Worksheet $ws, int $line, array $values): void
    {
        foreach ($values as $i => $v) {
            if ($v === null || $v === '') continue;
            if ($i === 1) $ws->setCellValueExplicit([$i + 1, $line], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
            else $ws->setCellValue([$i + 1, $line], $v);
        }
    }

    /**
     * The monthly Division / Count / Pay Level statements, one row per real division.
     *
     * @param  list<string>  $settingsNames
     */
    private function divisionSummarySheets(Spreadsheet $wb, array $rows, int $ym, array $settingsNames): void
    {
        $month = self::monthName($ym);
        $gross = $count = $cpf = $level = [];
        $divisions = [];
        foreach ($this->divisionGroups($rows, $settingsNames) as $g) {
            $div = $g['name'];
            $divisions[] = $div;
            foreach ($g['rows'] as $r) {
                $cat = self::category($r);
                $gross[$div][$cat] = ($gross[$div][$cat] ?? 0) + self::n($r, 'total_earnings');
                $count[$div][$cat] = ($count[$div][$cat] ?? 0) + 1;
                $cpf[$div][$cat === 'CONTRACT' ? 'CONTRACT' : 'CIRT'] = ($cpf[$div][$cat === 'CONTRACT' ? 'CONTRACT' : 'CIRT'] ?? 0) + self::n($r, 'cpf_amount');
                $grp = self::payGroup((int) ($r['pay_level'] ?? 0));
                if ($grp !== null) $level[$div][$grp][$cat] = ($level[$div][$grp][$cat] ?? 0) + self::n($r, 'total_earnings');
            }
        }

        // Sheet 2: Division (gross by category)
        $ws = $wb->createSheet()->setTitle('Division');
        $ws->setCellValue('A1', 'Salary Details for '.$month)->setCellValue('A2', 'Gross Salary');
        $this->sheetHeader($ws, 3, ['PARTICULAR', ...self::CATEGORIES, 'CPF EMPLOYER CONTR.']);
        $ws->setCellValue('H4', 'CIRT')->setCellValue('I4', 'CONTRACT');
        $ws->mergeCells('H3:I3'); // "CPF EMPLOYER CONTR." spans both sub-columns, so I3 is not a blank header
        $r0 = 5;
        foreach ($divisions as $i => $div) {
            $row = $r0 + $i;
            $ws->setCellValue("A{$row}", $div);
            foreach (self::CATEGORIES as $c => $cat) {
                $ws->setCellValue(Coordinate::stringFromColumnIndex($c + 2).$row, round($gross[$div][$cat] ?? 0, 2));
            }
            $ws->setCellValue("H{$row}", round($cpf[$div]['CIRT'] ?? 0, 2))->setCellValue("I{$row}", round($cpf[$div]['CONTRACT'] ?? 0, 2));
        }
        $last = $r0 + count($divisions) - 1;
        $tot = $last + 1;
        $ws->setCellValue("A{$tot}", 'TOTAL');
        foreach (range('B', 'I') as $col) $ws->setCellValue("{$col}{$tot}", "=SUM({$col}{$r0}:{$col}{$last})");
        $ws->setCellValue('A'.($tot + 1), 'GRAND TOTAL')->setCellValue('B'.($tot + 1), "=B{$tot}+C{$tot}+D{$tot}+E{$tot}+F{$tot}+G{$tot}");
        $ws->getStyle("A{$tot}:I".($tot + 1))->getFont()->setBold(true);
        $ws->getStyle("B{$r0}:I".($tot + 1))->getNumberFormat()->setFormatCode('#,##0');
        SpreadsheetLayout::finish($ws, ['header_row' => 3, 'last_header_row' => 4, 'freeze' => 'B5', 'landscape' => true, 'fit_width' => true, 'wrap_columns' => ['A']]);

        // Sheet 3: Count
        $cs = $wb->createSheet()->setTitle('Count');
        $cs->setCellValue('A2', 'NO OF EMPLOYEES WORKING IN CIRT FOR THE MONTH OF '.$month);
        $countCats = ['CIRT', 'ITI', 'CONSULTANT', 'CONTRACT'];
        $this->sheetHeader($cs, 4, ['PARTICULAR', 'CIRT', 'ITI/BOAT', 'CONSULTANT', 'CONTRACT']);
        foreach ($divisions as $i => $div) {
            $row = 5 + $i;
            $cs->setCellValue("A{$row}", $div);
            foreach ($countCats as $c => $cat) $cs->setCellValue(Coordinate::stringFromColumnIndex($c + 2).$row, $count[$div][$cat] ?? 0);
        }
        $cl = 4 + count($divisions);
        $cs->setCellValue('A'.($cl + 2), 'TOTAL');
        foreach (['B', 'C', 'D', 'E'] as $col) $cs->setCellValue("{$col}".($cl + 2), "=SUM({$col}5:{$col}{$cl})");
        $cs->getStyle('A'.($cl + 2).':E'.($cl + 2))->getFont()->setBold(true);
        SpreadsheetLayout::finish($cs, ['header_row' => 4, 'freeze' => 'B5', 'landscape' => true, 'fit_width' => true, 'wrap_columns' => ['A']]);

        // Sheet 4: Pay Level
        $ps = $wb->createSheet()->setTitle('Pay Level');
        $ps->setCellValue('A2', 'Salary Details for '.$month)->setCellValue('A4', 'Gross Salary');
        $this->sheetHeader($ps, 6, ['DIVISION', 'Group', ...array_slice(self::CATEGORIES, 0, 6)]);
        $row = 8;
        $divTotals = [];
        foreach ($divisions as $div) {
            $ps->setCellValue("A{$row}", $div);
            $firstRow = $row;
            foreach (array_keys(self::PAY_GROUPS) as $grp) {
                $ps->setCellValue("B{$row}", $grp);
                foreach (self::CATEGORIES as $c => $cat) $ps->setCellValue(Coordinate::stringFromColumnIndex($c + 3).$row, round($level[$div][$grp][$cat] ?? 0, 2));
                $row++;
            }
            $ps->setCellValue("B{$row}", 'TOTAL');
            foreach (range('C', 'H') as $col) $ps->setCellValue("{$col}{$row}", "=SUM({$col}{$firstRow}:{$col}".($row - 1).')');
            $ps->getStyle("B{$row}:H{$row}")->getFont()->setBold(true);
            $divTotals[] = $row;
            $row++;
        }
        $ps->setCellValue("A{$row}", 'TOTAL');
        foreach (range('C', 'H') as $col) $ps->setCellValue("{$col}{$row}", $divTotals === [] ? 0 : '='.implode('+', array_map(fn ($t) => "{$col}{$t}", $divTotals)));
        $ps->setCellValue('A'.($row + 1), 'GRAND TOTAL')->setCellValue('C'.($row + 1), "=C{$row}+D{$row}+E{$row}+F{$row}+G{$row}+H{$row}");
        $ps->getStyle("A{$row}:H".($row + 1))->getFont()->setBold(true);
        $ps->getStyle("C8:H".($row + 1))->getNumberFormat()->setFormatCode('#,##0');
        SpreadsheetLayout::finish($ps, ['header_row' => 6, 'last_header_row' => 7, 'freeze' => 'C8', 'landscape' => true, 'fit_width' => true, 'wrap_columns' => ['A']]);
    }


    // ---------------------------------------------------------------- TDS

    public const TDS_COLUMNS = [
        'EX_CODE', 'First Name', 'Middel Name', 'Last Name', 'PAN', 'Birth Date', 'Sex', 'Date of Joining', 'Designation',
        'Address1', 'Address2', 'Address3', 'Address4', 'Address5', 'Pin', 'State', 'Telephone no.', 'YYYYMM',
        'BASIC+DP', 'DA+DA ARRS', 'MEDICAL REIMBURSEMENT', 'SP PAY', 'FP PAY', 'MEDICAL', 'OT ALLOWANCE',
        'ENCASHMENT+ENCA DA', 'EX-GRATIA', 'HON+TUITION FEE+CASH', 'PERKS', 'WASH ALLOW', 'GRATUITY', 'INCENTIVE',
        'Total Arrears', 'HRA', 'Conveyance(Taxable)', 'Professional Tax', 'Provident Fund', 'Tax Deducted', 'Insurance',
        'Group Insurance', 'Conveyance', 'Washing Allowance', 'Leave Encashment',
    ];

    /** Index of the first money column (BASIC+DP); the identity columns A..R (through YYYYMM) come before it. */
    public const TDS_FIRST_MONEY = 18;

    /** @return array{0: string, 1: string, 2: string} first, middle, last */
    public static function splitName(string $full): array
    {
        $parts = preg_split('/\s+/', trim($full), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($parts) <= 1) return [$parts[0] ?? '', '', ''];

        return [$parts[0], implode(' ', array_slice($parts, 1, -1)), $parts[count($parts) - 1]];
    }

    /** @return list<float|string|null> the 43 TDS values of one monthly row (same order as TDS_COLUMNS) */
    public function tdsValues(array $r): array
    {
        $m = $r['_master'];
        $u = $r['_user'];
        [$f, $mid, $l] = self::splitName((string) ($m['name'] ?? $u['name'] ?? ''));
        // Whole-day serial built in UTC: strtotime() under Asia/Kolkata gave a fractional serial that displayed a day early.
        $date = fn ($d) => SpreadsheetLayout::toExcelDate($d);
        $remainderGross = 0.0; // Gross Arrears = DA + TR: nothing is recorded beyond the two arrear lines
        $custom = array_fill_keys(array_values(self::TDS_CUSTOM_COLUMNS) + [self::TDS_CUSTOM_FALLBACK => self::TDS_CUSTOM_FALLBACK], 0.0);
        foreach (self::customBag($r, 'custom_earnings') as $key => $value) {
            $custom[self::TDS_CUSTOM_COLUMNS[$key] ?? self::TDS_CUSTOM_FALLBACK] = ($custom[self::TDS_CUSTOM_COLUMNS[$key] ?? self::TDS_CUSTOM_FALLBACK] ?? 0.0) + $value;
        }

        return [
            $m['employee_code'] ?? '', $f, $mid, $l, $m['pan'] ?? '', $date($m['date_of_birth'] ?? $u['date_of_birth'] ?? null),
            strtoupper(substr((string) ($m['gender'] ?? $u['gender'] ?? ''), 0, 1)), $date($m['date_of_joining'] ?? $u['date_of_joining'] ?? null),
            $m['designation'] ?? '', $u['current_address_line1'] ?? '', $u['current_address_line2'] ?? '', $u['current_city'] ?? '',
            $u['current_state'] ?? '', $u['current_country'] ?? '', $u['current_postal_code'] ?? '', $u['current_state'] ?? '',
            $m['phone'] ?? $u['phone'] ?? '', $r['_ym'],
            self::n($r, 'basic_paid'), self::n($r, 'da_paid') + self::n($r, 'da_arrears_paid'), null, self::n($r, 'sp_pay_paid'), null,
            self::n($r, 'medical_paid'), self::n($r, 'extra_work_allowance_paid') + $custom['OT ALLOWANCE'],
            self::n($r, 'encashment_paid') + self::n($r, 'encashment_da_paid') + $custom['ENCASHMENT+ENCA DA'], null, self::n($r, 'education_allowance_paid'), $custom[self::TDS_CUSTOM_FALLBACK] ?: null,
            self::n($r, 'uniform_allowance_paid'), null, null,
            // DA arrears already sit in DA+DA ARRS, so Total Arrears = transport arrears + the gross-only remainder.
            self::n($r, 'transport_arrears_paid') + $remainderGross + $custom['Total Arrears'],
            self::n($r, 'hra_paid'), self::n($r, 'transport_paid'), self::n($r, 'pt_amount'),
            self::n($r, 'cpf_amount') + self::n($r, 'vpf_amount'), self::n($r, 'income_tax_amount'), self::n($r, 'lic_amount'),
            null, null, null, null,
        ];
    }

    /**
     * TDS Data as data (preview and workbook). The 44 TDS columns are unchanged; with $extras the
     * multi-period columns follow them, each total beside the fields it sums:
     * Month | Year | custom EARNINGS | Total Earnings | custom DEDUCTIONS | Total Deductions | Net Pay
     * (the SAVED row's totals), and a totals row. tdsExtraLayout() is the one definition of that order for
     * both the preview and the workbook. Every row's totals are cross-checked (422 when earnings -
     * deductions is not net or the lines do not add up).
     *
     * @param  array{earnings: array<string, string>, deductions: array<string, string>}|null  $extras
     * @return array{headers: list<string>, rows: list<list<mixed>>, totals: list<mixed>, moneyColumns: list<int>}
     */
    public function tdsTable(array $rows, ?array $extras = null): array
    {
        $headers = self::TDS_COLUMNS;
        $base = count(self::TDS_COLUMNS);
        $money = range(self::TDS_FIRST_MONEY, $base - 1);
        $layout = $extras === null ? [] : self::tdsExtraLayout($extras);
        if ($extras !== null) {
            $headers = array_merge($headers, array_column($layout, 'label'));
            $money = array_merge($money, range($base + 2, count($headers) - 1)); // after Month and Year
        }
        SpreadsheetLayout::assertHeaders($headers, 'TDS Data');
        $table = [];
        $sums = array_fill_keys($money, 0.0);
        foreach ($rows as $r) {
            if ($extras !== null) {
                \App\Support\PayrollExportTotals::assertConsistent($r, trim(((string) ($r['_master']['employee_code'] ?? '')).' '.date('F Y', strtotime((string) $r['month_year']))));
            }
            $values = $this->tdsValues($r);
            if ($extras !== null) {
                $earn = self::customBag($r, 'custom_earnings');
                $ded = self::customBag($r, 'custom_deductions');
                foreach ($layout as $col) {
                    $values[] = match ($col['kind']) {
                        'month' => date('F Y', strtotime((string) $r['month_year'])),
                        'year' => (int) date('Y', strtotime((string) $r['month_year'])),
                        'earning' => array_key_exists($col['key'], $earn) ? $earn[$col['key']] : null,
                        'deduction' => array_key_exists($col['key'], $ded) ? $ded[$col['key']] : null,
                        'total_earnings' => self::n($r, 'total_earnings'),
                        'total_deductions' => self::n($r, 'total_deductions'),
                        'net' => self::n($r, 'net_salary'),
                    };
                }
            }
            foreach ($money as $i) {
                if (isset($values[$i]) && is_numeric($values[$i])) $sums[$i] += (float) $values[$i];
            }
            $table[] = $values;
        }
        $totals = array_fill(0, count($headers), null);
        if ($table !== []) {
            $totals[0] = 'TOTAL';
            foreach ($sums as $i => $sum) $totals[$i] = round($sum, 2);
        }

        return ['headers' => $headers, 'rows' => $table, 'totals' => $totals, 'moneyColumns' => $money];
    }

    /**
     * The one definition of the columns that follow the 44 TDS columns (preview and Excel both read it).
     * A custom field named like a fixed column gets "(Custom)" so headers stay unambiguous.
     *
     * @param  array{earnings: array<string, string>, deductions: array<string, string>}  $extras  field_key => label
     * @return list<array{label: string, kind: string, key?: string}>
     */
    public static function tdsExtraLayout(array $extras): array
    {
        $taken = array_merge(self::TDS_COLUMNS, ['Month', 'Year', 'Total Earnings', 'Total Deductions', 'Net Pay']);
        $unique = function (string $label) use (&$taken): string {
            $label = SpreadsheetLayout::safeHeader($label, 'Custom Field');
            if (in_array($label, $taken, true)) $label .= ' (Custom)';
            $taken[] = $label;

            return $label;
        };
        $layout = [['label' => 'Month', 'kind' => 'month'], ['label' => 'Year', 'kind' => 'year']];
        foreach ($extras['earnings'] as $key => $label) $layout[] = ['label' => $unique((string) $label), 'kind' => 'earning', 'key' => (string) $key];
        $layout[] = ['label' => 'Total Earnings', 'kind' => 'total_earnings'];
        foreach ($extras['deductions'] as $key => $label) $layout[] = ['label' => $unique((string) $label), 'kind' => 'deduction', 'key' => (string) $key];
        $layout[] = ['label' => 'Total Deductions', 'kind' => 'total_deductions'];
        $layout[] = ['label' => 'Net Pay', 'kind' => 'net'];

        return $layout;
    }

    /** @param array{earnings: array<string, string>, deductions: array<string, string>}|null $extras */
    public function buildTds(array $rows, ?array $extras = null): Spreadsheet
    {
        $t = $this->tdsTable($rows, $extras);
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('TDS_DATA');
        // Row 1 is the header row (the old ADD1..US103 code row is gone); data starts in row 2.
        foreach ($t['headers'] as $i => $label) $ws->setCellValue([$i + 1, 1], $label);
        $lastCol = Coordinate::stringFromColumnIndex(count($t['headers']));
        $ws->getStyle('A1:'.$lastCol.'1')->getFont()->setBold(true);
        $line = 2;
        foreach ($t['rows'] as $values) {
            foreach ($values as $i => $v) {
                if ($v === null || $v === '') continue;
                if (in_array($i, [0, 4, 14, 16], true)) { // EX_CODE, PAN, Pin, Telephone: identifiers stay text
                    $ws->setCellValueExplicit([$i + 1, $line], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                } else {
                    $ws->setCellValue([$i + 1, $line], $v);
                }
            }
            $line++;
        }
        $lastData = $line - 1;
        // YYYYMM and Year get format '0' from SpreadsheetLayout::finish() (header-based identifier rule): no thousands separator.
        if ($extras !== null && $t['rows'] !== []) {
            // Totals row: real numeric cells, bold, outside the filter range so sorting never moves it.
            foreach ($t['totals'] as $i => $v) {
                if ($v === null || $v === '') continue;
                $ws->setCellValue([$i + 1, $line], $v);
            }
            $ws->getStyle('A'.$line.':'.$lastCol.$line)->getFont()->setBold(true);
        }
        SpreadsheetLayout::finish($ws, [
            // Freeze the header row and the identity columns A..D (EX_CODE + the three name columns).
            'header_row' => 1, 'freeze' => 'E2', 'autofilter' => $extras === null ? true : 'A1:'.$lastCol.max(1, $lastData),
            'date_columns' => ['F' => SpreadsheetLayout::FORMAT_DATE_US, 'H' => SpreadsheetLayout::FORMAT_DATE_US],
            'text_columns' => ['A', 'E', 'O', 'Q'], 'amount_columns' => array_map(fn ($i) => Coordinate::stringFromColumnIndex($i + 1), $t['moneyColumns']),
            'wrap_columns' => ['I', 'J', 'K', 'L', 'M', 'N'],
        ]);

        return $wb;
    }

    // ---------------------------------------------------------------- Paybill

    public function buildPaybill(array $rows, int $ym): Spreadsheet
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('Paybill');
        $headers = ['Sr', 'Name', 'Emp.Code', 'CPF No.', 'P Level', 'Basic @', ...array_keys(self::PAYBILL_EARNINGS), ...array_keys(self::PAYBILL_DEDUCTIONS), 'Total Pay', 'Total Deduction', 'Net Pay', 'Remark'];
        $ws->setCellValue('A1', 'C.I.R.T., PUNE 411 026   Salary for '.strtoupper(self::monthName($ym)));
        $ws->getStyle('A1')->getFont()->setBold(true);
        $this->sheetHeader($ws, 3, $headers);
        $line = 4;
        foreach ($rows as $i => $r) {
            $m = $r['_master'];
            $vals = [$i + 1, $m['name'] ?? '', $m['employee_code'] ?? '', (string) ($m['cpf_no'] ?? ''),(int) ($r['pay_level'] ?? 0), self::n($r, 'basic_actual')];
            foreach ([...self::PAYBILL_EARNINGS, ...self::PAYBILL_DEDUCTIONS] as $keys) {
                $vals[] = $keys === null ? null : round(self::sum($r, $keys), 2);
            }
            array_push($vals, self::n($r, 'total_earnings'), self::n($r, 'total_deductions'), self::n($r, 'net_salary'), $r['leave_remarks'] ?? '');
            foreach ($vals as $c => $v) {
                if ($v === null || $v === '') continue;
                if ($c === 2 || $c === 3) $ws->setCellValueExplicit([$c + 1, $line], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING); // Emp.Code and CPF No. stay text
                else $ws->setCellValue([$c + 1, $line], $v);
            }
            $line++;
        }
        $ws->getStyle('F4:'.Coordinate::stringFromColumnIndex(count($headers) - 1).($line))->getNumberFormat()->setFormatCode(SpreadsheetLayout::FORMAT_AMOUNT);
        SpreadsheetLayout::finish($ws, [
            'header_row' => 3, 'freeze' => 'C4', 'autofilter' => true, 'landscape' => true, 'fit_width' => true,
            'wrap_columns' => [Coordinate::stringFromColumnIndex(count($headers))],
        ]);

        // Optional print-style sheet: the three-line block per employee of the legacy paybill.
        $ps = $wb->createSheet()->setTitle('Print');
        $p = 1;
        foreach ($rows as $i => $r) {
            $m = $r['_master'];
            $ps->setCellValue("A{$p}", 'C.I.R.T., PUNE 411 026')->setCellValue("H{$p}", 'Salary for '.strtoupper(self::monthName($ym)));
            $p++;
            $ps->setCellValue("A{$p}", ($i + 1).' '.($m['name'] ?? ''))->setCellValue("H{$p}", 'Emp.Code '.($m['employee_code'] ?? '').'  CPF No.: '.($m['cpf_no'] ?? ''))->setCellValue('K'.$p, 'P_LEVEL : '.(int) ($r['pay_level'] ?? 0));
            $p++;
            foreach ([array_keys(self::PAYBILL_EARNINGS), array_keys(self::PAYBILL_DEDUCTIONS)] as $set) {
                foreach (array_chunk($set, 15) as $chunk) {
                    foreach ($chunk as $c => $label) {
                        $ps->setCellValue([$c + 1, $p], $label);
                        $keys = (self::PAYBILL_EARNINGS + self::PAYBILL_DEDUCTIONS)[$label] ?? null;
                        $ps->setCellValue([$c + 1, $p + 1], $keys === null ? 0 : round(self::sum($r, $keys), 2));
                    }
                    $ps->getStyle("A{$p}:O{$p}")->getFont()->setBold(true);
                    $p += 2;
                }
            }
            $ps->setCellValue("A{$p}", 'Total Pay-'.round(self::n($r, 'total_earnings')).'  Total Deduction-'.round(self::n($r, 'total_deductions'), 2).'  Net Pay - '.round(self::n($r, 'net_salary'), 2));
            $p += 2;
        }

        SpreadsheetLayout::finish($ps, ['header_row' => 1, 'landscape' => true, 'fit_width' => true]);

        return $wb;
    }
}
