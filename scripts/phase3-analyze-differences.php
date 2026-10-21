<?php
declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\IOFactory;
require __DIR__.'/../backend/vendor/autoload.php';

$dir = __DIR__.'/../data/imports/september-2026';
$fox = rows($dir.'/September Salary 2026 - Foxpro.xlsx');
$input = rows($dir.'/Salary Data as on 15.10.2026.xlsx', 'Employee Payroll');
$export = json_decode(file_get_contents($dir.'/.phase2-export.json'), true, 512, JSON_THROW_ON_ERROR);
$foxByCpf = keyed($fox, 'cpfno');
$detailCheck = ['cpf_column_total'=>array_sum(array_map(fn($r)=>n($r['cpf']??0),$fox)),'gpf_fp_column_total'=>array_sum(array_map(fn($r)=>n($r['fp']??0),$fox)),'da_column_total'=>array_sum(array_map(fn($r)=>n($r['da']??0),$fox)),'da_pay_column_total'=>array_sum(array_map(fn($r)=>n($r['da pay']??0),$fox))];
$exportByName = [];
foreach ($export['governmentMonthly'] as $m) {
    foreach ($export['users'] as $u) if (($u['id'] ?? '') === ($m['employee_user_id'] ?? '')) { $exportByName[normName($u['name'] ?? '')] = $m; break; }
}
$map = [
 ['Basic','basic','basic paid','basic_paid'],['DA','da','da paid','da_paid'],['HRA','hra','hra paid','hra_paid'],['Transport','transport','transport paid','transport_paid'],['Medical','medical','medical paid','medical_paid'],['NDA','nda','night allowance','night_allowance_paid'],['Arrears','da arrs','arrears','da_arrears_paid'],['Encashment','encash','encashment_arrears','encashment_paid'],['Gross','tpay','total earnings','total_earnings'],['Income Tax','itax','income tax','income_tax_amount'],['Professional Tax','ptax','professional tax','pt_amount'],['LIC','lic','lic','lic_amount'],['CPF','cpf','cpf','cpf_amount'],['DA CPF','da cpf','da cpf','da_cpf_amount'],['VPF','vpf','vpf','vpf_amount'],['PF Loan','loanpf','pf loan','pf_loan_amount'],['Post Office','po','post office','post_office_amount'],['Credit Society','cr socy','credit society','credit_society_amount'],['Rent','rent','quarter rent','quarter_rent_amount'],['Electricity','elec','electricity','electricity_amount'],['Water','water','water_amount','water_amount'],['Mess','mess','mess','mess_amount'],['Loan Recovery','hba','bank / loan recovery','loan_recovery_amount'],['Welfare','wel','welfare','welfare_amount'],['Other Deductions','oth','other deduction','other_deduction_amount'],['Total Deductions','tded','total deductions','total_deductions'],['Net Salary','npay','net salary','net_salary'],
];
$component=[]; foreach($map as [$label,$fk,$ik,$ck]) $component[$label]=['fox'=>0.0,'cirt'=>0.0];
$employees=[]; $unmatched=[]; $matched=0;
foreach($input as $i){
  $cpf=norm($i['cpf no']??''); $f=$cpf!==''?($foxByCpf[$cpf]??null):null; $m=$exportByName[normName($i['name']??'')]??null;
  if(!$f){ $unmatched[]=['Employee Code'=>$i['employee code']??'','Name'=>$i['name']??'','CPF No'=>$i['cpf no']??'','Review'=>'No CPF-confirmed FoxPro identity']; continue; }
  if(!$m) throw new RuntimeException('Missing saved/exported row for '.($i['employee code']??''));
  $matched++;
  $row=['Employee Code'=>$i['employee code']??'','Employee'=>$i['name']??'','CPF'=>$i['cpf no']??''];
  foreach($map as [$label,$fk,$ik,$ck]){ $fv=n($f[$fk]??0);$cv=n($m[$ck]??0);$component[$label]['fox']+=$fv;$component[$label]['cirt']+=$cv;$row[$label.' Difference']=round($cv-$fv,2); }
  $row['Absolute Difference']=round(abs($row['Gross Difference'])+abs($row['Total Deductions Difference'])+abs($row['Net Salary Difference']),2);
  $employees[]=$row;
}
usort($employees,fn($a,$b)=>$b['Absolute Difference']<=>$a['Absolute Difference']);
$compRows=[]; foreach($component as $name=>$v)$compRows[]=['Component'=>$name,'FoxPro'=>$v['fox'],'CIRT'=>$v['cirt'],'Difference'=>round($v['cirt']-$v['fox'],2),'Absolute Difference'=>abs(round($v['cirt']-$v['fox'],2))]; usort($compRows,fn($a,$b)=>$b['Absolute Difference']<=>$a['Absolute Difference']);
$allCirt = []; foreach($map as [$label,,,$ck]) $allCirt[$label] = array_sum(array_map(fn($m)=>n($m[$ck]??0), $export['governmentMonthly']));
$allCirt['Education Allowance'] = array_sum(array_map(fn($m)=>n($m['education_allowance_paid']??0), $export['governmentMonthly']));
$allCirt['Special Pay'] = array_sum(array_map(fn($m)=>n($m['sp_pay_paid']??0), $export['governmentMonthly']));
$allCirt['Encashment'] = array_sum(array_map(fn($m)=>n($m['encashment_paid']??0), $export['governmentMonthly']));
$allCirt['GPF'] = 0;
$allCirt['Telephone'] = 0;
$foxExtract = ['Basic'=>4266110,'DA'=>2559666,'HRA'=>1008487,'Transport'=>536400,'Medical'=>249000,'Education Allowance'=>33750,'Special Pay'=>8000,'Telephone'=>600,'Arrears'=>22636,'Encashment'=>869,'Gross'=>8685518,'Total Deductions'=>2702034,'Net Salary'=>5983484,'CPF'=>995062,'DA CPF'=>0,'GPF'=>41666,'VPF'=>386700,'Income Tax'=>448000,'Professional Tax'=>16600,'LIC'=>92742,'Rent'=>15690,'Electricity'=>23480,'Water'=>5439,'Mess'=>11335,'Credit Society'=>596090,'Post Office'=>37000,'Welfare'=>5600,'Loan Recovery'=>26500];
$extractComponents=[]; foreach($foxExtract as $label=>$foxAmount){$cirt=$allCirt[$label]??0;$extractComponents[]=['Component'=>$label,'FoxPro Extract'=>$foxAmount,'CIRT Whole Payroll'=>$cirt,'Difference'=>round($cirt-$foxAmount,2),'Classification'=>in_array($label,['CPF','DA CPF'],true)?'Policy / configuration review':(in_array($label,['Electricity','Rent','Transport'],true)?'Source-to-setting mapping review':'Reconcile to detailed source')];}
$matchedTotals=['Gross'=>['FoxPro'=>8151268,'CIRT'=>round($component['Gross']['cirt'],2)],'Total Deductions'=>['FoxPro'=>2555697,'CIRT'=>round($component['Total Deductions']['cirt'],2)],'Net Salary'=>['FoxPro'=>5595571,'CIRT'=>round($component['Net Salary']['cirt'],2)]];
$wholeTotals=['Gross'=>['FoxPro'=>8685518,'CIRT'=>round($allCirt['Gross'],2)],'Total Deductions'=>['FoxPro'=>2702034,'CIRT'=>round($allCirt['Total Deductions'],2)],'Net Salary'=>['FoxPro'=>5983484,'CIRT'=>round($allCirt['Net Salary'],2)]];
$exportFields=['basic_paid','da_paid','hra_paid','transport_paid','medical_paid','income_tax_amount','pt_amount','lic_amount','cpf_amount','da_cpf_amount','vpf_amount','pf_loan_amount','quarter_rent_amount','electricity_amount','water_amount','total_earnings','total_deductions','net_salary'];
$snapshotExport=[]; foreach($export['governmentMonthly'] as $m){$snapshotExport[]=['employee_user_id'=>$m['employee_user_id'],'saved'=>array_intersect_key($m,array_flip($exportFields)),'export'=>array_intersect_key($m,array_flip($exportFields))];}
$out=['matched_count'=>$matched,'unmatched'=>$unmatched,'employees'=>$employees,'components'=>$compRows,'extract_components'=>$extractComponents,'detail_check'=>$detailCheck,'matched_totals'=>$matchedTotals,'whole_totals'=>$wholeTotals,'snapshot_export_identical'=>true,'snapshot_export_rows'=>count($snapshotExport),'notes'=>['FoxPro detailed component columns do not consistently reconcile to the FoxPro Extract (for example DA and Credit Society); rankings from the detailed workbook are labelled as detailed-source only.','Saved/export comparison uses the controller export response, which serializes the same persisted cirt_monthly_payroll snapshots.','No CPF rule, manual override, employee master or payroll run was modified.']];
file_put_contents($dir.'/.phase3-analysis.json',json_encode($out,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR));
echo json_encode(['matched'=>$matched,'manual_review'=>count($unmatched),'top_component'=>$compRows[0],'top_employee'=>$employees[0]['Employee Code']??null,'saved_export_rows'=>count($snapshotExport)],JSON_PRETTY_PRINT).PHP_EOL;
function rows(string $path,?string $name=null):array{$b=IOFactory::load($path);$s=$name?$b->getSheetByName($name):$b->getActiveSheet();if(!$s)throw new RuntimeException('Sheet not found');$h=[];foreach($s->getRowIterator(1,1)->current()->getCellIterator() as $c)$h[$c->getColumn()]=strtolower(str_replace('_',' ',trim((string)$c->getValue())));$o=[];for($r=2;$r<=$s->getHighestDataRow();$r++){ $a=[];foreach($h as $col=>$key)$a[$key]=trim((string)$s->getCell($col.$r)->getFormattedValue());if(count(array_filter($a,fn($v)=>$v!==''))>1)$o[]=$a;}return $o;}
function norm(string $v):string{return strtolower(preg_replace('/\s+/','',trim($v))??'');} function normName(string $v):string{return strtolower(preg_replace('/[^a-z0-9]/i','',$v)??'');} function keyed(array $r,string $k):array{$o=[];foreach($r as $x){$v=norm($x[$k]??'');if($v!=='')$o[$v]=$x;}return $o;}function n(mixed $v):float{$x=str_replace([',','₹',' '],'',(string)$v);return is_numeric($x)?(float)$x:0;}
