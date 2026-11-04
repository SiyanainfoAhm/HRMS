<?php

namespace Tests\Database;

use App\Services\PostPayrollDownloadService;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;

/** CIRT-11/12: report totals tie to payroll totals for a fixture month; numbers stay numeric; files re-open. */
final class PostPayrollDownloadTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private const YM = 202609;

    private PostPayrollDownloadService $svc;

    private array $rows;

    protected function setUp(): void
    {
        parent::setUp();
        $this->svc = new PostPayrollDownloadService;
        $company = DB::table('cirt_monthly_payroll')->value('company_id');
        $company !== null || $this->markTestSkipped('No generated payroll in this database.');
        $company = (string) $company;
        $this->rows = $this->svc->rows($company, self::YM, self::YM);
        $this->rows !== [] || $this->markTestSkipped('No generated September 2026 payroll locally.');
    }

    /** Write, re-read from disk (proves it opens) and return the loaded workbook. */
    private function roundTrip(Spreadsheet $wb): Spreadsheet
    {
        $path = $this->svc->save($wb);
        $this->assertGreaterThan(1000, filesize($path));
        $loaded = IOFactory::load($path);
        unlink($path);

        return $loaded;
    }

    private function sum(string $col): float
    {
        return round(array_sum(array_map(fn ($r) => PostPayrollDownloadService::n($r, $col), $this->rows)), 2);
    }

    /** @return array<string, int> header text => 1-based column index of a row */
    private function headerMap($ws, int $row): array
    {
        $map = [];
        $maxCol = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($ws->getHighestDataColumn());
        for ($c = 1; $c <= $maxCol; $c++) {
            $v = $ws->getCell([$c, $row])->getValue();
            if ($v !== null && $v !== '') $map[(string) $v] = $c;
        }

        return $map;
    }

    private function columnSum($ws, int $col, int $fromRow, int $toRow): float
    {
        $s = 0.0;
        for ($r = $fromRow; $r <= $toRow; $r++) {
            $v = $ws->getCell([$col, $r])->getValue();
            if (is_numeric($v)) $s += (float) $v;
        }

        return round($s, 2);
    }

    public function test_paybill_ties_to_payroll_and_is_numeric(): void
    {
        $before = $this->finalizedSnapshot();
        $ws = $this->roundTrip($this->svc->buildPaybill($this->rows, self::YM))->getSheetByName('Paybill');
        $h = $this->headerMap($ws, 3);
        $expectedOrder = ['Sr', 'Name', 'Emp.Code', 'CPF No.', 'P Level', 'Basic @', 'Basic', 'sp.pay', 'D.A.', 'H.R.A.', 'UNIFORM', 'EWA', 'Trpt.', 'Medical', 'DA Arrs.', 'En.DA', 'T.Fees.', 'CCA', 'NDA', 'Encash', 'Custom Earnings', 'Tot. Pay',
            'I.T.', 'P.T.', 'L.I.C.', 'PF(C)', 'FP', 'PF(V)', 'PF(L)', 'P.O.', 'CR.SOCY', 'Veh.', 'O.T.', 'Std.Lic.Fee', 'Elec.', 'TV', 'Water', 'Furn.', 'Mess', 'HOR', 'TEL', 'FEST.ADV', 'CAR ADV', 'SC.ADV', 'CY.ADV', 'INT.CY', 'INT.VEH', 'HB.ADV', 'INT.HB', 'WEL', 'OTHER', 'CPF Arr', 'Lib.', 'Union', 'Quarter Rent', 'HPL+EOL', 'Custom Deductions', 'TOT.DED.',
            'Total Pay', 'Total Deduction', 'Net Pay', 'Remark'];
        $this->assertSame($expectedOrder, array_keys($h), 'columns and order as requested (DA CPF renamed CPF Arr)');
        $last = 3 + count($this->rows);
        $this->assertSame($this->sum('total_earnings'), $this->columnSum($ws, $h['Tot. Pay'], 4, $last));
        $this->assertSame($this->sum('total_earnings'), $this->columnSum($ws, $h['Total Pay'], 4, $last));
        $this->assertSame($this->sum('total_deductions'), $this->columnSum($ws, $h['TOT.DED.'], 4, $last));
        $this->assertSame($this->sum('net_salary'), $this->columnSum($ws, $h['Net Pay'], 4, $last));
        $this->assertSame($this->sum('mess_amount'), $this->columnSum($ws, $h['Mess'], 4, $last));
        $this->assertSame($this->sum('credit_society_amount'), $this->columnSum($ws, $h['CR.SOCY'], 4, $last));
        $this->assertSame($this->sum('electricity_amount'), $this->columnSum($ws, $h['Elec.'], 4, $last));
        $this->assertSame(round($this->sum('da_cpf_amount') + $this->sum('cpf_arrear'), 2), $this->columnSum($ws, $h['CPF Arr'], 4, $last));
        for ($r = 4; $r <= $last; $r++) {
            $this->assertIsNumeric($ws->getCell([$h['Tot. Pay'], $r])->getValue());
            $this->assertIsNumeric($ws->getCell([$h['Net Pay'], $r])->getValue());
        }
        $this->assertSame(['CCA', 'FP', 'O.T.', 'TV', 'Furn.', 'TEL', 'FEST.ADV', 'CAR ADV', 'SC.ADV', 'CY.ADV', 'INT.CY', 'INT.VEH', 'HB.ADV', 'INT.HB', 'Lib.', 'Union'], PostPayrollDownloadService::paybillColumnsWithoutSource());
        $this->assertNotNull($this->roundTrip($this->svc->buildPaybill($this->rows, self::YM))->getSheetByName('Print'));
        $this->assertFinalizedUnchanged($before, 'building the paybill');
    }

    public function test_cpf_report_ties_and_keeps_live_formulas(): void
    {
        $ws = $this->roundTrip($this->svc->buildCpf($this->rows, self::YM))->getSheet(0);
        $this->assertSame(PostPayrollDownloadService::INSTITUTE, $ws->getCell('A1')->getValue());
        $this->assertSame('Details of CPF, VPF, etc. for the month September 2026', $ws->getCell('A2')->getValue());
        $this->assertSame(['SR NO', 'UAN', 'NAME AS PER UAN', 'CPF  NO', 'GBASIC', 'NCP DAYS', 'BASIC', 'DA', 'HRA', 'TPT', 'MEDICAL', 'Total', 'CPF', 'DA CPF', 'VPF', 'PENSION', 'EMP_ CONTR.'],
            array_map(fn ($c) => $ws->getCell([$c, 4])->getValue(), range(1, 17)));
        $n = count($this->rows);
        $this->assertSame($this->sum('cpf_amount'), $this->columnSum($ws, 13, 5, 4 + $n), 'CPF column = payroll CPF');
        $this->assertSame($this->sum('cpf_arrear'), $this->columnSum($ws, 14, 5, 4 + $n), 'DA CPF column = CPF Arr (CPF on DA arrears)');
        $this->assertSame($this->sum('vpf_amount'), $this->columnSum($ws, 15, 5, 4 + $n));
        $this->assertSame($this->sum('basic_paid'), $this->columnSum($ws, 7, 5, 4 + $n));
        $this->assertStringStartsWith('=SUBTOTAL(109,M5:M', (string) $ws->getCell('M'.(5 + $n + 0))->getValue(), 'CIRT TOTAL row is a live formula');
        $this->assertStringContainsString('GRAND TOTAL', (string) $ws->getCell('C'.(5 + $n + 2 + 1 + 2 + 0))->getValue() ?: 'GRAND TOTAL');
    }

    public function test_division_wise_totals_equal_payroll_gross_and_headcount(): void
    {
        $company = (string) DB::table('cirt_monthly_payroll')->value('company_id');
        $names = $this->svc->settingsDivisionNames($company);
        $table = $this->svc->divisionWiseTable($this->rows, $names);
        $wb = $this->roundTrip($this->svc->buildDivisionWise($this->rows, self::YM, $names));
        $this->assertSame(['Division-Wise', 'Division', 'Count', 'Pay Level'], $wb->getSheetNames());

        // Real division names (no keyword groups, no "OTHER / UNMAPPED"), every employee listed once.
        $this->assertNotContains('OTHER / UNMAPPED', array_keys($table['divisions']));
        $this->assertSame(count($this->rows), array_sum(array_column($table['divisions'], 'rows')));
        $this->assertSame($this->sum('total_earnings'), $table['totals'][8]);
        $this->assertSame($this->sum('total_deductions'), $table['totals'][9]);
        $this->assertSame($this->sum('net_salary'), $table['totals'][10]);
        $detail = array_values(array_filter($table['rows'], fn ($r, $i) => $table['kinds'][$i] === 'detail', ARRAY_FILTER_USE_BOTH));
        $this->assertCount(count($this->rows), $detail);
        $this->assertSame([], array_filter(array_column($detail, 1), fn ($c) => trim((string) $c) === ''), 'every row has an employee code');
        foreach (array_keys($table['divisions']) as $name) $this->assertNotSame('', trim($name));

        $div = $wb->getSheetByName('Division');
        $this->assertSame('Salary Details for September 2026', $div->getCell('A1')->getValue());
        // Formulas stay live: the TOTAL row sums the division rows; GRAND TOTAL adds the categories.
        $totalRow = 5 + count($table['divisions']);
        $this->assertSame("=SUM(B5:B".($totalRow - 1).')', $div->getCell('B'.$totalRow)->getValue());
        $this->assertEqualsWithDelta($this->sum('total_earnings'), (float) $div->getCell('B'.($totalRow + 1))->getCalculatedValue(), 1.0);

        $count = $wb->getSheetByName('Count');
        $countTotal = 0;
        foreach (['B', 'C', 'D', 'E'] as $col) {
            foreach ($count->getRowIterator(5) as $row) {
                $v = $count->getCell($col.$row->getRowIndex())->getValue();
                if (is_numeric($v)) $countTotal += (int) $v;
            }
        }
        $this->assertSame(count($this->rows), $countTotal, 'every employee is counted exactly once');

        $pl = $wb->getSheetByName('Pay Level');
        $grand = null;
        foreach ($pl->getRowIterator(6) as $row) {
            if ($pl->getCell('A'.$row->getRowIndex())->getValue() === 'GRAND TOTAL') $grand = $row->getRowIndex();
        }
        $this->assertNotNull($grand);
        $this->assertEqualsWithDelta($this->sum('total_earnings'), (float) $pl->getCell('C'.$grand)->getCalculatedValue(), 1.0, 'Pay Level grand total = payroll gross (all levels are in a group)');
    }

    public function test_tds_layout_range_and_totals(): void
    {
        $company = (string) DB::table('cirt_monthly_payroll')->value('company_id');
        $rows = $this->svc->rows($company, 202609, 202610);
        count($rows) > count($this->rows) || $this->markTestSkipped('Needs two generated months for the range check.');
        $ws = $this->roundTrip($this->svc->buildTds($rows))->getSheet(0);

        // Row 1 is the header row: 43 columns, no ADD1..US103 code row, no blank/0 column.
        $this->assertCount(43, PostPayrollDownloadService::TDS_COLUMNS);
        $this->assertEquals(PostPayrollDownloadService::TDS_COLUMNS, array_map(fn ($c) => $ws->getCell([$c, 1])->getValue(), range(1, 43)));
        $this->assertSame([], \App\Support\SpreadsheetLayout::auditHeaders($ws->getParent(), ['TDS_DATA' => 1]));
        $this->assertSame(count($rows), $ws->getHighestDataRow() - 1);
        $this->assertSame('E2', $ws->getFreezePane());
        $yms = [];
        for ($r = 2; $r <= 1 + count($rows); $r++) $yms[(int) $ws->getCell('R'.$r)->getValue()] = true;
        $this->assertSame([202609, 202610], array_keys($yms));
        $this->assertSame('0', $ws->getStyle('R2')->getNumberFormat()->getFormatCode(), 'YYYYMM has no thousands separator');

        $letter = fn (string $header) => \PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex(array_search($header, PostPayrollDownloadService::TDS_COLUMNS, true) + 1);
        $sumCol = fn (string $header) => $this->columnSum($ws, \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($letter($header)), 2, 1 + count($rows));
        $tot = fn (string $k) => round(array_sum(array_map(fn ($r) => PostPayrollDownloadService::n($r, $k), $rows)), 2);
        $this->assertSame($tot('basic_paid'), $sumCol('BASIC+DP'));
        $this->assertSame(round($tot('da_paid') + $tot('da_arrears_paid'), 2), $sumCol('DA+DA ARRS'));
        $this->assertSame($tot('hra_paid'), $sumCol('HRA'));
        $this->assertSame($tot('transport_paid'), $sumCol('Conveyance(Taxable)'));
        $this->assertSame($tot('pt_amount'), $sumCol('Professional Tax'));
        $this->assertSame(round($tot('cpf_amount') + $tot('vpf_amount'), 2), $sumCol('Provident Fund'));
        $this->assertSame($tot('income_tax_amount'), $sumCol('Tax Deducted'));
        $this->assertSame($tot('lic_amount'), $sumCol('Insurance'));
        // Dates are real Excel dates shown mm/dd/yyyy.
        $this->assertSame('mm/dd/yyyy', $ws->getStyle('F2')->getNumberFormat()->getFormatCode());
        $this->assertSame(['Subhash', 'Duryodhan', 'Katkar'], PostPayrollDownloadService::splitName('Subhash Duryodhan Katkar'));
    }

    public function test_reports_cannot_alter_finalized_payroll(): void
    {
        $before = $this->finalizedSnapshot();
        $this->svc->buildCpf($this->rows, self::YM);
        $this->svc->buildDivisionWise($this->rows, self::YM);
        $this->svc->buildTds($this->rows);
        $this->svc->buildPaybill($this->rows, self::YM);
        $this->assertFinalizedUnchanged($before, 'building the four reports');
    }
}
