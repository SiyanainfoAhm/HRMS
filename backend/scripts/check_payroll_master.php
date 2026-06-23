<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

$total = DB::table('cirt_payroll_master')->count();
$scoped = DB::table('cirt_payroll_master')->whereNull('effective_to')->count();
$legacyScoped = DB::table('cirt_payroll_master')->whereNull('effective_to')->whereNull('effective_end_date')->count();
$rows = DB::table('cirt_payroll_master')
    ->select('id', 'company_id', 'name', 'effective_to', 'effective_end_date', 'status', 'employee_user_id')
    ->get();

echo json_encode([
    'total' => $total,
    'scoped_effective_to_null' => $scoped,
    'scoped_legacy_dual_null' => $legacyScoped,
    'rows' => $rows,
], JSON_PRETTY_PRINT).PHP_EOL;
