<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_run_revisions')) return;
        $canonical = static function (mixed $value) use (&$canonical): mixed {
            if (! is_array($value)) return $value;
            if (! array_is_list($value)) ksort($value);
            foreach ($value as $key => $item) $value[$key] = $canonical($item);
            return $value;
        };
        foreach (DB::table('cirt_payroll_run_revisions')->get() as $revision) {
            $monthly = json_decode($revision->monthly_rows, true, flags: JSON_THROW_ON_ERROR);
            $payslips = json_decode($revision->payslip_rows, true, flags: JSON_THROW_ON_ERROR);
            $hash = hash('sha256', json_encode($canonical($monthly), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)."\n".json_encode($canonical($payslips), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
            DB::table('cirt_payroll_run_revisions')->where('id', $revision->id)->update(['snapshot_sha256' => $hash]);
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Payroll revision checksums are integrity metadata and cannot be reverted safely.');
    }
};
