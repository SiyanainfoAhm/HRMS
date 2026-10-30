<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_run_revisions')) {
            Schema::create('cirt_payroll_run_revisions', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->uuid('payroll_period_id');
                $table->unsignedInteger('revision_no');
                $table->uuid('created_by')->nullable();
                $table->string('action', 32);
                $table->text('reason')->nullable();
                $table->jsonb('monthly_rows');
                $table->jsonb('payslip_rows');
                $table->char('snapshot_sha256', 64);
                $table->timestampTz('created_at')->useCurrent();

                $table->foreign('company_id')->references('id')->on('cirt_institute')->restrictOnDelete();
                $table->foreign('payroll_period_id')->references('id')->on('cirt_payroll_periods')->restrictOnDelete();
                $table->foreign('created_by')->references('id')->on('cirt_users')->nullOnDelete();
                $table->unique(['payroll_period_id', 'revision_no'], 'cirt_payroll_run_revision_uq');
                $table->index(['company_id', 'payroll_period_id', 'created_at'], 'cirt_payroll_run_revision_period_idx');
            });
        }

        // Capture the current finalized runs as revision 1 before the new
        // append-only revision writer is used by subsequent edits or runs.
        $periods = DB::table('cirt_payroll_periods as p')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('cirt_monthly_payroll as m')->whereColumn('m.payroll_period_id', 'p.id'))
            ->orWhereExists(fn ($q) => $q->selectRaw('1')->from('cirt_payslips as s')->whereColumn('s.payroll_period_id', 'p.id'))
            ->get(['p.id', 'p.company_id']);

        foreach ($periods as $period) {
            if (DB::table('cirt_payroll_run_revisions')->where('payroll_period_id', $period->id)->exists()) continue;
            $monthly = DB::table('cirt_monthly_payroll')->where('payroll_period_id', $period->id)->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
            $payslips = DB::table('cirt_payslips')->where('payroll_period_id', $period->id)->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
            $monthlyJson = json_encode($monthly, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $payslipsJson = json_encode($payslips, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $canonical = static function (mixed $value) use (&$canonical): mixed {
                if (! is_array($value)) return $value;
                if (! array_is_list($value)) ksort($value);
                foreach ($value as $key => $item) $value[$key] = $canonical($item);
                return $value;
            };
            $checksum = hash('sha256', json_encode($canonical($monthly), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)."\n".json_encode($canonical($payslips), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
            DB::table('cirt_payroll_run_revisions')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'company_id' => $period->company_id,
                'payroll_period_id' => $period->id,
                'revision_no' => 1,
                'created_by' => null,
                'action' => 'baseline',
                'reason' => 'Pre-existing finalized payroll snapshot archived during revision-history rollout.',
                'monthly_rows' => $monthlyJson,
                'payslip_rows' => $payslipsJson,
                'snapshot_sha256' => $checksum,
                'created_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Payroll run revisions are append-only. Archive them explicitly before removing this table.');
    }
};
