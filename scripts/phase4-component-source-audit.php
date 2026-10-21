<?php
declare(strict_types=1);
use PhpOffice\PhpSpreadsheet\IOFactory;
require __DIR__.'/../backend/vendor/autoload.php';

$path=__DIR__.'/../data/imports/september-2026/Salary Data as on 15.10.2026.xlsx';
$sheet=IOFactory::load($path)->getSheetByName('Employee Payroll');
if(!$sheet) throw new RuntimeException('Employee Payroll sheet missing');
$headers=[];foreach($sheet->getRowIterator(1,1)->current()->getCellIterator() as $c)$headers[strtolower(trim((string)$c->getValue()))]=$c->getColumn();
$wanted=['Education Allowance'=>'education allowance','Special Allowance'=>'special_allowance','Arrears'=>'arrears','Encashment'=>'encashment_arrears','Electricity'=>'electricity','Electricity Units'=>'electricity units','GPF'=>'gpf'];
$out=[];foreach($wanted as $label=>$key){$sum=0;$nonzero=0;$present=isset($headers[$key]);if($present)for($r=2;$r<=$sheet->getHighestDataRow();$r++){$v=str_replace([',','₹',' '],'',(string)$sheet->getCell($headers[$key].$r)->getFormattedValue());$n=is_numeric($v)?(float)$v:0;$sum+=$n;if($n!=0)$nonzero++;}$out[$label]=['source_column'=>$present?$key:null,'total'=>$sum,'nonzero_rows'=>$nonzero];}
echo json_encode($out,JSON_PRETTY_PRINT).PHP_EOL;
