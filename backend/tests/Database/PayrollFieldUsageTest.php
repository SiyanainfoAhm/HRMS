<?php

namespace Tests\Database;

use App\Services\PayrollFieldUsageService;
use Illuminate\Support\Facades\DB;

/** CIRT-04: usage report is read-only and agrees with the monthly rows. */
final class PayrollFieldUsageTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    public function test_report_counts_rows_with_data_and_last_month_and_changes_nothing(): void
    {
        $before = $this->finalizedSnapshot();
        $rows = collect((new PayrollFieldUsageService)->report())->keyBy('key');

        $this->assertSame(
            (int) DB::table('cirt_monthly_payroll')->where('mess_amount', '<>', 0)->count(),
            $rows['mess']['rows_with_data'],
        );
        $this->assertSame(
            DB::table('cirt_monthly_payroll')->where('mess_amount', '<>', 0)->max('month_year') !== null,
            $rows['mess']['last_used'] !== null,
        );
        $this->assertSame(0, $rows['unpaid_arrears']['rows_with_data'] ?? 0);
        $this->assertArrayHasKey('active', $rows['gross_arrears']);
        $this->assertFinalizedUnchanged($before, 'the field usage report');
    }
}
