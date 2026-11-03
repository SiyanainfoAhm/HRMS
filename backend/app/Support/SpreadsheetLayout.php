<?php

namespace App\Support;

use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Shared\Date as XlDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;
use PhpOffice\PhpSpreadsheet\Worksheet\PageSetup;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * The ONE place that finishes an exported sheet (every PHP-built workbook calls finish()).
 * Column widths come from the rendered content (longest of header and values + padding, clamped to
 * [MIN_WIDTH, MAX_WIDTH]); dates are real date cells with an explicit format; numbers are numeric,
 * right aligned, with an explicit format; identifier columns stay text. audit() re-checks a finished
 * workbook and is what the regression tests call, so a sheet that regresses to "####" fails a test.
 *
 * It never changes a cell's value except to turn a date string into the same date as a date cell.
 */
final class SpreadsheetLayout
{
    public const MIN_WIDTH = 8;

    public const MAX_WIDTH = 50;

    public const PADDING = 2;

    /** Default formats; a cell that already carries an explicit (non-General) format keeps it. */
    public const FORMAT_AMOUNT = Money::WHOLE_RUPEES ? '#,##0' : '#,##0.00';

    public const FORMAT_INTEGER = '#,##0';

    public const FORMAT_PERCENT = '0.00%';

    public const FORMAT_DATE = 'dd/mm/yyyy';

    public const FORMAT_DATE_US = 'mm/dd/yyyy';

    /**
     * @param array{
     *   header_row?: int, last_header_row?: int, date_columns?: array<string,string>, text_columns?: list<string>,
     *   amount_columns?: list<string>, percent_columns?: list<string>, wrap_columns?: list<string>,
     *   freeze?: string, autofilter?: string|bool, landscape?: bool, fit_width?: bool, header_fill?: string,
     *   min?: int, max?: int
     * } $o  Column keys are letters. header_row defaults to 1.
     */
    public static function finish(Worksheet $ws, array $o = []): void
    {
        $headerRow = (int) ($o['header_row'] ?? 1);
        $highestRow = $ws->getHighestDataRow();
        $highestCol = Coordinate::columnIndexFromString($ws->getHighestDataColumn());
        $dateCols = $o['date_columns'] ?? [];
        $textCols = array_fill_keys($o['text_columns'] ?? [], true);
        $amountCols = array_fill_keys($o['amount_columns'] ?? [], true);
        $percentCols = array_fill_keys($o['percent_columns'] ?? [], true);
        $wrapCols = array_fill_keys($o['wrap_columns'] ?? [], true);

        // 1. Types and formats (data area only; rows above the header are titles).
        foreach ($ws->getCellCollection()->getCoordinates() as $coord) {
            $cell = $ws->getCell($coord);
            $row = $cell->getRow();
            if ($row < $headerRow) {
                continue;
            }
            $col = $cell->getColumn();
            $style = $ws->getStyle($coord);
            $value = $cell->getValue();
            if ($row === $headerRow || $row === ($o['last_header_row'] ?? -1)) {
                continue;
            }
            if (isset($textCols[$col])) {
                if ($value !== null && $value !== '' && ! $cell->isFormula() && $cell->getDataType() !== DataType::TYPE_STRING) {
                    $cell->setValueExplicit((string) $value, DataType::TYPE_STRING);
                }
                $style->getNumberFormat()->setFormatCode(NumberFormat::FORMAT_TEXT);
                $style->getAlignment()->setHorizontal(Alignment::HORIZONTAL_LEFT);

                continue;
            }
            if (isset($dateCols[$col])) {
                $serial = self::toExcelDate($value);
                if ($serial !== null) {
                    $cell->setValueExplicit($serial, DataType::TYPE_NUMERIC);
                    $style->getNumberFormat()->setFormatCode($dateCols[$col]);
                    $style->getAlignment()->setHorizontal(Alignment::HORIZONTAL_RIGHT);
                }

                continue;
            }
            if (is_int($value) || is_float($value) || $cell->isFormula()) {
                $format = $style->getNumberFormat()->getFormatCode();
                if ($format === NumberFormat::FORMAT_GENERAL) {
                    $isWhole = is_int($value) || (is_float($value) && floor($value) === $value);
                    $style->getNumberFormat()->setFormatCode(
                        isset($percentCols[$col]) ? self::FORMAT_PERCENT
                        : (isset($amountCols[$col]) || $cell->isFormula() || ! $isWhole ? self::FORMAT_AMOUNT : self::FORMAT_INTEGER)
                    );
                }
                $style->getAlignment()->setHorizontal(Alignment::HORIZONTAL_RIGHT);
            }
        }

        // 2. Header look.
        if ($highestRow >= $headerRow && $highestCol >= 1) {
            $range = 'A'.$headerRow.':'.Coordinate::stringFromColumnIndex($highestCol).$headerRow;
            $ws->getStyle($range)->getFont()->setBold(true);
            $ws->getStyle($range)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB($o['header_fill'] ?? 'D9D9D9');
            $ws->getStyle($range)->getAlignment()->setVertical(Alignment::VERTICAL_CENTER);
        }

        // 3. Widths from content.
        $widths = self::contentWidths($ws, $headerRow, $o['min'] ?? self::MIN_WIDTH, $o['max'] ?? self::MAX_WIDTH);
        foreach ($widths as $letter => $info) {
            $ws->getColumnDimension($letter)->setAutoSize(false)->setWidth($info['width']);
            if (isset($wrapCols[$letter]) && $info['overflow']) {
                $ws->getStyle($letter.($headerRow + 1).':'.$letter.$highestRow)->getAlignment()->setWrapText(true)->setVertical(Alignment::VERTICAL_TOP);
            }
        }

        // 4. Freeze, filter, print.
        if (isset($o['freeze'])) {
            $ws->freezePane($o['freeze']);
        }
        $filter = $o['autofilter'] ?? false;
        if ($filter === true) {
            $ws->setAutoFilter('A'.$headerRow.':'.Coordinate::stringFromColumnIndex($highestCol).$highestRow);
        } elseif (is_string($filter)) {
            $ws->setAutoFilter($filter);
        }
        if (($o['landscape'] ?? false) || ($o['fit_width'] ?? false)) {
            $setup = $ws->getPageSetup();
            $setup->setOrientation(($o['landscape'] ?? false) ? PageSetup::ORIENTATION_LANDSCAPE : PageSetup::ORIENTATION_PORTRAIT);
            $setup->setPaperSize(PageSetup::PAPERSIZE_A4);
            $setup->setFitToWidth(1)->setFitToHeight(0);
            $ws->getSheetView()->setZoomScale(100);
            $ws->getPageSetup()->setFitToPage(true);
            $ws->getPageSetup()->setRowsToRepeatAtTopByStartAndEnd($headerRow, $headerRow);
        }
    }

