<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$tables = ['cirt_payroll_arrear_batches', 'cirt_payroll_arrear_lines', 'cirt_monthly_payroll', 'cirt_payroll_periods'];
foreach ($tables as $t) {
    if (! Schema::hasTable($t)) {
        echo "Missing table: $t\n";
        continue;
    }
    $cols = DB::select("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position", [$t]);
    echo "=== $t ===\n";
    foreach ($cols as $c) {
        echo "  {$c->column_name}: {$c->data_type}\n";
    }
}

echo "\n=== ARREAR LINES SAMPLE ===\n";
$lines = DB::table('cirt_payroll_arrear_lines')
    ->select('id', 'employee_user_id', 'arrear_year', 'arrear_month', 'status', 'is_locked', 'da_revision_event_id', 'paid_at', 'paid_in_period_id', 'arrear_batch_id')
    ->orderBy('arrear_year')->orderBy('arrear_month')
    ->limit(20)
    ->get();
echo json_encode($lines, JSON_PRETTY_PRINT)."\n";

echo "\n=== BATCHES ===\n";
$batches = DB::table('cirt_payroll_arrear_batches')
    ->select('id', 'run_year', 'run_month', 'status', 'payroll_period_id', 'da_revision_event_id')
    ->orderBy('run_year')->orderBy('run_month')
    ->get();
echo json_encode($batches, JSON_PRETTY_PRINT)."\n";

echo "\n=== PERIODS 2026 ===\n";
$periods = DB::table('cirt_payroll_periods')
    ->whereYear('period_start', 2026)
    ->select('id', 'period_name', 'period_start', 'period_end')
    ->orderBy('period_start')
    ->get();
echo json_encode($periods, JSON_PRETTY_PRINT)."\n";

echo "\n=== UNPAID LINES JUNE BATCH ===\n";
$juneUnpaid = DB::table('cirt_payroll_arrear_lines as l')
    ->join('cirt_payroll_arrear_batches as b', 'b.id', '=', 'l.arrear_batch_id')
    ->where('b.run_month', 6)
    ->where('b.run_year', 2026)
    ->where('l.status', 'unpaid')
    ->select('l.employee_user_id', 'l.arrear_month', 'l.arrear_year', 'l.da_revision_event_id', 'l.net_arrear')
    ->limit(15)
    ->get();
echo json_encode($juneUnpaid, JSON_PRETTY_PRINT)."\n";

echo "\n=== JAN-MAR UNPAID IN JUNE BATCHES ===\n";
$janMar = DB::table('cirt_payroll_arrear_lines as l')
    ->join('cirt_payroll_arrear_batches as b', 'b.id', '=', 'l.arrear_batch_id')
    ->where('b.run_month', 6)
    ->where('b.run_year', 2026)
    ->where('l.status', 'unpaid')
    ->whereIn('l.arrear_month', [1, 2, 3])
    ->count();
echo "count=$janMar\n";

echo "\n=== MAY ARREAR PAID STATUS ===\n";
$mayPaid = DB::table('cirt_payroll_arrear_lines')
    ->where('arrear_year', 2026)
    ->where('arrear_month', 5)
    ->select('status', 'paid_in_period_id', DB::raw('count(*) as c'))
    ->groupBy('status', 'paid_in_period_id')
    ->get();
echo json_encode($mayPaid, JSON_PRETTY_PRINT)."\n";

echo "\n=== APRIL BATCH PAID MONTHS ===\n";
$april = DB::table('cirt_payroll_arrear_lines as l')
    ->join('cirt_payroll_arrear_batches as b', 'b.id', '=', 'l.arrear_batch_id')
    ->where('b.run_month', 4)
    ->where('b.run_year', 2026)
    ->where('l.status', 'paid')
    ->select('l.arrear_month', DB::raw('count(*) as c'))
    ->groupBy('l.arrear_month')
    ->orderBy('l.arrear_month')
    ->get();
echo json_encode($april, JSON_PRETTY_PRINT)."\n";

echo "\n=== ALL PAID BY ARREAR MONTH ===\n";
$byMonth = DB::table('cirt_payroll_arrear_lines')
    ->where('status', 'paid')
    ->where('arrear_year', 2026)
    ->select('arrear_month', DB::raw('count(*) as c'))
    ->groupBy('arrear_month')
    ->orderBy('arrear_month')
    ->get();
echo json_encode($byMonth, JSON_PRETTY_PRINT)."\n";
