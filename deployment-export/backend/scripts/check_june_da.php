<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$uid = 'a2155069-3f66-4a6c-91e6-bf0193cdf6a7';
$rows = DB::table('cirt_monthly_payroll as mp')
    ->join('cirt_payroll_periods as pp', 'pp.id', '=', 'mp.payroll_period_id')
    ->where('mp.employee_user_id', $uid)
    ->whereYear('pp.period_start', 2026)
    ->whereMonth('pp.period_start', 6)
    ->select('mp.da_paid', 'mp.da_actual', 'mp.basic_paid', 'mp.basic_actual', 'pp.period_start', 'pp.is_locked')
    ->get();
echo json_encode($rows, JSON_PRETTY_PRINT)."\n";
