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

    /** Report division => lower-case keywords found in the Master division name. UNCONFIRMED mapping; first match wins. */
    public const DIVISION_KEYWORDS = [
        'BNCAP' => ['ncap'],
        'CYBERSECURITY' => ['cyber'],
        'SHD' => ['safety', 'saftey', 'homolog'],
        'TRNG/MDC' => ['developement', 'development', 'training', 'mdc'],
        'CONSULTANCY' => ['consultancy'],
        'ERC' => ['automotive testing', 'erc', 'technical directorate'],
        'ADMINSTRAION' => ['admin', 'accounts', "director's office", 'ministry', 'utility', 'vehicle maint', 'horticulture', 'road safety cell'],
    ];

    /** Row order and spelling of the Division sheet in the sample (including its own spellings). */
    public const DIVISION_ROWS = ['ERC', 'SHD', 'BNCAP', 'CYBERSECURITY', 'TRNG/MDC', 'CONSULTANCY', 'ADMINSTRAION'];

    public const UNMAPPED = 'OTHER / UNMAPPED';

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
        PayrollLabels::CPF_ARREARS => ['da_cpf_amount', 'cpf_arrear'], 'Lib.' => null, 'Union' => null,
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
        return is_numeric($row[$key] ?? null) ? (float) $row[$key] : 0.0;
    }

    /** Custom (company-defined) field amounts of a monthly row; the bag is JSON text, [] or an object. @return array<string, float> */
    public static function customBag(array $row, string $column): array
    {
        $bag = $row[$column] ?? null;
        if (is_string($bag)) $bag = json_decode($bag, true);
        $out = [];
        foreach (is_array($bag) ? $bag : [] as $key => $value) {
            if (is_string($key) && is_numeric($value)) $out[$key] = (float) $value;
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

        return $da + $tr + max(0.0, self::n($row, 'gross_arrear') - $da - $tr);
    }

    private static function sum(array $row, array $keys): float
    {
        if (($keys[0] ?? '') === '@arrears') return round(self::arrearsTotal($row), 2);
        if (($keys[0] ?? '') === '@custom_earnings') return round(array_sum(self::customBag($row, 'custom_earnings')), 2);
        if (($keys[0] ?? '') === '@custom_deductions') return round(array_sum(self::customBag($row, 'custom_deductions')), 2);
        return array_sum(array_map(fn ($k) => self::n($row, $k), $keys));
    }

    public static function reportDivision(?string $masterDivision): string
    {
        $name = mb_strtolower(trim((string) $masterDivision));
        foreach (self::DIVISION_KEYWORDS as $division => $words) {
            foreach ($words as $w) {
                if ($name !== '' && str_contains($name, $w)) return $division;
            }
        }

        return self::UNMAPPED;
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

    private function sheetHeader(Worksheet $ws, int $row, array $headers): void
    {
        foreach ($headers as $i => $h) {
            $ws->setCellValue([$i + 1, $row], $h);
        }
        $range = 'A'.$row.':'.Coordinate::stringFromColumnIndex(count($headers)).$row;
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

    public function buildCpf(array $rows, int $ym): Spreadsheet
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('Sheet1');
        $ws->setCellValue('A1', self::INSTITUTE)->mergeCells('A1:P1');
        $ws->setCellValue('A2', 'Details of CPF, VPF, etc. for the month '.self::monthName($ym))->mergeCells('A2:P2');
        $ws->getStyle('A1:A2')->getFont()->setBold(true)->setSize(12);
        $ws->getStyle('A1:A2')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
        $this->sheetHeader($ws, 4, ['SR NO', 'UAN', 'NAME AS PER UAN', 'CPF  NO', 'GBASIC', 'NCP DAYS', 'BASIC', 'DA', 'HRA', 'TPT', 'MEDICAL', 'Total', 'CPF', 'VPF', 'PENSION', 'EMP_ CONTR.']);

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
                $ws->setCellValue("A{$line}", $sr++);
                $ws->setCellValueExplicit("B{$line}", (string) ($m['uan'] ?? ''), \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                $ws->setCellValue("C{$line}", $m['name'] ?? '');
                $ws->setCellValueExplicit("D{$line}", (string) ($m['cpf_no'] ?? ''), \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                foreach ([
                    'E' => self::n($r, 'basic_actual'), 'F' => self::n($r, 'unpaid_days'), 'G' => self::n($r, 'basic_paid'),
                    'H' => self::n($r, 'da_paid'), 'I' => self::n($r, 'hra_paid'), 'J' => self::n($r, 'transport_paid'),
                    'K' => self::n($r, 'medical_paid'), 'L' => $basis, 'M' => self::n($r, 'cpf_amount'), 'N' => self::n($r, 'vpf_amount'),
                ] as $col => $v) {
                    $ws->setCellValue("{$col}{$line}", $v);
                }
                $line++;
            }
            $last = $line - 1;
            $ws->setCellValue('B'.$line, $name.' TOTAL');
            foreach (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as $col) {
                $ws->setCellValue("{$col}{$line}", $last >= $first ? "=SUBTOTAL(109,{$col}{$first}:{$col}{$last})" : 0);
            }
            $ws->getStyle("A{$line}:P{$line}")->getFont()->setBold(true);
            $totalRows[] = $line;
            $line += 2;
        }
        $grand = $line - 1;
        $ws->setCellValue('C'.$grand, 'GRAND TOTAL');
        foreach (['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as $col) {
            $ws->setCellValue("{$col}{$grand}", "={$col}{$totalRows[0]}+{$col}{$totalRows[1]}");
        }
        $ws->getStyle("A{$grand}:P{$grand}")->getFont()->setBold(true);
        $s = $grand + 3;
        $this->sheetHeader($ws, $s, ['', 'SL', 'PARTICULAR', 'AMOUNT']);
        $ws->setCellValue('B'.($s + 1), 1)->setCellValue('C'.($s + 1), 'Employers P F Contribution')->setCellValue('D'.($s + 1), "=M{$grand}");
        $ws->setCellValue('B'.($s + 2), 2)->setCellValue('C'.($s + 2), 'CPF Recovery')->setCellValue('D'.($s + 2), "=O{$grand}+P{$grand}");
        $ws->setCellValue('B'.($s + 3), 3)->setCellValue('C'.($s + 3), 'VPF Recovery')->setCellValue('D'.($s + 3), "=N{$grand}");
        $ws->setCellValue('C'.($s + 5), 'TOTAL')->setCellValue('D'.($s + 5), 'SUM(D'.($s + 1).':D'.($s + 4).')');
        $ws->setCellValue('D'.($s + 5), '=SUM(D'.($s + 1).':D'.($s + 4).')');
        $ws->getStyle('C'.($s + 5).':D'.($s + 5))->getFont()->setBold(true);
        $ws->setCellValue('A'.($s + 7), 'Put up for approval for remittance to ASRTU CPF Trust')->getStyle('A'.($s + 7))->getFont()->setBold(true);
        $ws->getStyle("E5:P{$grand}")->getNumberFormat()->setFormatCode('#,##0');
        SpreadsheetLayout::finish($ws, [
            'header_row' => 4, 'last_header_row' => $s, 'freeze' => 'D5', 'autofilter' => 'A4:P'.($grand - 1),
            'landscape' => true, 'fit_width' => true,
        ]);

        return $wb;
    }

    // ---------------------------------------------------------------- Division-wise

    public function buildDivisionWise(array $rows, int $ym): Spreadsheet
    {
        $month = self::monthName($ym);
        $gross = $count = $cpf = $level = [];
        $unmapped = [];
        foreach ($rows as $r) {
            $mDiv = (string) ($r['_master']['division'] ?? '');
            $div = self::reportDivision($mDiv);
            if ($div === self::UNMAPPED) $unmapped[$mDiv === '' ? '(blank)' : $mDiv] = true;
            $cat = self::category($r);
            $gross[$div][$cat] = ($gross[$div][$cat] ?? 0) + self::n($r, 'total_earnings');
            $count[$div][$cat] = ($count[$div][$cat] ?? 0) + 1;
            $cpf[$div][$cat === 'CONTRACT' ? 'CONTRACT' : 'CIRT'] = ($cpf[$div][$cat === 'CONTRACT' ? 'CONTRACT' : 'CIRT'] ?? 0) + self::n($r, 'cpf_amount');
            $grp = self::payGroup((int) ($r['pay_level'] ?? 0));
            if ($grp !== null) $level[$div][$grp][$cat] = ($level[$div][$grp][$cat] ?? 0) + self::n($r, 'total_earnings');
        }
        $divisions = self::DIVISION_ROWS;
        if ($unmapped !== []) $divisions[] = self::UNMAPPED;

        $wb = new Spreadsheet;
        // Sheet 1: Division
        $ws = $wb->getActiveSheet()->setTitle('Division');
        $ws->setCellValue('A1', 'Salary Details for '.$month)->setCellValue('A2', 'Gross Salary');
        $this->sheetHeader($ws, 3, ['PARTICULAR', ...self::CATEGORIES, 'CPF EMPLOYER CONTR.']);
        $ws->setCellValue('H4', 'CIRT')->setCellValue('I4', 'CONTRACT');
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
        if ($unmapped !== []) {
            $ws->setCellValue('A'.($tot + 3), 'Unmapped Master divisions (no report group configured): '.implode('; ', array_keys($unmapped)));
        }
        SpreadsheetLayout::finish($ws, ['header_row' => 3, 'last_header_row' => 4, 'freeze' => 'B5', 'landscape' => true, 'fit_width' => true]);

        // Sheet 2: Count
        $cs = $wb->createSheet()->setTitle('Count');
        $cs->setCellValue('A2', 'NO OF EMPLOYEES WORKING IN CIRT FOR THE MONTH OF '.$month);
        $countCats = ['CIRT', 'ITI', 'CONSULTANT', 'CONTRACT'];
        $this->sheetHeader($cs, 4, ['PARTICULAR', 'CIRT', 'ITI/BOAT', 'CONSULTANT', 'CONTRACT']);
        $countDivs = ['ERC', 'SHD', 'BNCAP', 'TRNG/MDC', 'CONSULTANCY', 'ADMINSTRAION', 'CYBERSECURITY'];
        if ($unmapped !== []) $countDivs[] = self::UNMAPPED;
        foreach ($countDivs as $i => $div) {
            $row = 5 + $i;
            $cs->setCellValue("A{$row}", $div);
            foreach ($countCats as $c => $cat) $cs->setCellValue(Coordinate::stringFromColumnIndex($c + 2).$row, $count[$div][$cat] ?? 0);
        }
        $cl = 4 + count($countDivs);
        $cs->setCellValue('A'.($cl + 2), 'TOTAL');
        foreach (['B', 'C', 'D', 'E'] as $col) $cs->setCellValue("{$col}".($cl + 2), "=SUM({$col}5:{$col}{$cl})");
        $cs->getStyle('A'.($cl + 2).':E'.($cl + 2))->getFont()->setBold(true);
        SpreadsheetLayout::finish($cs, ['header_row' => 4, 'freeze' => 'B5', 'landscape' => true, 'fit_width' => true]);

        // Sheet 3: Pay Level
        $ps = $wb->createSheet()->setTitle('Pay Level');
        $ps->setCellValue('A2', 'Salary Details for '.$month)->setCellValue('A4', 'Gross Salary');
        $this->sheetHeader($ps, 6, ['DIVISION', 'Group', ...array_slice(self::CATEGORIES, 0, 6)]);
        $plDivs = ['ERC', 'SHD', 'TRNG/MDC', 'CONSULTANCY', 'ADMINSTRAION', 'BNCAP', 'CYBERSECURITY'];
        if ($unmapped !== []) $plDivs[] = self::UNMAPPED;
        $row = 8;
        $divTotals = [];
        foreach ($plDivs as $div) {
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
        foreach (range('C', 'H') as $col) $ps->setCellValue("{$col}{$row}", '='.implode('+', array_map(fn ($t) => "{$col}{$t}", $divTotals)));
        $ps->setCellValue('A'.($row + 1), 'GRAND TOTAL')->setCellValue('C'.($row + 1), "=C{$row}+D{$row}+E{$row}+F{$row}+G{$row}+H{$row}");
        $ps->getStyle("A{$row}:H".($row + 1))->getFont()->setBold(true);
        $ps->getStyle("C8:H".($row + 1))->getNumberFormat()->setFormatCode('#,##0');
        SpreadsheetLayout::finish($ps, ['header_row' => 6, 'last_header_row' => 7, 'freeze' => 'C8', 'landscape' => true, 'fit_width' => true]);

        return $wb;
    }

    // ---------------------------------------------------------------- TDS

    public const TDS_COLUMNS = [
        'EX_CODE', 'First Name', 'Middel Name', 'Last Name', 'PAN', 'Birth Date', 'Sex', 'Date of Joining', 'Designation',
        'Address1', 'Address2', 'Address3', 'Address4', 'Address5', 'Pin', 'State', 'Telephone no.', 'YYYYMM',
        'BASIC+DP', 'DA+DA ARRS', 'MEDICAL REIMBURSEMENT', 'SP PAY', 'FP PAY', 'MEDICAL', 'OT ALLOWANCE', '0',
        'ENCASHMENT+ENCA DA', 'EX-GRATIA', 'HON+TUITION FEE+CASH', 'PERKS', 'WASH ALLOW', 'GRATUITY', 'INCENTIVE',
        'Total Arrears', 'HRA', 'Conveyance(Taxable)', 'Professional Tax', 'Provident Fund', 'Tax Deducted', 'Insurance',
        'Group Insurance', 'Conveyance', 'Washing Allowance', 'Leave Encashment',
    ];

    /** Row-1 labels over columns S.. (ADD1..ADD15, TR, HRA, CT, PT, PF, TDS, DED1, GI, US101, US102, US103). */
    public const TDS_TOP = ['ADD1', 'ADD2', 'ADD3', 'ADD4', 'ADD5', 'ADD6', 'ADD7', 'ADD8', 'ADD9', 'ADD10', 'ADD11', 'ADD12', 'ADD13', 'ADD14', 'ADD15', 'TR', 'HRA', 'CT', 'PT', 'PF', 'TDS', 'DED1', 'GI', 'US101', 'US102', 'US103'];

    /** @return array{0: string, 1: string, 2: string} first, middle, last */
    public static function splitName(string $full): array
    {
        $parts = preg_split('/\s+/', trim($full), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($parts) <= 1) return [$parts[0] ?? '', '', ''];

        return [$parts[0], implode(' ', array_slice($parts, 1, -1)), $parts[count($parts) - 1]];
    }

    /** @return list<float|string|null> the 44 TDS values of one monthly row */
    public function tdsValues(array $r): array
    {
        $m = $r['_master'];
        $u = $r['_user'];
        [$f, $mid, $l] = self::splitName((string) ($m['name'] ?? $u['name'] ?? ''));
        // Whole-day serial built in UTC: strtotime() under Asia/Kolkata gave a fractional serial that displayed a day early.
        $date = fn ($d) => SpreadsheetLayout::toExcelDate($d);
        $remainderGross = max(0.0, self::n($r, 'gross_arrear') - self::n($r, 'da_arrears_paid') - self::n($r, 'transport_arrears_paid'));
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
            self::n($r, 'medical_paid'), self::n($r, 'extra_work_allowance_paid') + $custom['OT ALLOWANCE'], 0.0,
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
     * multi-period columns follow them: Month, Year, one column per custom earning / deduction, then
     * Total Earnings, Total Deductions and Net Pay of the SAVED row, and a totals row. Every row's totals
     * are cross-checked (422 when earnings - deductions is not net or the lines do not add up).
     *
     * @param  array{earnings: array<string, string>, deductions: array<string, string>}|null  $extras
     * @return array{headers: list<string>, rows: list<list<mixed>>, totals: list<mixed>, moneyColumns: list<int>}
     */
    public function tdsTable(array $rows, ?array $extras = null): array
    {
        $headers = self::TDS_COLUMNS;
        $money = range(18, 43);
        if ($extras !== null) {
            $headers = array_merge($headers, ['Month', 'Year'], array_values($extras['earnings']), array_values($extras['deductions']), ['Total Earnings', 'Total Deductions', 'Net Pay']);
            $money = array_merge($money, range(46, count($headers) - 1));
        }
        $table = [];
        $sums = array_fill_keys($money, 0.0);
        foreach ($rows as $r) {
            if ($extras !== null) {
                \App\Support\PayrollExportTotals::assertConsistent($r, trim(((string) ($r['_master']['employee_code'] ?? '')).' '.date('F Y', strtotime((string) $r['month_year']))));
            }
            $values = $this->tdsValues($r);
            if ($extras !== null) {
                $values[] = date('F Y', strtotime((string) $r['month_year']));
                $values[] = (int) date('Y', strtotime((string) $r['month_year']));
                $earn = self::customBag($r, 'custom_earnings');
                $ded = self::customBag($r, 'custom_deductions');
                foreach (array_keys($extras['earnings']) as $k) $values[] = array_key_exists($k, $earn) ? $earn[$k] : null;
                foreach (array_keys($extras['deductions']) as $k) $values[] = array_key_exists($k, $ded) ? $ded[$k] : null;
                $values[] = self::n($r, 'total_earnings');
                $values[] = self::n($r, 'total_deductions');
                $values[] = self::n($r, 'net_salary');
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

    /** @param array{earnings: array<string, string>, deductions: array<string, string>}|null $extras */
    public function buildTds(array $rows, ?array $extras = null): Spreadsheet
    {
        $t = $this->tdsTable($rows, $extras);
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('TDS_DATA');
        foreach (self::TDS_TOP as $i => $label) $ws->setCellValue([19 + $i, 1], $label);
        foreach ($t['headers'] as $i => $label) $ws->setCellValue([$i + 1, 2], $label);
        $lastCol = Coordinate::stringFromColumnIndex(count($t['headers']));
        $ws->getStyle('A1:'.$lastCol.'2')->getFont()->setBold(true);
        $line = 3;
        foreach ($t['rows'] as $values) {
            foreach ($values as $i => $v) {
                if ($v === null || $v === '') continue;
                if (in_array($i, [4, 14, 16], true)) {
                    $ws->setCellValueExplicit([$i + 1, $line], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                } else {
                    $ws->setCellValue([$i + 1, $line], $v);
                }
            }
            $line++;
        }
        $lastData = $line - 1;
        if ($line > 3) $ws->getStyle('R3:R'.$lastData)->getNumberFormat()->setFormatCode('0'); // YYYYMM: no thousands separator
        if ($extras !== null && $t['rows'] !== []) {
            // Totals row: real numeric cells, bold, outside the filter range so sorting never moves it.
            foreach ($t['totals'] as $i => $v) {
                if ($v === null || $v === '') continue;
                $ws->setCellValue([$i + 1, $line], $v);
            }
            $ws->getStyle('A'.$line.':'.$lastCol.$line)->getFont()->setBold(true);
        }
        SpreadsheetLayout::finish($ws, [
            'header_row' => 2, 'freeze' => 'B3', 'autofilter' => $extras === null ? true : 'A2:'.$lastCol.max(2, $lastData),
            'date_columns' => ['F' => SpreadsheetLayout::FORMAT_DATE_US, 'H' => SpreadsheetLayout::FORMAT_DATE_US],
            'text_columns' => ['E', 'O', 'Q'], 'amount_columns' => array_map(fn ($i) => Coordinate::stringFromColumnIndex($i + 1), $t['moneyColumns']),
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
                if ($c === 3) $ws->setCellValueExplicit([$c + 1, $line], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING); // CPF No. stays text
                else $ws->setCellValue([$c + 1, $line], $v);
            }
            $line++;
        }
        $ws->getStyle('F4:'.Coordinate::stringFromColumnIndex(count($headers) - 1).($line))->getNumberFormat()->setFormatCode('#,##0.00');
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
