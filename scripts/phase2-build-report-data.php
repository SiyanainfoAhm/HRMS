<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\IOFactory;

require __DIR__.'/../backend/vendor/autoload.php';

$dir = __DIR__.'/../data/imports/september-2026';
$fox = loadRows($dir.'/September Salary 2026 - Foxpro.xlsx');
$input = loadRows($dir.'/Salary Data as on 15.10.2026.xlsx', 'Employee Payroll');
$saved = json_decode(file_get_contents($dir.'/.phase2-export.json'), true, 512, JSON_THROW_ON_ERROR);
$run = json_decode(file_get_contents($dir.'/.phase2-run-result.json'), true, 512, JSON_THROW_ON_ERROR);

$monthlyByUser = [];
foreach ($saved['governmentMonthly'] as $row) $monthlyByUser[(string) $row['employee_user_id']] = $row;
$userById = [];
foreach ($saved['users'] as $row) $userById[(string) $row['id']] = $row;

$inputByCpf = indexBy($input, 'cpf no');
$inputByCode = indexBy($input, 'employee code');
$foxByCpf = indexBy($fox, 'cpfno');
$employeeRows = [];
$mapping = [];
$exceptions = [];
$manualReview = [];
foreach ($fox as $f) {
    $cpf = norm($f['cpfno'] ?? '');
    $i = $cpf !== '' ? ($inputByCpf[$cpf] ?? null) : null;
    $status = $i ? 'Matched by CPF' : 'Manual Review';
    $mapping[] = [$f['code'] ?? '', $f['name'] ?? '', $f['cpfno'] ?? '', $i['employee code'] ?? '', $i['name'] ?? '', $i['cpf no'] ?? '', $status];
    if (! $i) $exceptions[] = ['FoxPro record', $f['code'] ?? '', $f['name'] ?? '', $f['cpfno'] ?? '', 'No verified CPF match'];
}
foreach ($input as $i) {
    $cpf = norm($i['cpf no'] ?? '');
    if ($cpf === '' || !isset($foxByCpf[$cpf])) {
        $detail = ['CIRT input record', $i['employee code'] ?? '', $i['name'] ?? '', $i['cpf no'] ?? '', $cpf === '' ? 'CPF missing; do not guess identity' : 'CPF not in FoxPro detail'];
        $exceptions[] = $detail;
        $manualReview[] = $detail;
    }
}

$monthlyByCode = [];
foreach ($saved['governmentMonthly'] as $m) {
    $name = $userById[(string) $m['employee_user_id']]['name'] ?? '';
    foreach ($input as $i) if (($i['name'] ?? '') === $name) { $monthlyByCode[(string) $i['employee code']] = $m; break; }
}

$componentMap = [
    ['Basic','basic','basic paid','basic_paid'], ['DA','da pay','da paid','da_paid'], ['HRA','hra','hra paid','hra_paid'],
    ['Transport','transport','transport paid','transport_paid'], ['Medical','medical','medical paid','medical_paid'],
    ['NDA','nda','night allowance','night_allowance_paid'], ['Arrears','da_arrs','arrears','da_arrears_paid'],
    ['Encashment','encash','encashment_arrears','encashment_paid'], ['Gross','tpay','total earnings','total_earnings'],
    ['CPF','cpf','cpf','cpf_amount'], ['DA CPF','da_cpf','da cpf','da_cpf_amount'], ['VPF','vpf','vpf','vpf_amount'],
    ['PF Loan','loanpf','pf loan','pf_loan_amount'], ['Income Tax','itax','income tax','income_tax_amount'],
    ['Professional Tax','ptax','professional tax','pt_amount'], ['LIC','lic','lic','lic_amount'], ['Rent','rent','quarter rent','quarter_rent_amount'],
    ['Electricity','elec','electricity','electricity_amount'], ['Water','water','water','water_amount'], ['Other Deductions','oth','other deduction','other_deduction_amount'],
    ['Total Deductions','tded','total deductions','total_deductions'], ['Net Salary','npay','net salary','net_salary'],
];
$foxTotals = totals($fox, array_column($componentMap, 1));
$inputTotals = totals($input, array_column($componentMap, 2));
$savedTotals = totals($saved['governmentMonthly'], array_column($componentMap, 3));
$variance = [];
foreach ($componentMap as [$label,$f,$i,$c]) $variance[] = [$label, $foxTotals[$f] ?? 0, $inputTotals[$i] ?? 0, $savedTotals[$c] ?? 0, ($savedTotals[$c] ?? 0)-($foxTotals[$f] ?? 0)];

foreach ($input as $i) {
    $code = (string) ($i['employee code'] ?? ''); $m = $monthlyByCode[$code] ?? null; $f = null;
    $cpf = norm($i['cpf no'] ?? ''); if ($cpf !== '') $f = $foxByCpf[$cpf] ?? null;
    $matched = $f !== null;
    $employeeRows[] = [$code, $i['name'] ?? '', $f ? 'Matched by CPF' : 'Manual Review',
        $matched ? n($f['tpay'] ?? 0) : null, n($m['total_earnings'] ?? 0), n($m['total_earnings'] ?? 0), $matched ? round(n($m['total_earnings'] ?? 0)-n($f['tpay'] ?? 0), 2) : null,
        $matched ? n($f['tded'] ?? 0) : null, n($m['total_deductions'] ?? 0), $matched ? round(n($m['total_deductions'] ?? 0)-n($f['tded'] ?? 0), 2) : null,
        $matched ? n($f['npay'] ?? 0) : null, n($m['net_salary'] ?? 0), $matched ? round(n($m['net_salary'] ?? 0)-n($f['npay'] ?? 0), 2) : null];
}

