<?php

declare(strict_types=1);

use App\Models\HrmsCompany;
use App\Models\HrmsQuarter;
use App\Models\HrmsUser;
use App\Services\PayrollMasterService;
use App\Services\QuarterService;
use App\Services\QuarterTypeService;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date;

require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$admin = HrmsUser::query()->where('role', 'super_admin')->sole();
$company = HrmsCompany::query()->findOrFail($admin->company_id);
$company->update(['default_da_percent' => 60]);

$source = __DIR__.'/../data/imports/september-2026/Salary Data as on 15.10.2026.xlsx';
$sheet = IOFactory::load($source)->getSheetByName('Employee Payroll');
if (! $sheet) {
    throw new RuntimeException('Employee Payroll sheet is missing.');
}

$headers = [];
foreach ($sheet->getRowIterator(1, 1)->current()->getCellIterator() as $cell) {
    $headers[normaliseHeader((string) $cell->getValue())] = $cell->getColumn();
}
$required = ['employee code', 'name', 'email', 'pay level', 'basic paid', 'cpf no'];
foreach ($required as $header) {
    if (! isset($headers[$header])) {
        throw new RuntimeException("Required source column is missing: {$header}");
    }
}

$quarterTypes = $app->make(QuarterTypeService::class);
$quarters = $app->make(QuarterService::class);
$masters = $app->make(PayrollMasterService::class);
$report = ['quarters_created' => 0, 'quarter_types_created' => 0, 'employees_imported' => 0, 'failed_rows' => []];

// Create source quarter masters before employee payroll masters reference them.
for ($row = 2; $row <= $sheet->getHighestDataRow(); $row++) {
    if (! isYes(sourceValue($sheet, $headers, 'quarter assigned', $row))) {
        continue;
    }
    $name = trim(sourceValue($sheet, $headers, 'quarter name', $row));
    $type = trim(sourceValue($sheet, $headers, 'quarter type', $row));
    if ($name === '' || $type === '') {
        throw new RuntimeException("Quarter data missing on source row {$row}");
    }
    try {
        $quarterTypes->resolveForCompany($company->id, null, $type);
    } catch (\Throwable) {
        $quarterTypes->create($company->id, $admin->id, ['name' => $type]);
        $report['quarter_types_created']++;
    }
    $existing = $quarters->findByName($company->id, $name);
    if (! $existing) {
        $quarters->create($company->id, $admin->id, [
            'quarter_name' => $name,
            'quarter_type' => $type,
            'monthly_rent' => number(sourceValue($sheet, $headers, 'quarter rent', $row)),
        ]);
        $report['quarters_created']++;
    }
}