    /** Date value (Y-m-d string, DateTime, or an existing Excel serial) as a whole-day Excel serial; null when blank/invalid. */
    public static function toExcelDate(mixed $value): int|float|null
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return (int) floor(XlDate::PHPToExcel(new \DateTime($value->format('Y-m-d'), new \DateTimeZone('UTC'))));
        }
        if (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value))) {
            $n = (float) $value;

            return $n > 0 ? (int) floor($n) : null; // 0 / negative would show as 1900 – keep blank
        }
        $text = trim((string) $value);
        $date = \DateTime::createFromFormat('!Y-m-d', substr($text, 0, 10), new \DateTimeZone('UTC'))
            ?: \DateTime::createFromFormat('!d/m/Y', substr($text, 0, 10), new \DateTimeZone('UTC'));
        if (! $date) {
            return null;
        }

        return (int) floor(XlDate::PHPToExcel($date));
    }

    /**
     * Letters of the columns whose header (in $row) matches one of $names, case-insensitively.
     *
     * @param  list<string>  $names
     * @return list<string>
     */
    public static function columnsByHeader(Worksheet $ws, int $row, array $names): array
    {
        $want = array_map(fn ($n) => mb_strtolower(trim($n)), $names);
        $out = [];
        for ($c = 1, $max = Coordinate::columnIndexFromString($ws->getHighestDataColumn()); $c <= $max; $c++) {
            $label = mb_strtolower(trim((string) $ws->getCell([$c, $row])->getValue()));
            if ($label !== '' && in_array($label, $want, true)) {
                $out[] = Coordinate::stringFromColumnIndex($c);
            }
        }

        return $out;
    }

    /** The text Excel will show for a cell (number format applied; formulas evaluated). */
    public static function renderedText(Worksheet $ws, string $coord): string
    {
        $cell = $ws->getCell($coord); // never keep a Cell across another getCell(): the collection detaches it
        try {
            $value = $cell->isFormula() ? $cell->getCalculatedValue() : $cell->getValue();
        } catch (\Throwable) {
            return str_repeat('9', 14); // un-evaluable formula: assume a typical total
        }
        if ($value === null || $value === '') {
            return '';
        }
        $format = $ws->getStyle($coord)->getNumberFormat()->getFormatCode();
        if (is_bool($value)) {
            return $value ? 'TRUE' : 'FALSE';
        }

        return (string) NumberFormat::toFormattedString($value, $format);
    }

    /**
     * Required width (characters) per column letter: longest rendered value or header, +padding, clamped.
     * Merged cells and "note" rows (a single filled cell, which Excel lets overflow) are ignored.
     *
     * @return array<string, array{width: float, overflow: bool, needed: float}>
     */
    public static function contentWidths(Worksheet $ws, int $fromRow, int $min = self::MIN_WIDTH, int $max = self::MAX_WIDTH): array
    {
        $merged = [];
        foreach ($ws->getMergeCells() as $range) {
            foreach (Coordinate::extractAllCellReferencesInRange($range) as $ref) {
                $merged[$ref] = true;
            }
        }
        $rowCells = [];
        $noteRows = [];
        foreach ($ws->getCellCollection()->getCoordinates() as $coord) {
            $cell = $ws->getCell($coord);
            $value = $cell->getValue();
            if ($cell->getRow() >= $fromRow && ! isset($merged[$coord]) && $value !== null && $value !== '') {
                $rowCells[$cell->getRow()][] = $coord;
                $noteRows[$cell->getRow()][] = ! is_numeric($value) && ! $cell->isFormula();
            }
        }
        $needed = [];
        foreach ($rowCells as $row => $coords) {
            if (count($coords) === 1 && $noteRows[$row][0] && $row !== $fromRow) {
                continue;
            }
            foreach ($coords as $coord) {
                $text = self::renderedText($ws, $coord);
                $len = 0;
                foreach (explode("\n", $text) as $line) {
                    $len = max($len, mb_strlen($line));
                }
                $bold = $ws->getStyle($coord)->getFont()->getBold();
                $letter = preg_replace('/[0-9]+/', '', $coord);
                $needed[$letter] = max($needed[$letter] ?? 0, $len * ($bold ? 1.15 : 1.0) + self::PADDING);
            }
        }
        $out = [];
        foreach ($needed as $letter => $n) {
            $out[$letter] = ['width' => (float) min($max, max($min, ceil($n))), 'overflow' => $n > $max, 'needed' => $n];
        }

        return $out;
    }

    /**
     * Problems that would show as "####" or a mis-typed column in a finished workbook (empty = fine).
     *
     * @param  array<string, list<string>>  $dateHeaders  sheet title => header labels that must be date cells
     * @return list<string>
     */
    public static function audit(Spreadsheet $wb, array $dateHeaders = [], int $headerRow = 1): array
    {
        $problems = [];
        foreach ($wb->getAllSheets() as $ws) {
            $title = $ws->getTitle();
            $merged = [];
            foreach ($ws->getMergeCells() as $range) {
                foreach (Coordinate::extractAllCellReferencesInRange($range) as $ref) {
                    $merged[$ref] = true;
                }
            }
            $dateLetters = self::columnsByHeader($ws, $headerRow, $dateHeaders[$title] ?? []);
            foreach ($ws->getCellCollection()->getCoordinates() as $coord) {
                $cell = $ws->getCell($coord);
                $value = $cell->getValue();
                if ($value === null || $value === '' || isset($merged[$coord])) {
                    continue;
                }
                $letter = $cell->getColumn();
                $row = $cell->getRow();
                $isNumeric = is_int($value) || is_float($value) || $cell->isFormula();
                if ($isNumeric) {
                    $width = $ws->getColumnDimension($letter)->getWidth();
                    $need = mb_strlen(self::renderedText($ws, $coord)) + 1;
                    if ($width <= 0) {
                        $width = 8.43; // Excel default when no width is stored
                    }
                    if ($need > $width) {
                        $problems[] = "{$title}!{$coord}: needs {$need} chars, column is {$width} wide (would show ####)";
                    }
                }
                if ($row > $headerRow && in_array($letter, $dateLetters, true)) {
                    $format = $ws->getStyle($coord)->getNumberFormat()->getFormatCode();
                    if (! $isNumeric || ! XlDate::isDateTimeFormatCode($format) || floor((float) $value) !== (float) $value || (float) $value < 1) {
                        $problems[] = "{$title}!{$coord}: date column cell is not a whole-day date with a date format";
                    }
                }
            }
        }

        return $problems;
    }
}
