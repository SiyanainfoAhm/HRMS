<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

require __DIR__.'/../backend/vendor/autoload.php';

$directory = __DIR__.'/../data/imports/september-2026';
$expected = [
    'September Salary 2026 - Foxpro.xlsx',
    'Salary Data as on 15.10.2026.xlsx',
    'Extract Sept 2026 FoxPro.xlsx',
    'Extract Sep 2026 as on 15.10.2026.xlsx',
];

foreach ($expected as $filename) {
    $path = $directory.DIRECTORY_SEPARATOR.$filename;
    if (! is_file($path)) {
        throw new RuntimeException("Missing workbook: {$filename}");
    }

    $book = IOFactory::load($path);
    $report = [
        'workbook' => $filename,
        'sheets' => [],
    ];
    foreach ($book->getWorksheetIterator() as $sheet) {
        $report['sheets'][] = analyseSheet($sheet);
    }

    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;
}

$foxproRows = detailRows($directory.'/September Salary 2026 - Foxpro.xlsx');
$employeeRows = detailRows($directory.'/Salary Data as on 15.10.2026.xlsx');
echo json_encode([
    'employee_mapping' => compareDetailedWorkbooks($foxproRows, $employeeRows),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;

/** @return array<string, mixed> */
function analyseSheet(Worksheet $sheet): array
{
    $rows = [];
    $highestRow = $sheet->getHighestDataRow();
    for ($row = 1; $row <= $highestRow; $row++) {
        $values = nonEmptyValues($sheet, $row);
        if ($values !== []) {
            $rows[$row] = $values;
        }
    }

    $headerRow = selectHeaderRow($rows);
    $headers = $headerRow ? array_values($rows[$headerRow]) : [];
    $records = $headerRow ? array_filter(
        $rows,
        static fn (array $values, int $row): bool => $row > $headerRow && count($values) >= 2,
        ARRAY_FILTER_USE_BOTH,
    ) : [];
    $identifiers = identifierAudit($headers, $records);

    return [
        'sheet' => $sheet->getTitle(),
        'non_empty_rows' => count($rows),
        'candidate_header_row' => $headerRow,
        'record_rows_after_header' => count($records),
        'header_count' => count($headers),
        'headers' => $headers,
        'identifier_audit' => $identifiers,
        'component_totals' => componentTotals($headers, $records),
        'non_empty_cells_by_row' => array_map('count', array_slice($rows, 0, 15, true)),
    ];
}

/** @return array<int, string> */
function nonEmptyValues(Worksheet $sheet, int $row): array
{
    $values = [];
    $iterator = $sheet->getRowIterator($row, $row)->current()->getCellIterator();
    $iterator->setIterateOnlyExistingCells(true);
    foreach ($iterator as $cell) {
        $value = $cell->getValue();
        if ($value === null || $value === '') {
            continue;
        }
        $values[Coordinate::columnIndexFromString($cell->getColumn())] = trim((string) $value);
    }

    return $values;
}

/** @param array<int, array<int, string>> $rows */
function selectHeaderRow(array $rows): ?int
{
    $bestRow = null;
    $bestScore = -1;
    foreach ($rows as $row => $values) {
        if ($row > 20) {
            break;
        }
        $text = 0;
        foreach ($values as $value) {
            if (preg_match('/[A-Za-z]/', $value)) {
                $text++;
            }
        }
        $score = count($values) * 10 + $text;
        if ($score > $bestScore) {
            $bestRow = $row;
            $bestScore = $score;
        }
    }

    return $bestRow;
}

/**
 * @param list<string> $headers
 * @param array<int, array<int, string>> $records
 * @return array<string, array{column: ?string, populated: int, missing: int, duplicates: int}>
 */
function identifierAudit(array $headers, array $records): array
{
    $wanted = [
        'employee_code' => ['employee code', 'code'],
        'cpf_no' => ['cpf no', 'cpfno'],
        'name' => ['name'],
    ];
    $result = [];
    foreach ($wanted as $key => $aliases) {
        $index = headerIndex($headers, $aliases);
        $values = [];
        foreach ($records as $record) {
            $value = $index === null ? '' : trim((string) ($record[$index + 1] ?? ''));
            if ($value !== '') {
                $values[] = normaliseIdentifier($value);
            }
        }
        $counts = array_count_values($values);
        $duplicates = count(array_filter($counts, static fn (int $count): bool => $count > 1));
        $result[$key] = [
            'column' => $index === null ? null : $headers[$index],
            'populated' => count($values),
            'missing' => count($records) - count($values),
            'duplicates' => $duplicates,
        ];
    }

    return $result;
}

/**
 * @param list<string> $headers
 * @param array<int, array<int, string>> $records
 * @return array<string, float>
 */
function componentTotals(array $headers, array $records): array
{
    $components = [
        'basic' => ['basic', 'basic paid'],
        'da' => ['da', 'da pay', 'da paid'],
        'hra' => ['hra', 'hra paid'],
        'transport' => ['transport', 'transport paid'],
        'total_earnings' => ['tpay', 'total earnings'],
        'cpf' => ['cpf'],
        'da_cpf' => ['da cpf', 'da_cpf'],
        'total_deductions' => ['tded', 'total deductions'],
        'net_salary' => ['npay', 'net salary'],
    ];
    $totals = [];
    foreach ($components as $component => $aliases) {
        $index = headerIndex($headers, $aliases);
        if ($index === null) {
            continue;
        }
        $sum = 0.0;
        foreach ($records as $record) {
            $value = $record[$index + 1] ?? '';
            $sum += numericValue($value);
        }
        $totals[$component] = round($sum, 2);
    }

    return $totals;
}

/** @param list<string> $headers @param list<string> $aliases */
function headerIndex(array $headers, array $aliases): ?int
{
    foreach ($headers as $index => $header) {
        $normalised = normaliseHeader($header);
        if (in_array($normalised, $aliases, true)) {
            return $index;
        }
    }

    return null;
}

function normaliseHeader(string $value): string
{
    return trim(str_replace('_', ' ', strtolower($value)));
}

function normaliseIdentifier(string $value): string
{
    return strtolower(preg_replace('/\s+/', '', trim($value)) ?? '');
}

function numericValue(string $value): float
{
    $clean = str_replace([',', '₹', ' '], '', trim($value));

    return is_numeric($clean) ? (float) $clean : 0.0;
}

/** @return array{headers: list<string>, rows: list<array<string, string>>} */
function detailRows(string $path): array
{
    $sheet = IOFactory::load($path)->getActiveSheet();
    $rows = [];
    for ($row = 1; $row <= $sheet->getHighestDataRow(); $row++) {
        $values = nonEmptyValues($sheet, $row);
        if ($values !== []) {
            $rows[$row] = $values;
        }
    }
    $headerRow = selectHeaderRow($rows);
    if ($headerRow === null) {
        return ['headers' => [], 'rows' => []];
    }
    $headers = array_values($rows[$headerRow]);
    $records = [];
    foreach ($rows as $row => $values) {
        if ($row <= $headerRow || count($values) < 2) {
            continue;
        }
        $record = [];
        foreach ($headers as $index => $header) {
            $record[normaliseHeader($header)] = trim((string) ($values[$index + 1] ?? ''));
        }
        $records[] = $record;
    }

    return ['headers' => $headers, 'rows' => $records];
}

/**
 * @param array{headers: list<string>, rows: list<array<string, string>>} $foxpro
 * @param array{headers: list<string>, rows: list<array<string, string>>} $employee
 * @return array<string, int>
 */
function compareDetailedWorkbooks(array $foxpro, array $employee): array
{
    $byCode = static function (array $rows, string $codeKey): array {
        $out = [];
        foreach ($rows as $row) {
            $code = normaliseIdentifier($row[$codeKey] ?? '');
            if ($code !== '') {
                $out[$code] = $row;
            }
        }

        return $out;
    };
    $foxByCode = $byCode($foxpro['rows'], 'code');
    $employeeByCode = $byCode($employee['rows'], 'employee code');
    $common = array_intersect_key($foxByCode, $employeeByCode);
    $foxByCpf = $byCode($foxpro['rows'], 'cpfno');
    $employeeByCpf = $byCode($employee['rows'], 'cpf no');
    $commonCpf = array_intersect_key($foxByCpf, $employeeByCpf);
    $cpfMismatches = 0;
    $missingCpfInEitherMatchedPair = 0;
    foreach ($common as $code => $foxRow) {
        $foxCpf = normaliseIdentifier($foxRow['cpfno'] ?? '');
        $employeeCpf = normaliseIdentifier($employeeByCode[$code]['cpf no'] ?? '');
        if ($foxCpf === '' || $employeeCpf === '') {
            $missingCpfInEitherMatchedPair++;
        } elseif ($foxCpf !== $employeeCpf) {
            $cpfMismatches++;
        }
    }
    $exactNameMatchesByCpf = 0;
    foreach ($commonCpf as $cpf => $foxRow) {
        if (normaliseName($foxRow['name'] ?? '') === normaliseName($employeeByCpf[$cpf]['name'] ?? '')) {
            $exactNameMatchesByCpf++;
        }
    }

    return [
        'foxpro_rows' => count($foxpro['rows']),
        'employee_rows' => count($employee['rows']),
        'matched_by_employee_code' => count($common),
        'foxpro_codes_without_employee_match' => count(array_diff_key($foxByCode, $employeeByCode)),
        'employee_codes_without_foxpro_match' => count(array_diff_key($employeeByCode, $foxByCode)),
        'cpf_mismatches_among_code_matches' => $cpfMismatches,
        'matched_pairs_with_missing_cpf' => $missingCpfInEitherMatchedPair,
        'matched_by_cpf' => count($commonCpf),
        'foxpro_cpf_without_employee_match' => count(array_diff_key($foxByCpf, $employeeByCpf)),
        'employee_cpf_without_foxpro_match' => count(array_diff_key($employeeByCpf, $foxByCpf)),
        'exact_name_matches_among_cpf_matches' => $exactNameMatchesByCpf,
    ];
}

function normaliseName(string $value): string
{
    return strtolower(preg_replace('/[^a-z0-9]/i', '', $value) ?? '');
}
