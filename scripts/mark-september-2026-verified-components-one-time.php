<?php

declare(strict_types=1);

// Applies only the two source-verified September corrections as master-value
// recurrence metadata. It does not read or write payroll snapshots/payslips.
require __DIR__.'/../backend/vendor/autoload.php';

$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

$targets = [
    ['field_key' => 'education_allowance', 'field_value' => '33750', 'reference' => 'FoxPro TUITION; Sep 2026 verified CPF 205'],
    ['field_key' => 'encashment', 'field_value' => '869', 'reference' => 'FoxPro ENCASH_DA; Sep 2026 verified CPF 554'],
];

$updated = DB::transaction(function () use ($targets): array {
    $result = [];
    foreach ($targets as $target) {
        $rows = DB::table('cirt_payroll_field_values')
            ->where('field_key', $target['field_key'])
            ->where('field_value', $target['field_value'])
            ->get(['id', 'payroll_master_id']);
        if ($rows->count() !== 1) {
            throw new RuntimeException("Expected exactly one {$target['field_key']} source-backed value; found {$rows->count()}.");
        }
        $row = $rows->first();
        DB::table('cirt_payroll_field_values')->where('id', $row->id)->update([
            'recurrence' => 'one_time',
            'effective_from' => '2026-09-01',
            'effective_to' => '2026-09-30',
            'source_reference' => $target['reference'],
            'updated_at' => now(),
        ]);
        $result[] = ['field' => $target['field_key'], 'master_id' => $row->payroll_master_id];
    }
    return $result;
});

echo json_encode(['updated_master_metadata_only' => $updated], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;