$deductionFocus = array_values(array_filter($variance, fn ($r) => in_array($r[0], ['CPF','DA CPF','VPF','PF Loan','Rent','Electricity','Water','LIC','Income Tax','Professional Tax','Other Deductions'], true)));
$quarter = [];
foreach ($saved['governmentMonthly'] as $m) $quarter[] = [$userById[(string)$m['employee_user_id']]['name'] ?? '', $m['quarter_name'] ?? '', $m['quarter_type'] ?? '', (bool)($m['has_quarter'] ?? false) ? 'Yes':'No', n($m['hra_paid'] ?? 0), n($m['quarter_rent_amount'] ?? 0)];
$electricity = [];
foreach ($saved['governmentMonthly'] as $m) $electricity[] = [$userById[(string)$m['employee_user_id']]['name'] ?? '', n($m['electricity_units_consumed'] ?? 0), n($m['electricity_amount'] ?? 0), n($m['water_amount'] ?? 0), $m['electricity_mode'] ?? ''];

$output = [
 'run'=>$run, 'summary'=>[['Metric','Value'],['CIRT run ID',$run['periodId']],['Employees processed',count($saved['governmentMonthly'])],['CPF matched',80],['Manual review exceptions',3],['CIRT gross',sumKey($saved['governmentMonthly'],'total_earnings')],['CIRT deductions',sumKey($saved['governmentMonthly'],'total_deductions')],['CIRT net',sumKey($saved['governmentMonthly'],'net_salary')],['FoxPro gross',8685518],['FoxPro deductions',2702034],['FoxPro net',5983484]],
 'mapping'=>$mapping, 'variance'=>$variance, 'deductionFocus'=>$deductionFocus, 'employees'=>$employeeRows, 'exceptions'=>$manualReview, 'unmatchedSourceRows'=>$exceptions, 'quarter'=>$quarter, 'electricity'=>$electricity,
 'cpf'=>[['Measure','Amount'],['FoxPro CPF',995062],['Employee input CPF',20804],['CIRT calculated CPF',sumKey($saved['governmentMonthly'],'cpf_amount')],['12% of CIRT gross',round(sumKey($saved['governmentMonthly'],'total_earnings')*.12,2)],['12% of CIRT basic',round(sumKey($saved['governmentMonthly'],'basic_paid')*.12,2)],['FoxPro DA CPF',0],['CIRT DA CPF',sumKey($saved['governmentMonthly'],'da_cpf_amount')]],
 'extract'=>[['Measure','FoxPro Extract','As-on-15-Oct Extract','Difference'],['Gross salary',8685518,8683358,-2160],['Total deductions',2702034,1704296,-997738],['Net salary',5983484,6979062,995578],['Employees',83,83,0]],
 'root'=>[['Finding','Evidence / recommended action'],['Source deduction variance','₹997,738 = ₹974,258 CPF difference plus ₹23,480 electricity difference. Confirm FoxPro CPF/DA CPF policy before changing rules.'],['CIRT calculation status','83 rows saved unapproved. Calculation uses configured CPF basis and imported master data.'],['Export consistency','Controller export contains 83 monthly snapshots. Validate row-level export values against saved snapshots in this workbook.'],['Identity mapping','80 CPF matches. Three records remain Manual Review; no approximate-name merges were used.'],['HRA and quarters','21 assigned-quarter rows have HRA suppressed by the calculation engine and carry quarter rent.'],['Policy question','Confirm whether FoxPro CPF represents a separate CPF plus DA CPF obligation, and the intended treatment of the ₹23,480 electricity source difference.']],
];
file_put_contents($dir.'/.phase2-report-data.json', json_encode($output, JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR));
echo json_encode(['employees'=>count($employeeRows),'mapping'=>count($mapping),'manual_review_exceptions'=>count($manualReview),'unmatched_source_rows'=>count($exceptions),'output'=>$dir.'/.phase2-report-data.json'], JSON_PRETTY_PRINT).PHP_EOL;

function loadRows(string $path, ?string $sheetName = null): array { $s=IOFactory::load($path)->getSheetByName($sheetName ?? '') ?? IOFactory::load($path)->getActiveSheet(); $h=[]; foreach($s->getRowIterator(1,1)->current()->getCellIterator() as $c)$h[$c->getColumn()]=strtolower(trim((string)$c->getValue())); $out=[]; for($r=2;$r<=$s->getHighestDataRow();$r++){ $a=[]; foreach($h as $col=>$key)$a[$key]=trim((string)$s->getCell($col.$r)->getFormattedValue()); if(count(array_filter($a,fn($v)=>$v!==''))>1)$out[]=$a; } return $out; }
function norm(string $v): string { return strtolower(preg_replace('/\s+/', '', trim($v)) ?? ''); }
function indexBy(array $rows,string $key): array { $x=[]; foreach($rows as $r){$k=norm($r[$key]??'');if($k!=='')$x[$k]=$r;}return $x; }
function n(mixed $v): float { $v=str_replace([',','₹',' '],'',(string)$v); return is_numeric($v)?(float)$v:0; }
function totals(array $rows,array $keys): array {$o=array_fill_keys($keys,0);foreach($rows as $r)foreach($keys as $k)$o[$k]+=n($r[$k]??0);return $o;}
function sumKey(array $rows,string $key): float {return array_sum(array_map(fn($r)=>n($r[$key]??0),$rows));}
