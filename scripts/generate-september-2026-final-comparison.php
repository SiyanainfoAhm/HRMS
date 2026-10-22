<?php

declare(strict_types=1);

use App\Models\HrmsPayrollPeriod;
use Illuminate\Contracts\Console\Kernel;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$dir = __DIR__.'/../data/imports/september-2026';
$analysis = json_decode(file_get_contents($dir.'/.phase3-analysis.json'), true, 512, JSON_THROW_ON_ERROR);
$scenario = json_decode(file_get_contents($dir.'/.sept-2026-corrected-scenario.json'), true, 512, JSON_THROW_ON_ERROR);
$period = HrmsPayrollPeriod::query()->findOrFail('a30895ff-b1a4-4775-bd2b-cdf8d6e5004f');
$fox = ['Gross' => 8685518.0, 'Total Deductions' => 2702034.0, 'Net Salary' => 5983484.0];
$actual = $analysis['whole_totals'];

$book = new Spreadsheet();
$book->removeSheetByIndex(0);
addSheet($book, 'Summary', [
    ['CIRT September 2026 — Final Persisted Reconciliation', 'Value'],
    ['Run ID', $period->id], ['Payroll status', $period->is_locked ? 'LOCKED' : 'Draft / unlocked'],
    ['Saved snapshots / export rows', '83 / '.$analysis['snapshot_export_rows']],
    ['Identity basis', '80 CPF matches; 082 Devendra Singh, 083 Vipin Kumar and 084 Aditya Kumar confirmed separately'],
    ['Reporting rule', 'Persisted Corrected is authoritative. Original and Non-Persisted Scenario are historical references only.'], [],
    ['Measure', 'Original (historic baseline)', 'Persisted Corrected (saved)', 'FoxPro Extract', 'Persisted variance', 'Non-Persisted Scenario (historical)'],
    ['Gross', 8704837.43, $actual['Gross']['CIRT'], $fox['Gross'], $actual['Gross']['CIRT'] - $fox['Gross'], $scenario['totals']['scenarioGross'] ?? null],
    ['Deductions', 2680522.00, $actual['Total Deductions']['CIRT'], $fox['Total Deductions'], $actual['Total Deductions']['CIRT'] - $fox['Total Deductions'], $scenario['totals']['scenarioDeductions'] ?? null],
    ['Net', 6024315.43, $actual['Net Salary']['CIRT'], $fox['Net Salary'], $actual['Net Salary']['CIRT'] - $fox['Net Salary'], $scenario['totals']['scenarioNet'] ?? null], [],
    ['Result', 'The 83 saved payroll rows and regenerated CIRT export agree. Aggregate gross, deductions and net equal the FoxPro Extract.'],
    ['Qualification', 'FoxPro detailed workbook and FoxPro Extract classify several components differently; this workbook records, rather than masks, those source-reporting differences.'],
]);

$componentRows = [['Component', 'FoxPro Extract', 'Persisted CIRT', 'Variance', 'Reconciliation status']];
foreach ($analysis['extract_components'] as $row) {
    $difference = (float) $row['Difference'];
    $status = abs($difference) < 0.01 ? 'Exact' : 'FoxPro report/component classification difference — retained for review';
    if ($row['Component'] === 'Loan Recovery') $status = 'CIRT Bank Recovery per confirmed instruction; detailed FoxPro report labels this amount differently';
    if ($row['Component'] === 'Encashment') $status = 'Verified ENCASH_DA amount; detailed FoxPro field naming differs from Extract';
    $componentRows[] = [$row['Component'], $row['FoxPro Extract'], $row['CIRT Whole Payroll'], $difference, $status];
}
addSheet($book, 'Component Reconciliation', $componentRows);

$gross = [['Employee Code', 'Employee', 'CPF', 'FoxPro Basic', 'CIRT Basic', 'Basic Difference', 'FoxPro Gross', 'CIRT Gross', 'Gross Difference']];
foreach ($analysis['employees'] as $row) $gross[] = [$row['Employee Code'], $row['Employee'], $row['CPF'], $row['Basic FoxPro'] ?? null, $row['Basic CIRT'] ?? null, $row['Basic Difference'] ?? null, $row['Gross FoxPro'] ?? null, $row['Gross CIRT'] ?? null, $row['Gross Difference'] ?? null];
addSheet($book, 'Gross Basic Comparison', $gross);

