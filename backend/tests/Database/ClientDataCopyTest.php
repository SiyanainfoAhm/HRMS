<?php

namespace Tests\Database;

use App\Services\PostPayrollDownloadService;
use Illuminate\Support\Facades\DB;

/**
 * Runs only against a LOCAL restore of the client's backup (DB_DATABASE=cirt_payroll_clientcopy).
 * Closed September 2026 is read-only here; every new Excel report must tie to it row by row.
 */
final class ClientDataCopyTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    protected function setUp(): void
    {
        parent::setUp();
        DB::connection()->getDatabaseName() === 'cirt_payroll_clientcopy' || $this->markTestSkipped('Client-copy test: set DB_DATABASE=cirt_payroll_clientcopy.');
    }

    private function sept(): array
    {
        $svc = new PostPayrollDownloadService;
        $rows = $svc->rows((string) DB::table('cirt_monthly_payroll')->value('company_id'), 202609, 202609);
        $this->assertCount(83, $rows, 'the client closed September with 83 employees');

        return $rows;
    }

    public function test_every_september_row_ties_in_paybill_and_tds_including_custom_fields(): void
    {
        $before = $this->finalizedSnapshot();
        $svc = new PostPayrollDownloadService;
        $rows = $this->sept();

        $ws = $svc->buildPaybill($rows, 202609)->getSheetByName('Paybill');
        $head = [];
        for ($c = 1; $c <= 80; $c++) {
            $h = $ws->getCell([$c, 3])->getValue();
            if ($h !== null && $h !== '') $head[(string) $h] = $c;
        }
        $earn = array_keys(array_filter(PostPayrollDownloadService::PAYBILL_EARNINGS, fn ($k, $l) => $l !== 'Tot. Pay', ARRAY_FILTER_USE_BOTH));
        $ded = array_keys(array_filter(PostPayrollDownloadService::PAYBILL_DEDUCTIONS, fn ($k, $l) => $l !== 'TOT.DED.', ARRAY_FILTER_USE_BOTH));
        $tdsEarn = ['BASIC+DP', 'DA+DA ARRS', 'MEDICAL REIMBURSEMENT', 'SP PAY', 'FP PAY', 'MEDICAL', 'OT ALLOWANCE', 'ENCASHMENT+ENCA DA', 'EX-GRATIA', 'HON+TUITION FEE+CASH', 'PERKS', 'WASH ALLOW', 'GRATUITY', 'INCENTIVE', 'Total Arrears', 'HRA', 'Conveyance(Taxable)'];

        foreach ($rows as $i => $r) {
            $line = 4 + $i;
            $code = $r['_master']['employee_code'] ?? '?';
            $sumE = array_sum(array_map(fn ($l) => (float) $ws->getCell([$head[$l], $line])->getValue(), $earn));
            $sumD = array_sum(array_map(fn ($l) => (float) $ws->getCell([$head[$l], $line])->getValue(), $ded));
            $this->assertEqualsWithDelta((float) $r['total_earnings'], $sumE, 0.01, "paybill earnings {$code}");
            $this->assertEqualsWithDelta((float) $r['total_deductions'], $sumD, 0.01, "paybill deductions {$code}");
            $this->assertEqualsWithDelta((float) $r['total_earnings'], (float) $ws->getCell([$head['Tot. Pay'], $line])->getValue(), 0.01);

            $t = $svc->tdsValues($r);
            $tdsSum = array_sum(array_map(fn ($n) => (float) ($t[array_search($n, PostPayrollDownloadService::TDS_COLUMNS, false)] ?? 0), $tdsEarn));
            $this->assertEqualsWithDelta((float) $r['total_earnings'], $tdsSum, 0.01, "TDS earnings {$code}");
        }

        // The client's custom fields are in the files.
        $by = fn (string $code) => collect($rows)->first(fn ($r) => ($r['_master']['employee_code'] ?? '') === $code);
        $this->assertEqualsWithDelta(22636 + 869, (float) $ws->getCell([$head['Custom Earnings'], 4 + array_search($by('037'), $rows, true)])->getValue(), 0.01, '037 arrears + encashment_arrears');
        $this->assertEqualsWithDelta(41666, (float) $ws->getCell([$head['Custom Deductions'], 4 + array_search($by('082'), $rows, true)])->getValue(), 0.01, '082 gpf');
        $this->assertFinalizedUnchanged($before, 'building reports from the client data');
    }

    public function test_old_arrears_key_is_untouched_and_counted_once(): void
    {
        $row = DB::table('cirt_monthly_payroll as mp')->join('cirt_employees as e', 'e.user_id', '=', 'mp.employee_user_id')->where('e.employee_code', '037')->first(['mp.*']);
        $bag = json_decode($row->custom_earnings, true);
        $this->assertSame(22636, $bag['arrears'], 'value under the old `arrears` key is intact');
        $this->assertEqualsWithDelta(0.0, (float) $row->gross_arrear, 0.01, 'system Gross Arrears is separate and empty, so nothing is counted twice');
        $fixed = (float) $row->basic_paid + $row->sp_pay_paid + $row->da_paid + $row->transport_paid + $row->hra_paid + $row->medical_paid + $row->extra_work_allowance_paid + $row->night_allowance_paid
            + $row->uniform_allowance_paid + $row->education_allowance_paid + $row->da_arrears_paid + $row->transport_arrears_paid + $row->encashment_paid + $row->encashment_da_paid;
        $this->assertEqualsWithDelta((float) $row->total_earnings, $fixed + array_sum($bag), 0.01, 'earnings = fixed lines + custom bag, once');
        $keys = DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['arrears', 'gross_arrears'])->pluck('field_label', 'field_key')->all();
        $this->assertSame('Arrears', $keys['arrears'], 'client field keeps its own label');
        $this->assertSame('Gross Arrears', $keys['gross_arrears']);
    }

    public function test_hor_stays_inactive_and_custom_fields_survive_the_migrations(): void
    {
        $f = DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['hor', 'encashment_arrears', 'over_time_allowance', 'past_arrears'])->get()->keyBy('field_key');
        $this->assertFalse((bool) $f['hor']->is_active, 'hor stays inactive');
        $this->assertTrue((bool) $f['encashment_arrears']->is_active);
        $this->assertTrue((bool) $f['over_time_allowance']->is_active);
        $this->assertTrue((bool) $f['over_time_allowance']->include_in_total_earnings);
        $this->assertTrue((bool) $f['past_arrears']->is_active);
        $this->assertSame(1, DB::table('cirt_payroll_field_values')->where('field_key', 'hor')->count(), 'hor data kept, never deleted');
    }

    public function test_mess_credit_society_electricity_defaults_still_seed_payroll(): void
    {
        $company = (string) DB::table('cirt_institute')->value('id');
        $admin = \App\Models\HrmsUser::query()->where('role', 'admin')->first();
        $admin->company_id = $company;
        $req = \Illuminate\Http\Request::create('/x', 'GET', ['year' => 2026, 'month' => 12, 'runDay' => 31, 'per_page' => 100]);
        $req->setUserResolver(fn () => $admin);
        $rows = app(\App\Http\Controllers\Api\V1\PayrollController::class)->runPreview($req)->getData(true)['preview']['rows'];
        $masters = DB::table('cirt_payroll_master')->whereNull('effective_to')->get()->keyBy('employee_user_id');
        $this->assertNotEmpty($rows);
        foreach ($rows as $r) {
            $m = $masters[$r['employeeUserId']];
            $d = $r['govRecalc']['deductionDefaults'];
            $this->assertEqualsWithDelta((float) $m->mess_default, (float) $d['mess'], 0.01);
            $this->assertEqualsWithDelta((float) $m->credit_society_default, (float) $d['creditSociety'], 0.01);
            $this->assertEqualsWithDelta((float) $m->electricity_default, (float) $d['electricity'], 0.01);
        }
        $this->assertSame(0, DB::table('cirt_payroll_field_definitions')->whereIn('field_key', ['mess', 'credit_society', 'electricity'])->where('show_in_payroll_master', true)->count());
    }

    public function test_client_electricity_units_bill_from_the_tariff_for_all_employees(): void
    {
        $company = (string) DB::table('cirt_institute')->value('id');
        $tariffs = app(\App\Services\ElectricityTariffService::class);
        $tariff = $tariffs->formatTariff($tariffs->resolveForDate($company, '2026-12-31'));
        $sept = DB::table('cirt_monthly_payroll')->where('electricity_units_consumed', '>', 0)->get();
        $this->assertCount(21, $sept, '21 employees recorded units in closed September');
        foreach ($sept as $r) {
            $bill = $tariffs->calculateBill((float) $r->electricity_units_consumed, $tariff, true, 'manual_fixed', 0, 49);
            $this->assertGreaterThan(0, $bill['total'], 'units are billed even when the Master says manual_fixed');
            // Closed September stored 0 for all of them: kept as-is (finalized), reported separately.
            $this->assertEqualsWithDelta(0.0, (float) $r->electricity_amount, 0.01);
        }
    }
}
