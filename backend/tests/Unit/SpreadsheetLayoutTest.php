<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use App\Support\SpreadsheetLayout;
use PHPUnit\Framework\TestCase;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use ZipArchive;

/**
 * Every export goes through SpreadsheetLayout::finish(). These tests build the Post Payroll workbooks from
 * synthetic rows (no database), write them to .xlsx, re-open them and fail on anything that would show
 * "####" (value wider than its column), a date column that is not a real date cell, or text identifiers
 * that lost their leading zeros.
 */
final class SpreadsheetLayoutTest extends TestCase
{
    private string $tz;

    protected function setUp(): void
    {
        $this->tz = date_default_timezone_get();
        date_default_timezone_set('Asia/Kolkata'); // production timezone: the zone that used to shift dates
    }

    protected function tearDown(): void
    {
        date_default_timezone_set($this->tz);
    }

    /** @return list<array<string, mixed>> */
    private function rows(int $n = 6): array
    {
        $rows = [];
        for ($i = 1; $i <= $n; $i++) {
            $rows[] = [
                'month_year' => '2026-09-01', '_ym' => 202609, 'pay_level' => 1 + ($i * 3) % 18,
                'basic_actual' => 1234567.89 * $i, 'basic_paid' => 123456.5 * $i, 'da_paid' => 98765.43 * $i, 'hra_paid' => 12345.67 * $i,
                'transport_paid' => 7200, 'medical_paid' => 1000, 'unpaid_days' => $i % 3, 'cpf_amount' => 12345.5, 'vpf_amount' => 500,
                'total_earnings' => 98765432.1 * $i, 'total_deductions' => 12345678.9, 'net_salary' => 86419753.2 * $i, 'leave_remarks' => $i === 2 ? 'Earned leave from 01/09/2026 to 05/09/2026, then half-pay leave, resumed duty on 12/09/2026' : '',
                'income_tax_amount' => 2500.25, 'pt_amount' => 200, 'gross_arrear' => 0, 'custom_earnings' => '{}', 'custom_deductions' => '{}',
                '_master' => [
                    'employee_code' => sprintf('00%d', 100 + $i), 'name' => 'Subhash Duryodhan Katkar '.str_repeat('X', $i * 3), 'pan' => 'ABCDE1234F', 'uan' => sprintf('0%011d', $i),
                    'cpf_no' => sprintf('00%d12', $i), 'division' => 'Safety & Homologation Division', 'designation' => 'Principal Technical Officer (Automotive Testing)',
                    'date_of_birth' => $i === 3 ? null : '1990-05-15', 'date_of_joining' => '2012-07-01', 'gender' => 'male', 'phone' => '09876543210',
                ],
                '_user' => ['current_address_line1' => 'Flat 12, Sai Residency, Opposite Municipal Corporation Garden, Bhosari', 'current_address_line2' => 'Pune', 'current_city' => 'Pune', 'current_state' => 'Maharashtra', 'current_country' => 'India', 'current_postal_code' => '411026'],
            ];
        }

        return $rows;
    }

    private function roundTrip(Spreadsheet $wb): Spreadsheet
    {
        $path = (new PostPayrollDownloadService)->save($wb);
        $loaded = IOFactory::load($path);
        unlink($path);

        return $loaded;
    }

    /** @return array<string, array{0: Spreadsheet, 1: array<string, list<string>>, 2: int}> */
    public static function workbooks(): array
    {
        return [];
    }

    private function allWorkbooks(): array
    {
        $svc = new PostPayrollDownloadService;
        $rows = $this->rows();

        return [
            'CPF' => [$svc->buildCpf($rows, 202609), [], 4],
            'Division-Wise' => [$svc->buildDivisionWise($rows, 202609), [], 3],
            'TDS' => [$svc->buildTds($rows), ['TDS_DATA' => ['Birth Date', 'Date of Joining']], 2],
            'Paybill' => [$svc->buildPaybill($rows, 202609), [], 3],
        ];
    }

