<?php

namespace Tests\Database;

use Illuminate\Support\Facades\DB;

/**
 * CIRT-02 regression on the real local record of employee code 055 (Prakash Daji Jangam):
 * input (Master) -> rule -> saved (monthly payroll) for DA, Quarter Rent, Credit Society, Mess, Electricity.
 */
final class PrakashAuditTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private function prakash(): object
    {
        $m = DB::table('cirt_payroll_master')->where('employee_code', '055')->whereNull('effective_to')->first();
        $m !== null || $this->markTestSkipped('Employee 055 is not in the local database.');

        return $m;
    }

    public function test_da_credit_society_mess_and_quarter_rent_follow_their_rules_every_month(): void
    {
        $m = $this->prakash();
        $months = DB::table('cirt_monthly_payroll')->where('employee_user_id', $m->employee_user_id)->orderBy('month_year')->get();
        $this->assertGreaterThanOrEqual(1, $months->count());
        $quarter = DB::table('cirt_quarters')->where('id', $m->quarter_id)->first();

        foreach ($months as $row) {
            $label = substr((string) $row->month_year, 0, 7);
            // DA = Basic x DA% (full month paid).
            $this->assertEqualsWithDelta(round((float) $m->gross_basic_pay * (float) $m->da_percent / 100), (float) $row->da_paid, 0.5, "DA {$label}");
            // Credit Society and Mess come from the Master default when nothing else is entered.
            $this->assertEqualsWithDelta((float) $m->credit_society_default, (float) $row->credit_society_amount, 0.01, "Credit Society {$label}");
            $this->assertEqualsWithDelta((float) $m->mess_default, (float) $row->mess_amount, 0.01, "Mess {$label}");
            // Quarter Rent is the assigned quarter's monthly rent from its assignment month on, else 0; a quarter suppresses HRA.
            $rent = (float) $row->quarter_rent_amount;
            $this->assertTrue(abs($rent) < 0.01 || abs($rent - (float) $quarter->monthly_rent) < 0.01, "Quarter Rent {$label} = 0 or the quarter rent");
            if ($rent > 0) {
                $this->assertSame($quarter->quarter_name, $row->quarter_name, "quarter name saved {$label}");
                $this->assertSame($quarter->quarter_type, $row->quarter_type, "quarter type saved {$label}");
            }
            $this->assertEqualsWithDelta(0.0, (float) $row->hra_paid, 0.01, "HRA suppressed by quarter {$label}");
            // Net = gross - deductions.
            $this->assertEqualsWithDelta((float) $row->total_earnings - (float) $row->total_deductions, (float) $row->net_salary, 0.01, "Net {$label}");
        }
    }

    public function test_electricity_is_unit_billed_or_the_master_default(): void
    {
        $m = $this->prakash();
        $rows = DB::table('cirt_monthly_payroll')->where('employee_user_id', $m->employee_user_id)->orderBy('month_year')->get();
        foreach ($rows as $row) {
            if ((float) $row->electricity_units_consumed > 0) {
                $this->assertGreaterThan(0, (float) $row->electricity_amount, 'units billed from the tariff');
            }
        }
        // Re-run month data: no units and Master default 0, so no Electricity is charged (the old unexplained 1484 is gone with the reset).
        foreach ($rows as $row) {
            if ((float) $row->electricity_units_consumed <= 0) {
                $this->assertEqualsWithDelta((float) $m->electricity_default, (float) $row->electricity_amount, 0.01);
            }
        }
    }

    public function test_quarter_identity_is_saved_on_regenerated_rows(): void
    {
        $before = $this->finalizedSnapshot();
        $m = $this->prakash();
        $quarter = DB::table('cirt_quarters')->where('id', $m->quarter_id)->first();
        $this->assertSame('B1/7', $quarter->quarter_name);
        $this->assertSame('B1', $quarter->quarter_type);
$this->assertSame(0, DB::table('cirt_monthly_payroll')->where('has_quarter', true)->where('quarter_rent_amount', '>', 0)->whereNull('quarter_name')->count(), 'every quarter-holder row that pays rent carries its quarter name');
        $source = (string) file_get_contents(base_path('app/Http/Controllers/Api/V1/PayrollController.php'));
        $this->assertStringContainsString("value('quarter_id')", $source, 'new runs resolve the quarter from the Master');
        $this->assertFinalizedUnchanged($before, 'the Prakash audit');
    }
}