for ($row = 2; $row <= $sheet->getHighestDataRow(); $row++) {
    $code = sourceValue($sheet, $headers, 'employee code', $row, true);
    if ($code === '') {
        continue;
    }
    $basic = number(sourceValue($sheet, $headers, 'basic paid', $row));
    $hra = number(sourceValue($sheet, $headers, 'hra paid', $row));
    $hasQuarter = isYes(sourceValue($sheet, $headers, 'quarter assigned', $row));
    $payload = [
        'employee_code' => $code,
        'name' => sourceValue($sheet, $headers, 'name', $row),
        'email' => sourceValue($sheet, $headers, 'email', $row),
        'user_role' => 'employee',
        'password' => 'Reset@'.$code.'!2026',
        'confirm_password' => 'Reset@'.$code.'!2026',
        'phone' => sourceValue($sheet, $headers, 'phone', $row),
        'designation' => sourceValue($sheet, $headers, 'designation', $row),
        'department' => sourceValue($sheet, $headers, 'department', $row),
        'division' => sourceValue($sheet, $headers, 'division', $row),
        'status' => strtolower(sourceValue($sheet, $headers, 'status', $row)) ?: 'active',
        'pay_level' => number(sourceValue($sheet, $headers, 'pay level', $row)),
        'increment_month' => 'July',
        'gross_basic_pay' => $basic,
        'da_percent' => 60,
        // Preserve the source-paid HRA when the master calculator reconstructs
        // it. Rounding the derived percentage to two decimals changed the
        // September aggregate by ₹4.57; storage/calculation round the money,
        // not this intermediate ratio.
        'hra_percent' => $hasQuarter ? 0 : ($basic > 0 ? (($hra / $basic) * 100) : 30),
        'medical' => number(sourceValue($sheet, $headers, 'medical paid', $row)),
        'uan' => sourceValue($sheet, $headers, 'uan', $row),
        'cpf_no' => sourceValue($sheet, $headers, 'cpf no', $row, true),
        'pan' => sourceValue($sheet, $headers, 'pan', $row, true),
        'aadhaar' => sourceValue($sheet, $headers, 'aadhaar', $row, true),
        'bank_name' => sourceValue($sheet, $headers, 'bank name', $row),
        'bank_account_number' => sourceValue($sheet, $headers, 'bank account number', $row, true),
        'bank_ifsc' => sourceValue($sheet, $headers, 'ifsc', $row, true),
        'date_of_joining' => dateValue($sheet, $headers, 'date of joining', $row),
        'date_of_birth' => dateValue($sheet, $headers, 'date of birth', $row),
        'effective_from' => '2026-09-01',
        'quarter_assigned' => $hasQuarter,
        'quarter_name' => sourceValue($sheet, $headers, 'quarter name', $row),
        'quarter_type' => sourceValue($sheet, $headers, 'quarter type', $row),
        'quarter_rent' => number(sourceValue($sheet, $headers, 'quarter rent', $row)),
        'income_tax' => number(sourceValue($sheet, $headers, 'income tax', $row)),
        'professional_tax' => number(sourceValue($sheet, $headers, 'professional tax', $row)),
        'lic' => number(sourceValue($sheet, $headers, 'lic', $row)),
        'cpf_default' => number(sourceValue($sheet, $headers, 'cpf', $row)),
        'da_cpf' => number(sourceValue($sheet, $headers, 'da cpf', $row)),
        'vpf' => number(sourceValue($sheet, $headers, 'vpf', $row)),
        'pf_loan' => number(sourceValue($sheet, $headers, 'pf loan', $row)),
        'post_office' => number(sourceValue($sheet, $headers, 'post office', $row)),
        'credit_society' => number(sourceValue($sheet, $headers, 'credit society', $row)),
        'standard_licence_fee' => number(sourceValue($sheet, $headers, 'standard licence fee', $row)),
        'electricity' => number(sourceValue($sheet, $headers, 'electricity', $row)),
        'water' => number(sourceValue($sheet, $headers, 'water', $row)),
        'mess' => number(sourceValue($sheet, $headers, 'mess', $row)),
        'loan_recovery' => number(sourceValue($sheet, $headers, 'bank / loan recovery', $row)),
        'welfare' => number(sourceValue($sheet, $headers, 'welfare', $row)),
        'vehicle_charge' => number(sourceValue($sheet, $headers, 'vehicle charge', $row)),
        'other_deduction' => number(sourceValue($sheet, $headers, 'other deduction', $row)),
    ];
    if ($hasQuarter) {
        $quarter = $quarters->findByName($company->id, $payload['quarter_name']);
        if (! $quarter) {
            throw new RuntimeException("Quarter was not created for source row {$row}");
        }
        $payload['quarter_id'] = $quarter->id;
    }
    try {
        $masters->create($payload, $company->id, $admin->id);
        $report['employees_imported']++;
    } catch (\Throwable $error) {
        $report['failed_rows'][] = ['row' => $row, 'employee_code' => $code, 'error' => $error->getMessage()];
    }
}

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;

function normaliseHeader(string $value): string { return trim(strtolower($value)); }
function sourceValue($sheet, array $headers, string $header, int $row, bool $formatted = false): string {
    $column = $headers[$header] ?? null;
    if (! $column) return '';
    $cell = $sheet->getCell($column.$row);
    return trim((string) ($formatted ? $cell->getFormattedValue() : $cell->getValue()));
}
function number(string $value): float { $value = str_replace([',', '₹', ' '], '', $value); return is_numeric($value) ? (float) $value : 0.0; }
function isYes(string $value): bool { return in_array(strtolower(trim($value)), ['yes', 'y', 'true', '1'], true); }
function dateValue($sheet, array $headers, string $header, int $row): ?string {
    $column = $headers[$header] ?? null;
    if (! $column) return null;
    $value = $sheet->getCell($column.$row)->getValue();
    if (is_numeric($value) && Date::isDateTime($sheet->getCell($column.$row))) return Carbon::instance(Date::excelToDateTimeObject((float) $value))->toDateString();
    return trim((string) $value) ?: null;
}
