<?php

namespace App\Services;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayrollEditLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class PayrollEditLockService
{
    private const LEASE_SECONDS = 45;

    /** @return array<string,mixed> */
    public function acquire(string $companyId, string $userId, string $clientId, int $year, int $month, bool $takeover = false): array
    {
        [$key, $periodId] = $this->scope($companyId, $year, $month, null);

        return DB::transaction(function () use ($companyId, $userId, $clientId, $year, $month, $takeover, $key, $periodId): array {
            // Serialize first acquisition too; SELECT FOR UPDATE cannot lock a row that does not yet exist.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', [$companyId.'|'.$key.'|'.$userId]);
            $lock = HrmsPayrollEditLock::query()
                ->where('company_id', $companyId)
                ->where('period_key', $key)
                ->where('owner_user_id', $userId)
                ->lockForUpdate()
                ->first();

            $active = $lock && $lock->expires_at?->isFuture();
            if ($active && $lock->client_id !== $clientId && ! $takeover) {
                return ['acquired' => false, 'locked' => true, 'message' => 'This payroll period is being edited in another tab.'];
            }

            $now = now();
            $token = $active && $lock->client_id === $clientId ? (string) $lock->lease_token : (string) Str::uuid();
            $attrs = [
                'company_id' => $companyId,
                'period_key' => $key,
                'payroll_year' => $year,
                'payroll_month' => $month,
                'payroll_period_id' => $periodId,
                'owner_user_id' => $userId,
                'client_id' => $clientId,
                'lease_token' => $token,
                'heartbeat_at' => $now,
                'expires_at' => $now->copy()->addSeconds(self::LEASE_SECONDS),
            ];
            if ($lock) $lock->fill($attrs)->save();
            else HrmsPayrollEditLock::query()->create($attrs);

            return ['acquired' => true, 'locked' => false, 'clientId' => $clientId, 'leaseToken' => $token, 'expiresAt' => $attrs['expires_at']->toIso8601String(), 'periodId' => $periodId];
        });
    }

    /** @return array<string,mixed>|null */
    public function heartbeat(string $companyId, string $userId, string $clientId, string $token, int $year, int $month): ?array
    {
        [$key] = $this->scope($companyId, $year, $month, null);
        $lock = HrmsPayrollEditLock::query()
            ->where('company_id', $companyId)->where('period_key', $key)->where('owner_user_id', $userId)
            ->where('client_id', $clientId)->where('lease_token', $token)->first();
        if (! $lock || ! $lock->expires_at?->isFuture()) return null;

        $now = now();
        $lock->forceFill(['heartbeat_at' => $now, 'expires_at' => $now->copy()->addSeconds(self::LEASE_SECONDS)])->save();

        return ['expiresAt' => $lock->expires_at->toIso8601String()];
    }

    public function release(string $companyId, string $userId, string $clientId, string $token, int $year, int $month): void
    {
        [$key] = $this->scope($companyId, $year, $month, null);
        HrmsPayrollEditLock::query()->where('company_id', $companyId)->where('period_key', $key)
            ->where('owner_user_id', $userId)->where('client_id', $clientId)->where('lease_token', $token)->delete();
    }

    /** Called under the same database transaction as protected writes. */
    public function lockForWrite(string $companyId, string $userId, string $clientId, string $token, int $year, int $month, ?string $monthlyId = null): bool
    {
        if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
            if (! $monthlyId) return false;
            $monthly = HrmsGovernmentMonthlyPayroll::query()->find($monthlyId);
            $period = $monthly?->payrollPeriod;
            if (! $period) return false;
            $year = (int) $period->period_start->format('Y');
            $month = (int) $period->period_start->format('n');
        }
        [$key] = $this->scope($companyId, $year, $month, null);
        $lock = HrmsPayrollEditLock::query()->where('company_id', $companyId)->where('period_key', $key)
            ->where('owner_user_id', $userId)->where('client_id', $clientId)->where('lease_token', $token)
            ->lockForUpdate()->first();

        return (bool) ($lock && $lock->expires_at?->isFuture());
    }

    /** @return array{string,?string} */
    private function scope(string $companyId, int $year, int $month, ?string $periodId): array
    {
        if ($periodId) {
            $period = HrmsPayrollPeriod::query()->where('company_id', $companyId)->find($periodId);
        } else {
            $start = sprintf('%04d-%02d-01', $year, $month);
            $period = HrmsPayrollPeriod::query()->where('company_id', $companyId)->whereDate('period_start', $start)->first();
        }

        return $period
            ? ['period:'.$period->id, (string) $period->id]
            : [sprintf('draft:%04d-%02d', $year, $month), null];
    }
}
