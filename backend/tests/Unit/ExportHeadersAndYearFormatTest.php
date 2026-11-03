<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use App\Support\SpreadsheetLayout;
use PHPUnit\Framework\TestCase;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Excel clean-up: TDS Data has its real headers in row 1 (no code row, no blank/0 column), identifiers such as
 * Year / YYYYMM / codes / day counts never carry a thousands separator, and every export header is a non-empty,
 * non-numeric string. Everything is checked on the files as written and re-opened, not on in-memory objects.
 */
final class ExportHeadersAndYearFormatTest extends TestCase
{
    /** A row whose totals reconcile (the multi-period TDS report cross-checks them). */
    private function row(int $i = 1): array
    {
        return [
            'month_year' => '2026-09-01', '_ym' => 202609, 'pay_level' => 7 + $i, 'basic_actual' => 50000, 'basic_paid' => 50000, 'da_paid' => 0,
            'unpaid_days' => 0, 'total_earnings' => 50000, 'total_deductions' => 0, 'net_salary' => 50000, 'custom_earnings' => '{}', 'custom_deductions' => '{}',
            '_master' => ['employee_code' => sprintf('%03d', $i), 'name' => 'Amar Pandurang Ghotane', 'pan' => 'ABCDE1234F', 'cpf_no' => '300', 'division' => 'Safety', 'date_of_birth' => '1990-05-15'],
            '_user' => ['current_postal_code' => '411026'],
        ];
    }

    private function roundTrip(Spreadsheet $wb): Spreadsheet
    {
        $path = (new PostPayrollDownloadService)->save($wb);
        $loaded = IOFactory::load($path);
        unlink($path);

        return $loaded;
    }

    /** @return list<mixed> */
    private function headerRow(Worksheet $ws, int $row): array
    {
        $out = [];
        for ($c = 1, $max = Coordinate::columnIndexFromString($ws->getHighestDataColumn()); $c <= $max; $c++) {
            $out[] = $ws->getCell([$c, $row])->getValue();
        }

        return $out;
    }

    private function letter(Worksheet $ws, int $row, string $header): string
    {
        $letters = SpreadsheetLayout::columnsByHeader($ws, $row, [$header]);
        $this->assertCount(1, $letters, "header {$header} must exist exactly once");

        return $letters[0];
    }

    private function extras(): array
    {
        return ['earnings' => [], 'deductions' => []];
    }

    // ------------------------------------------------------------ TDS Data

