<?php

namespace App\Support;

use App\Models\HrmsPayrollPeriod;
use App\Models\HrmsPayslip;
use Carbon\Carbon;

class PayrollRunGuard
{
    public static function periodStartForMonth(int $year, int $month): string
    {
        return sprintf('%04d-%02d-01', $year, $month);
    }

    public static function isPayrollRunForMonth(string $companyId, int $year, int $month): bool
    {
        if ($year < 2000 || $month < 1 || $month > 12) {
            return false;
        }

        $period = HrmsPayrollPeriod::where('company_id', $companyId)
            ->whereDate('period_start', self::periodStartForMonth($year, $month))
            ->first();

        if (! $period) {
            return false;
        }

        return HrmsPayslip::where('payroll_period_id', $period->id)->exists();
    }

    public static function isPayrollRunForDate(string $companyId, Carbon $date): bool
    {
        return self::isPayrollRunForMonth($companyId, (int) $date->year, (int) $date->month);
    }

    public static function blockMessageForMonth(int $year, int $month): string
    {
        $label = Carbon::createFromDate($year, $month, 1)->format('F Y');

        return "Payroll has already been run for {$label}. New reimbursement claims for this month are not allowed.";
    }
}
