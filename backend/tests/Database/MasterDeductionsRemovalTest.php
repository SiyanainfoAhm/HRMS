<?php

namespace Tests\Database;

use App\Services\PayrollCalculationService;
use Illuminate\Support\Facades\DB;

/** CIRT-09: hiding Mess / Credit Society / Electricity from Master must not change payroll totals. */
final class MasterDeductionsRemovalTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private const CONFIG = ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic', 'da', 'hra', 'medical', 'transport'], 'cpf_calculation_mode' => 'percentage', 'cpf_fixed_amount' => 0];

    private function totals(): array
    {
        $svc = new PayrollCalculationService;
        $out = [];
        foreach (DB::table('cirt_payroll_master')->where('status', 'active')->whereNull('effective_to')->orderBy('id')->get() as $m) {
            $input = (array) $m;
            $calc = $svc->calculateMaster($input, null, null, self::CONFIG);
            $out[$m->id] = [$calc['total_earnings'], $calc['total_deductions'], $calc['take_home'], $calc['mess'], $calc['credit_society'], $calc['electricity']];
        }

        return $out;
    }

    public function test_payroll_totals_are_identical_before_and_after_and_finalized_payroll_is_unchanged(): void
    {
        $snapshot = $this->finalizedSnapshot();
        DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['mess', 'credit_society', 'electricity'])->update(['show_in_payroll_master' => true]);

        $before = $this->totals();
        $this->assertNotEmpty($before);
        (require base_path('database/migrations/2026_11_02_110000_cirt_hide_mess_credit_society_electricity_from_master.php'))->up();
        $after = $this->totals();

        $this->assertSame($before, $after, 'totals for the same Master inputs');
        $this->assertSame(0, DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['mess', 'credit_society', 'electricity'])->where('show_in_payroll_master', true)->count());
        $this->assertSame(3, DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['mess', 'credit_society', 'electricity'])->count(), 'definitions kept');

        // The three amounts still drive the calculation.
        $m = (array) DB::table('cirt_payroll_master')->where('status', 'active')->whereNull('effective_to')->first();
        $svc = new PayrollCalculationService;
        $base = $svc->calculateMaster($m, null, null, self::CONFIG);
        foreach (['mess', 'credit_society', 'electricity'] as $key) {
            $bumped = $svc->calculateMaster(array_merge($m, [$key => (float) $base[$key] + 100]), null, null, self::CONFIG);
            $this->assertEqualsWithDelta($base['total_deductions'] + 100, $bumped['total_deductions'], 0.01, $key);
        }
        $this->assertFinalizedUnchanged($snapshot, 'hiding the three Master deduction inputs');
    }
}