    public function test_tds_row_1_holds_the_real_headers_and_the_code_row_and_zero_column_are_gone(): void
    {
        $svc = new PostPayrollDownloadService;
        $table = $svc->tdsTable([$this->row()], $this->extras());
        $ws = $this->roundTrip($svc->buildTds([$this->row()], $this->extras()))->getSheet(0);

        $row1 = $this->headerRow($ws, 1);
        $this->assertSame($table['headers'], $row1, 'row 1 of the file is exactly the preview header list');
        $this->assertSame(PostPayrollDownloadService::TDS_COLUMNS, array_slice($row1, 0, 43));
        $this->assertCount(43, PostPayrollDownloadService::TDS_COLUMNS);
        $this->assertSame('EX_CODE', $row1[0]);
        foreach (['ADD1', 'ADD15', 'TR', 'CT', 'PT', 'PF', 'TDS', 'DED1', 'GI', 'US101', 'US102', 'US103'] as $code) {
            $this->assertNotContains($code, $row1, "the old code row ({$code}) must be gone");
        }
        $this->assertNotContains('0', array_map('strval', $row1));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($ws->getParent(), ['TDS_DATA' => 1]));
        // Row 2 is the first data row, not a second header.
        $this->assertSame('001', $ws->getCell('A2')->getValue());
        $this->assertSame(2, $ws->getHighestDataRow() - 1, 'one data row plus the totals row');
        $this->assertSame('TOTAL', $ws->getCell('A3')->getValue());
    }

    public function test_tds_freeze_filter_and_totals_follow_the_new_header_row(): void
    {
        $svc = new PostPayrollDownloadService;
        $ws = $this->roundTrip($svc->buildTds([$this->row(1), $this->row(2)], $this->extras()))->getSheet(0);
        $last = Coordinate::stringFromColumnIndex(count($this->headerRow($ws, 1)));
        $this->assertSame('E2', $ws->getFreezePane(), 'header row + identity columns (EX_CODE and the three names)');
        $this->assertSame("A1:{$last}3", $ws->getAutoFilter()->getRange(), 'filter covers the header and the two data rows, not the totals row');
        $this->assertSame('TOTAL', $ws->getCell('A4')->getValue());
        $basic = $this->letter($ws, 1, 'BASIC+DP');
        $this->assertSame(100000.0, (float) $ws->getCell($basic.'4')->getValue());
        $this->assertTrue((bool) $ws->getStyle('A4')->getFont()->getBold());

        // Single-month download (no extras): filter ends at the last data row.
        $plain = $this->roundTrip($svc->buildTds([$this->row(1), $this->row(2)]))->getSheet(0);
        $this->assertSame('A1:AQ3', $plain->getAutoFilter()->getRange());
    }

    public function test_tds_columns_after_the_removed_slot_moved_one_letter_left(): void
    {
        $svc = new PostPayrollDownloadService;
        $ws = $this->roundTrip($svc->buildTds([$this->row()], $this->extras()))->getSheet(0);
        // Old column Z (header 0) is gone, so everything that sat after it moved left by one.
        $expected = [
            'ENCASHMENT+ENCA DA' => 'Z', 'EX-GRATIA' => 'AA', 'HON+TUITION FEE+CASH' => 'AB', 'PERKS' => 'AC', 'WASH ALLOW' => 'AD', 'GRATUITY' => 'AE',
            'INCENTIVE' => 'AF', 'Total Arrears' => 'AG', 'HRA' => 'AH', 'Conveyance(Taxable)' => 'AI', 'Professional Tax' => 'AJ', 'Provident Fund' => 'AK',
            'Tax Deducted' => 'AL', 'Insurance' => 'AM', 'Group Insurance' => 'AN', 'Conveyance' => 'AO', 'Washing Allowance' => 'AP', 'Leave Encashment' => 'AQ',
            'Month' => 'AR', 'Year' => 'AS',
        ];
        foreach ($expected as $header => $letter) {
            $this->assertSame($letter, $this->letter($ws, 1, $header), $header);
        }
        // Columns before the removed slot did not move.
        $this->assertSame('S', $this->letter($ws, 1, 'BASIC+DP'));
        $this->assertSame('Y', $this->letter($ws, 1, 'OT ALLOWANCE'));
    }

    public function test_tds_year_and_yyyymm_are_plain_numbers_without_thousands_separator(): void
    {
        $svc = new PostPayrollDownloadService;
        $ws = $this->roundTrip($svc->buildTds([$this->row()], $this->extras()))->getSheet(0);
        $year = $this->letter($ws, 1, 'Year').'2';
        $ym = $this->letter($ws, 1, 'YYYYMM').'2';
        $this->assertSame('0', $ws->getStyle($year)->getNumberFormat()->getFormatCode());
        $this->assertSame(2026, (int) $ws->getCell($year)->getValue());
        $this->assertSame('2026', $ws->getCell($year)->getFormattedValue());
        $this->assertSame('0', $ws->getStyle($ym)->getNumberFormat()->getFormatCode());
        $this->assertSame('202609', $ws->getCell($ym)->getFormattedValue());
        // Money columns keep their format.
        $this->assertSame(SpreadsheetLayout::FORMAT_AMOUNT, $ws->getStyle($this->letter($ws, 1, 'BASIC+DP').'2')->getNumberFormat()->getFormatCode());
    }

    public function test_preview_never_treats_year_or_yyyymm_as_money(): void
    {
        // The on-screen preview formats only moneyColumns (Indian grouping); everything else is shown as is, so 2026 stays 2026.
        $t = (new PostPayrollDownloadService)->tdsTable([$this->row()], $this->extras());
        foreach (['Year', 'YYYYMM', 'Month', 'Pin', 'EX_CODE'] as $header) {
            $this->assertNotContains(array_search($header, $t['headers'], true), $t['moneyColumns'], "{$header} is not a money column");
        }
        $this->assertSame(2026, $t['rows'][0][array_search('Year', $t['headers'], true)]);
        $this->assertSame(202609, $t['rows'][0][array_search('YYYYMM', $t['headers'], true)]);
        $this->assertContains(array_search('BASIC+DP', $t['headers'], true), $t['moneyColumns']);
    }

    public function test_tds_identifiers_stay_text(): void
    {
        $ws = $this->roundTrip((new PostPayrollDownloadService)->buildTds([$this->row()]))->getSheet(0);
        $this->assertSame(DataType::TYPE_STRING, $ws->getCell('A2')->getDataType(), 'EX_CODE keeps leading zeros');
        $this->assertSame('001', $ws->getCell('A2')->getValue());
    }

    // ------------------------------------------------------------ Post Payroll reports

    public function test_post_payroll_reports_have_valid_headers_and_plain_identifier_formats(): void
    {
        $svc = new PostPayrollDownloadService;
        $rows = [$this->row(1), $this->row(2)];

        $cpf = $this->roundTrip($svc->buildCpf($rows, 202609));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($cpf, ['Sheet1' => 4]));
        $cpfWs = $cpf->getSheet(0);
        foreach (['A5', 'F5'] as $coord) { // SR NO, NCP DAYS
            $this->assertSame('0', $cpfWs->getStyle($coord)->getNumberFormat()->getFormatCode(), "CPF {$coord}");
        }
        // The summary table below the register starts in column B: its header has no blank cell.
        $summaryHeaderRow = null;
        foreach ($cpfWs->getRowIterator(5) as $r) {
            if ($cpfWs->getCell('B'.$r->getRowIndex())->getValue() === 'SL') $summaryHeaderRow = $r->getRowIndex();
        }
        $this->assertNotNull($summaryHeaderRow);
        $this->assertSame(['SL', 'PARTICULAR', 'AMOUNT'], [$cpfWs->getCell('B'.$summaryHeaderRow)->getValue(), $cpfWs->getCell('C'.$summaryHeaderRow)->getValue(), $cpfWs->getCell('D'.$summaryHeaderRow)->getValue()]);
        $this->assertNull($cpfWs->getCell('A'.$summaryHeaderRow)->getValue(), 'no blank header cell is written in column A');

        $div = $this->roundTrip($svc->buildDivisionWise($rows, 202609));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($div, ['Division' => 3, 'Count' => 4, 'Pay Level' => 6]));

        $pay = $this->roundTrip($svc->buildPaybill($rows, 202609));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($pay, ['Paybill' => 3]));
        $ws = $pay->getSheetByName('Paybill');
        foreach (['A4' => 'Sr', 'E4' => 'P Level'] as $coord => $_) {
            $this->assertSame('0', $ws->getStyle($coord)->getNumberFormat()->getFormatCode(), "Paybill {$coord}");
        }
        $this->assertSame(DataType::TYPE_STRING, $ws->getCell('C4')->getDataType(), 'Emp.Code is text');
        $this->assertSame('001', $ws->getCell('C4')->getValue());
    }

    public function test_large_serial_numbers_never_get_a_thousands_separator(): void
    {
        $rows = [];
        for ($i = 1; $i <= 1002; $i++) $rows[] = $this->row($i);
        $ws = $this->roundTrip((new PostPayrollDownloadService)->buildPaybill($rows, 202609))->getSheetByName('Paybill');
        $this->assertSame(1000, (int) $ws->getCell('A1003')->getValue());
        $this->assertSame('1000', $ws->getCell('A1003')->getFormattedValue());
    }

    // ------------------------------------------------------------ the guard itself

    public function test_guard_rejects_blank_null_zero_and_numeric_headers(): void
    {
        foreach ([[''], [' '], [null], [0], ['0'], [2026], [1.5], ['12'], ['A', '', 'B']] as $headers) {
            try {
                SpreadsheetLayout::assertHeaders($headers, 'test');
                $this->fail('expected a LogicException for '.json_encode($headers));
            } catch (\LogicException $e) {
                $this->assertStringContainsString("Export 'test'", $e->getMessage());
            }
        }
        SpreadsheetLayout::assertHeaders(['Year', 'EX_CODE', 'BASIC+DP', 'Net Pay'], 'ok');
        $this->assertTrue(true);
    }

    public function test_safe_header_never_returns_blank_or_numeric(): void
    {
        $this->assertSame('Custom Field', SpreadsheetLayout::safeHeader('', 'Custom Field'));
        $this->assertSame('Custom Field', SpreadsheetLayout::safeHeader('  ', 'Custom Field'));
        $this->assertSame('Custom Field', SpreadsheetLayout::safeHeader('0', 'Custom Field'));
        $this->assertSame('Custom Field', SpreadsheetLayout::safeHeader(null, 'Custom Field'));
        $this->assertSame('Bonus', SpreadsheetLayout::safeHeader(' Bonus ', 'Custom Field'));
    }

    public function test_audit_headers_catches_a_blank_a_zero_and_a_numeric_header_in_a_file(): void
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet()->setTitle('S');
        $ws->setCellValue('A1', 'Name')->setCellValue('B1', 0)->setCellValue('D1', 'Last')->setCellValue('C1', 2026);
        $problems = SpreadsheetLayout::auditHeaders($wb, ['S' => 1]);
        $this->assertCount(2, $problems, implode('; ', $problems)); // B1 = 0 and C1 = 2026; none blank here
        $ws->setCellValue('B1', 'Fine')->setCellValue('C1', null);
        $this->assertCount(1, SpreadsheetLayout::auditHeaders($wb, ['S' => 1]), 'a blank cell between headers is reported');
    }

    public function test_a_custom_field_with_a_numeric_or_blank_label_does_not_break_the_tds_headers(): void
    {
        $svc = new PostPayrollDownloadService;
        $t = $svc->tdsTable([$this->row()], ['earnings' => ['a' => '0', 'b' => ''], 'deductions' => []]);
        $this->assertSame([], SpreadsheetLayout::badHeaders($t['headers']));
        $this->assertContains('Custom Field', $t['headers']);
    }
}