    public function test_no_cell_is_wider_than_its_column_and_date_columns_are_dates(): void
    {
        foreach ($this->allWorkbooks() as $name => [$wb, $dateHeaders, $headerRow]) {
            $problems = SpreadsheetLayout::audit($wb, $dateHeaders, $headerRow);
            $this->assertSame([], $problems, "{$name}: ".implode("\n", array_slice($problems, 0, 5)));
        }
    }

    public function test_every_sheet_has_widths_within_min_and_max(): void
    {
        foreach ($this->allWorkbooks() as $name => [$wb]) {
            // Read the widths straight from the written file: <col min max width customWidth>.
            $path = (new PostPayrollDownloadService)->save($wb);
            $zip = new ZipArchive;
            $this->assertTrue($zip->open($path) === true);
            for ($i = 1; $i <= $wb->getSheetCount(); $i++) {
                $xml = $zip->getFromName("xl/worksheets/sheet{$i}.xml");
                preg_match_all('/<col [^>]*>/', $xml, $cols);
                $this->assertNotEmpty($cols[0], "{$name} sheet {$i} has explicit column widths");
                foreach ($cols[0] as $tag) {
                    preg_match('/width="([0-9.]+)"/', $tag, $w);
                    $this->assertGreaterThanOrEqual(SpreadsheetLayout::MIN_WIDTH, (float) $w[1], "{$name} sheet {$i}: {$tag}");
                    $this->assertLessThanOrEqual(SpreadsheetLayout::MAX_WIDTH + 0.01, (float) $w[1], "{$name} sheet {$i}: {$tag}");
                    $this->assertStringContainsString('customWidth="true"', $tag);
                }
            }
            $zip->close();
            unlink($path);
        }
    }

    public function test_tds_dates_are_whole_day_date_cells_in_the_sample_format_and_blank_stays_blank(): void
    {
        $ws = $this->roundTrip((new PostPayrollDownloadService)->buildTds($this->rows()))->getSheet(0);
        $this->assertSame('mm/dd/yyyy', $ws->getStyle('F3')->getNumberFormat()->getFormatCode());
        $this->assertSame('05/15/1990', $ws->getCell('F3')->getFormattedValue(), 'birth date must not shift a day under Asia/Kolkata');
        $this->assertSame('07/01/2012', $ws->getCell('H3')->getFormattedValue());
        $this->assertSame(33008, (int) $ws->getCell('F3')->getValue());
        $this->assertSame(33008.0, (float) $ws->getCell('F3')->getValue(), 'whole day, no time fraction');
        $this->assertNull($ws->getCell('F5')->getValue(), 'missing birth date stays blank, not 0 / 1900');
        $this->assertSame('202609', $ws->getCell('R3')->getFormattedValue(), 'YYYYMM has no thousands separator');
        $this->assertSame('A2:AR8', $ws->getAutoFilter()->getRange());
        $this->assertSame('B3', $ws->getFreezePane());
    }

    public function test_identifiers_stay_text_with_leading_zeros(): void
    {
        $tds = $this->roundTrip((new PostPayrollDownloadService)->buildTds($this->rows()))->getSheet(0);
        $this->assertSame('00101', $tds->getCell('A3')->getValue());
        $this->assertSame('ABCDE1234F', $tds->getCell('E3')->getValue());
        $this->assertSame('411026', $tds->getCell('O3')->getValue());
        $this->assertSame('09876543210', $tds->getCell('Q3')->getValue());

        $cpf = $this->roundTrip((new PostPayrollDownloadService)->buildCpf($this->rows(), 202609))->getSheet(0);
        $this->assertSame('000000000001', $cpf->getCell('B5')->getValue());
        $this->assertSame('0011', substr((string) $cpf->getCell('D5')->getValue(), 0, 4));
        $this->assertSame(\PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING, $cpf->getCell('D5')->getDataType());

        $pay = $this->roundTrip((new PostPayrollDownloadService)->buildPaybill($this->rows(), 202609))->getSheetByName('Paybill');
        $this->assertSame(\PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING, $pay->getCell('D4')->getDataType());
        $this->assertSame('00112', $pay->getCell('D4')->getValue());
    }

