<?php

namespace App\Services;

use App\Exceptions\PayrollConcurrencyException;
use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PayrollRunRevisionService
{
    public function currentRevision(string $companyId, string $periodId): int
    {
        return (int) (DB::table('cirt_payroll_run_revisions')
            ->where('company_id', $companyId)
            ->where('payroll_period_id', $periodId)
            ->max('revision_no') ?? 0);
    }

    /** Compare while holding the period row lock; callers keep this transaction through the write. */
    public function assertExpectedRevision(string $companyId, string $periodId, ?int $expected): int
    {
        $period = HrmsPayrollPeriod::query()
            ->where('company_id', $companyId)
            ->whereKey($periodId)
            ->lockForUpdate()
            ->firstOrFail();
        $current = $this->currentRevision($companyId, $periodId);

        if ($expected === null || $current !== $expected) {
            throw new PayrollConcurrencyException($current, 'payroll_period', $periodId);
        }

        return $current;
    }

    /** Save an immutable, complete view of the period after a successful change. */
    public function capture(HrmsPayrollPeriod $period, string $actorUserId, string $action, ?string $reason = null): array
    {
        return DB::transaction(function () use ($period, $actorUserId, $action, $reason): array {
            $lockedPeriod = HrmsPayrollPeriod::query()->whereKey($period->id)->lockForUpdate()->firstOrFail();
            $monthly = HrmsGovernmentMonthlyPayroll::query()->where('company_id', $lockedPeriod->company_id)
                ->where('payroll_period_id', $lockedPeriod->id)->orderBy('id')->get()->toArray();
            $payslips = HrmsPayslip::query()->where('company_id', $lockedPeriod->company_id)
                ->where('payroll_period_id', $lockedPeriod->id)->orderBy('id')->get()->toArray();
            $monthlyJson = json_encode($monthly, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $payslipsJson = json_encode($payslips, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $checksum = self::checksum($monthly, $payslips);
            $latest = DB::table('cirt_payroll_run_revisions')->where('payroll_period_id', $lockedPeriod->id)
                ->orderByDesc('revision_no')->lockForUpdate()->first();

            // A retried request with no persisted changes reuses the prior
            // revision, keeping the operation idempotent and payroll unique.
            if ($latest && hash_equals((string) $latest->snapshot_sha256, $checksum)) {
                return (array) $latest;
            }

            $revision = [
                'id' => (string) Str::uuid(),
                'company_id' => $lockedPeriod->company_id,
                'payroll_period_id' => $lockedPeriod->id,
                'revision_no' => ((int) ($latest->revision_no ?? 0)) + 1,
                'created_by' => $actorUserId,
                'action' => $action,
                'reason' => $reason,
                'monthly_rows' => $monthlyJson,
                'payslip_rows' => $payslipsJson,
                'snapshot_sha256' => $checksum,
                'created_at' => now(),
            ];
            DB::table('cirt_payroll_run_revisions')->insert($revision);

            return $revision;
        });
    }

    public function list(string $companyId, string $periodId): array
    {
        return DB::table('cirt_payroll_run_revisions')->where('company_id', $companyId)
            ->where('payroll_period_id', $periodId)->orderByDesc('revision_no')
            ->get(['id', 'revision_no', 'created_by', 'action', 'reason', 'snapshot_sha256', 'created_at'])
            ->map(fn ($row) => (array) $row)->all();
    }

    public function get(string $companyId, string $revisionId): ?array
    {
        $revision = DB::table('cirt_payroll_run_revisions')->where('company_id', $companyId)->where('id', $revisionId)->first();
        if (! $revision) return null;
        $revision = (array) $revision;
        $revision['monthly_rows'] = json_decode($revision['monthly_rows'], true, flags: JSON_THROW_ON_ERROR);
        $revision['payslip_rows'] = json_decode($revision['payslip_rows'], true, flags: JSON_THROW_ON_ERROR);

        return $revision;
    }

    public static function checksum(array $monthly, array $payslips): string
    {
        $canonical = static function (mixed $value) use (&$canonical): mixed {
            if (! is_array($value)) return $value;
            if (! array_is_list($value)) ksort($value);
            foreach ($value as $key => $item) $value[$key] = $canonical($item);
            return $value;
        };

        return hash('sha256', json_encode($canonical($monthly), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)."\n".json_encode($canonical($payslips), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }
}
