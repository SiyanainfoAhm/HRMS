<?php
declare(strict_types=1);

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsUser;
use App\Services\PayrollAmendmentService;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../backend/vendor/autoload.php';
$app=require __DIR__.'/../backend/bootstrap/app.php'; $app->make(Kernel::class)->bootstrap();
$periodId='a30895ff-b1a4-4775-bd2b-cdf8d6e5004f';
$admin=HrmsUser::query()->where('role','super_admin')->sole();
$period=HrmsPayrollPeriod::query()->where('id',$periodId)->where('company_id',$admin->company_id)->firstOrFail();
if($period->is_locked) throw new RuntimeException('September payroll is locked. No action taken.');
$monthly=HrmsGovernmentMonthlyPayroll::query()->where('payroll_period_id',$periodId)->where('company_id',$admin->company_id)->get();
if($monthly->count()!==83) throw new RuntimeException('Expected 83 September snapshots. No action taken.');

// Recoverable point-in-time backup of every row that this correction can change.
$backup=__DIR__.'/../backend/storage/app/backups/cirt_september_component_classification_'.now()->format('Ymd_His').'.json';
file_put_contents($backup,json_encode(['run_id'=>$periodId,'database'=>config('database.default'),'created_at'=>now()->toIso8601String(),'period'=>$period->toArray(),'monthly'=>$monthly->map->toArray()->all()],JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR));

$service=$app->make(PayrollAmendmentService::class); $byCpf=[]; foreach(HrmsPayrollMaster::query()->where('company_id',$admin->company_id)->whereNull('effective_to')->get() as $m)$byCpf[trim((string)$m->cpf_no)]=$m;
$byCode=[]; foreach(HrmsPayrollMaster::query()->where('company_id',$admin->company_id)->whereNull('effective_to')->get() as $m)$byCode[(string)$m->employee_code]=$m;
$plans=[
 ['cpf'=>'554','sp'=>0,'grossArrear'=>22636,'telephone'=>0,'source'=>'FoxPro code 282 SPPAY ₹22,636: September historical arrears'],
 ['cpf'=>'434','sp'=>1000,'grossArrear'=>0,'telephone'=>0,'source'=>'FoxPro code 201 SPPAY ₹1,000: Special Pay'],
 ['cpf'=>'575','sp'=>0,'grossArrear'=>0,'telephone'=>200,'source'=>'FoxPro code 298 SPPAY ₹200: Telephone Allowance'],
 ['cpf'=>'576','sp'=>0,'grossArrear'=>0,'telephone'=>200,'source'=>'FoxPro code 299 SPPAY ₹200: Telephone Allowance'],
 ['cpf'=>'590','sp'=>4000,'grossArrear'=>0,'telephone'=>0,'source'=>'FoxPro code 314 SPPAY ₹4,000: Special Pay'],
 ['cpf'=>'162','sp'=>3000,'grossArrear'=>0,'telephone'=>0,'source'=>'FoxPro code 341 SPPAY ₹3,000: Special Pay'],
 ['cpf'=>'254','sp'=>0,'grossArrear'=>0,'telephone'=>200,'source'=>'FoxPro code 376 SPPAY ₹200: Telephone Allowance'],
];
$rows=[]; $evidence=[];
foreach($plans as $plan){$master=$byCpf[$plan['cpf']]??null;if(!$master)throw new RuntimeException('Verified CPF missing: '.$plan['cpf']);$m=$monthly->firstWhere('employee_user_id',$master->employee_user_id);if(!$m)throw new RuntimeException('September snapshot missing for CPF '.$plan['cpf']);$before=$service->snapshotFromMonthly($m);$row=$before;$row['monthlyPayrollId']=$m->id;$row['spPayPaid']=$plan['sp'];$row['spPayActual']=$plan['sp'];$row['grossArrear']=$plan['grossArrear'];$row['customEarnings']=$before['customEarnings'];if($plan['telephone']===0)unset($row['customEarnings']['telephone_allowance']);else $row['customEarnings']['telephone_allowance']=$plan['telephone'];$row['totalEarnings']=$before['totalEarnings'];$row['totalDeductions']=$before['totalDeductions'];$row['netSalary']=$before['netSalary'];$row['governmentMonthly']=$row;if($service->changedFields($before,$row)!==[])$rows[]=$row;$evidence[]=['employee_code'=>$master->employee_code,'cpf'=>$plan['cpf'],'source'=>$plan['source']];}
// Confirmed identity 084 / FoxPro code 379: source total deductions already equal saved total.
$master=$byCode['084']??null;if(!$master)throw new RuntimeException('Verified employee 084 missing');$m=$monthly->firstWhere('employee_user_id',$master->employee_user_id);$before=$service->snapshotFromMonthly($m);$row=$before;$row['monthlyPayrollId']=$m->id;$row['cpf']=10190;$row['electricity']=827;$row['totalEarnings']=$before['totalEarnings'];$row['totalDeductions']=$before['totalDeductions'];$row['netSalary']=$before['netSalary'];$row['governmentMonthly']=$row;$row['governmentMonthly']['deductions']=array_merge($row['governmentMonthly']['deductions']??[],['cpf'=>10190,'electricity'=>827]);if($service->changedFields($before,$row)!==[])$rows[]=$row;$evidence[]=['employee_code'=>'084','cpf'=>'','source'=>'FoxPro code 379: CPF ₹10,190 and Electricity ₹827; no total deduction change'];
// Confirmed identity 083 / FoxPro code 378: the saved CPF was ₹77 above the
// source while the saved total already equalled FoxPro, leaving an unallocated component delta.
$master=$byCode['083']??null;if(!$master)throw new RuntimeException('Verified employee 083 missing');$m=$monthly->firstWhere('employee_user_id',$master->employee_user_id);$before=$service->snapshotFromMonthly($m);$row=$before;$row['monthlyPayrollId']=$m->id;$row['cpf']=11904;$row['totalEarnings']=$before['totalEarnings'];$row['totalDeductions']=$before['totalDeductions'];$row['netSalary']=$before['netSalary'];$row['governmentMonthly']=$row;$row['governmentMonthly']['deductions']=array_merge($row['governmentMonthly']['deductions']??[],['cpf'=>11904]);if($service->changedFields($before,$row)!==[])$rows[]=$row;$evidence[]=['employee_code'=>'083','cpf'=>'','source'=>'FoxPro code 378: CPF ₹11,904; removes ₹77 unallocated deduction delta without changing totals'];
$result=$rows===[]?['updated'=>0,'status'=>'already_reconciled','audits'=>[]]:$service->amendGeneratedRows($admin,'September 2026: verified FoxPro component reclassification; totals preserved',$rows);
$report=['run_id'=>$periodId,'database'=>config('database.default'),'backup'=>$backup,'evidence'=>$evidence,'result'=>$result];
file_put_contents(__DIR__.'/../outputs/cirt-september-2026-reconciliation/september-component-classification-audit.json',json_encode($report,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR));
echo json_encode($report,JSON_PRETTY_PRINT),PHP_EOL;
