<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\IOFactory;

require __DIR__.'/../backend/vendor/autoload.php';

$sheet = IOFactory::load(__DIR__.'/../data/imports/september-2026/September Salary 2026 - Foxpro.xlsx')->getActiveSheet();
$headers = [];
foreach ($sheet->getRowIterator(1, 1)->current()->getCellIterator() as $cell) {
    $headers[strtolower(trim((string) $cell->getValue()))] = $cell->getColumn();
}

$keys = ['ewa', 'tuition', 'sppay', 'da_arrs', 'encash', 'encash_da', 'tel', 'cpf', 'fp', 'elec', 'transport', 'hra', 'da', 'tpay', 'tded', 'npay'];
$out = [];
foreach ($keys as $key) {
    $sum = 0.0;
    $rows = [];
    $column = $headers[$key] ?? null;
    if ($column !== null) {
        for ($row = 2; $row <= $sheet->getHighestDataRow(); $row++) {
            $raw = (string) $sheet->getCell($column.$row)->getFormattedValue();
            $amount = amount($raw);
            $sum += $amount;
            if ($amount != 0.0) {
                $rows[] = [
                    'code' => (string) $sheet->getCell(($headers['code'] ?? 'A').$row)->getFormattedValue(),
                    'cpf_no' => (string) $sheet->getCell(($headers['cpfno'] ?? 'A').$row)->getFormattedValue(),
                    'name' => (string) $sheet->getCell(($headers['name'] ?? 'A').$row)->getFormattedValue(),
                    'amount' => $amount,
                ];
            }
        }
    }
    $out[$key] = ['column' => $column, 'total' => $sum, 'nonzero_rows' => $rows];
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;

function amount(string $raw): float
{
    $value = str_replace([',', '₹', ' '], '', trim($raw));

    return is_numeric($value) ? (float) $value : 0.0;
}