    public function test_numbers_are_numeric_right_aligned_with_formats_and_formulas_stay_live(): void
    {
        $svc = new PostPayrollDownloadService;
        $pay = $this->roundTrip($svc->buildPaybill($this->rows(), 202609))->getSheetByName('Paybill');
        $cell = $pay->getCell('G4'); // Basic
        $this->assertTrue(is_float($cell->getValue()) || is_int($cell->getValue()));
        $this->assertSame(SpreadsheetLayout::FORMAT_AMOUNT, $pay->getStyle('G4')->getNumberFormat()->getFormatCode());
        $this->assertSame('right', $pay->getStyle('G4')->getAlignment()->getHorizontal());
        $this->assertSame('C4', $pay->getFreezePane());
        $this->assertSame('landscape', $pay->getPageSetup()->getOrientation());
        $this->assertTrue($pay->getPageSetup()->getFitToPage());

        $div = $this->roundTrip($svc->buildDivisionWise($this->rows(), 202609))->getSheetByName('Division');
        $formulas = 0;
        foreach ($div->getCellCollection()->getCoordinates() as $coord) {
            if ($div->getCell($coord)->isFormula()) {
                $formulas++;
            }
        }
        $this->assertGreaterThan(8, $formulas, 'Division-Wise formulas must stay live');
    }

    public function test_audit_catches_a_narrow_date_column(): void
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet();
        $ws->setCellValue('A1', 'Birth Date')->setCellValue('A2', 33008);
        $ws->getStyle('A2')->getNumberFormat()->setFormatCode('mm/dd/yyyy');
        $ws->getColumnDimension('A')->setWidth(8);
        $this->assertNotSame([], SpreadsheetLayout::audit($wb, ['Worksheet' => ['Birth Date']]), 'a 10-char date in a width-8 column shows ####');
        SpreadsheetLayout::finish($ws, ['date_columns' => ['A' => 'mm/dd/yyyy']]);
        $this->assertSame([], SpreadsheetLayout::audit($wb, ['Worksheet' => ['Birth Date']]));
    }

    public function test_to_excel_date_is_timezone_safe_and_blank_aware(): void
    {
        $this->assertSame(33008, SpreadsheetLayout::toExcelDate('1990-05-15'));
        $this->assertSame(33008, SpreadsheetLayout::toExcelDate('1990-05-15 00:00:00'));
        $this->assertSame(33008, SpreadsheetLayout::toExcelDate('15/05/1990'));
        $this->assertSame(33008, SpreadsheetLayout::toExcelDate(new \DateTime('1990-05-15')));
        $this->assertNull(SpreadsheetLayout::toExcelDate(''));
        $this->assertNull(SpreadsheetLayout::toExcelDate(null));
        $this->assertNull(SpreadsheetLayout::toExcelDate('not a date'));
        $this->assertNull(SpreadsheetLayout::toExcelDate(0));
    }

    public function test_long_text_columns_are_capped_and_wrapped(): void
    {
        $wb = new Spreadsheet;
        $ws = $wb->getActiveSheet();
        $ws->setCellValue('A1', 'Address')->setCellValue('A2', str_repeat('Long address words ', 10));
        $ws->setCellValue('B1', 'N')->setCellValue('B2', 1);
        SpreadsheetLayout::finish($ws, ['wrap_columns' => ['A']]);
        $this->assertSame(50.0, (float) $ws->getColumnDimension('A')->getWidth());
        $this->assertTrue($ws->getStyle('A2')->getAlignment()->getWrapText());
        $this->assertSame(8.0, (float) $ws->getColumnDimension('B')->getWidth());
        $this->assertSame(Coordinate::stringFromColumnIndex(2), 'B');
    }
}