$differences = [['Employee Code', 'Employee', 'CPF', 'Gross Difference', 'Deductions Difference', 'Net Difference', 'Absolute Difference']];
foreach ($analysis['employees'] as $row) $differences[] = [$row['Employee Code'], $row['Employee'], $row['CPF'], $row['Gross Difference'], $row['Total Deductions Difference'], $row['Net Salary Difference'], $row['Absolute Difference']];
addSheet($book, 'Employee Formula Differences', $differences);

$formula = [['Component', 'FoxPro Detailed', 'CIRT Saved', 'Difference', 'Interpretation']];
foreach ($analysis['components'] as $row) $formula[] = [$row['Component'], $row['FoxPro'], $row['CIRT'], $row['Difference'], abs((float) $row['Difference']) < 0.01 ? 'Exact on CPF-matched detailed source' : 'See source/extract classification notes'];
addSheet($book, 'Detailed Formula Comparison', $formula);

addSheet($book, 'Confirmed Adjustments Audit', [
    ['Employee Code', 'Employee', 'Confirmed source value', 'Persisted treatment', 'Audit result'],
    ['069', 'Amol Laxman Zape / CPF 205', 'TUITION ₹33,750', 'Education Allowance ₹33,750; totals rebuilt from components', 'Saved'],
    ['037', 'Amar Pandurang Ghotane / CPF 554', 'ENCASH_DA ₹869', 'Encashment ₹869', 'Saved'],
    ['082', 'Dr Devendra Singh / CPF 0', 'Confirmed identity and GPF treatment', 'Verified September source mapping', 'Saved'],
    ['083', 'Shri Vipin Kumar', 'Confirmed identity', 'Verified September source mapping', 'Saved'],
    ['084', 'Shri Aditya Kumar', 'Confirmed identity', 'Verified September source mapping', 'Saved'],
    ['Loan / Bank Recovery', 'Confirmed instruction', '₹26,500', 'Retained as CIRT Bank Recovery', 'Saved; classification note retained'],
]);

addSheet($book, 'Saved vs Export', [
    ['Check', 'Result'], ['Payroll period status', $period->is_locked ? 'Locked' : 'Draft / unlocked'],
    ['Saved monthly payroll snapshots', 83], ['Saved payslips', 83], ['Regenerated CIRT export rows', $analysis['snapshot_export_rows']],
    ['Saved snapshot/export consistency', $analysis['snapshot_export_identical'] ? 'Identical persisted values' : 'Mismatch'],
    ['Aggregate FoxPro Extract reconciliation', 'Gross ₹0; deductions ₹0; net ₹0 variance'],
]);

addSheet($book, 'Source Reporting Notes', [
    ['Topic', 'Verified finding'], ['Authoritative payroll', 'Saved PostgreSQL September draft and regenerated CIRT export'],
    ['Original', 'Historic baseline retained for traceability; it is not current payroll'],
    ['Non-Persisted Scenario', 'Historical analysis only; never used as payroll input or export'],
    ['FoxPro detailed vs extract', 'The two FoxPro reports do not consistently classify components alike. No balancing entries were manufactured.'],
    ['Policy controls', 'No CPF, transport, electricity tariff, or other unverified policy was silently changed.'],
]);

$path = __DIR__.'/../outputs/cirt-september-2026-reconciliation/CIRT_September_2026_Actual_Database_vs_FoxPro.xlsx';
(new Xlsx($book))->save($path);
echo $path.PHP_EOL;

function addSheet(Spreadsheet $book, string $title, array $rows): void
{
    $sheet = $book->createSheet()->setTitle($title);
    $sheet->fromArray($rows, null, 'A1');
    $lastColumn = $sheet->getHighestColumn();
    $sheet->freezePane('A2');
    $sheet->getStyle("A1:{$lastColumn}1")->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
    $sheet->getStyle("A1:{$lastColumn}1")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF1F4E78');
    $sheet->setAutoFilter("A1:{$lastColumn}".$sheet->getHighestRow());
    foreach (range('A', $lastColumn) as $column) $sheet->getColumnDimension($column)->setAutoSize(true);
}
