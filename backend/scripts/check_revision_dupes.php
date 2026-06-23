<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

$dupes = DB::select('SELECT company_id, employee_user_id, COUNT(*) AS total_rows FROM cirt_payroll_master GROUP BY company_id, employee_user_id HAVING COUNT(*) > 1');
$sample = DB::table('cirt_payroll_master')
    ->select('name', 'da_percent', 'total_earnings', 'take_home', 'effective_to')
    ->orderBy('name')
    ->limit(3)
    ->get();

echo json_encode(['duplicates' => $dupes, 'sample' => $sample], JSON_PRETTY_PRINT).PHP_EOL;
