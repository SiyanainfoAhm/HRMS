<?php

namespace Tests\Database;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Services\EmployeePayrollExportService;
use App\Services\PeriodReportService;
use App\Services\PostPayrollDownloadService;
use App\Support\PayrollExportTotals;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Multi-period TDS Data and Export Employee Payroll: employee-grouped, month-ordered rows, custom-field
 * columns from Settings, totals row and the totals cross-check. Runs inside a rolled-back transaction.
 */
final class PeriodReportTest extends DatabaseTestCase
{
    private function tds(): PostPayrollDownloadService
    {
        return new PostPayrollDownloadService;
    }

    /** One saved monthly row as PostPayrollDownloadService::rowsForMonths returns it. @param array<string, float> $customEarn */
    private function row(string $code, string $ym, float $basic, array $customEarn = [], float $pt = 200.0): array
    {
        $earn = $basic + array_sum($customEarn);

        return [
            'employee_user_id' => 'user-'.$code, 'month_year' => $ym.'-01', '_ym' => (int) str_replace('-', '', $ym),
            '_master' => ['employee_code' => $code, 'name' => 'Emp '.$code], '_user' => [],
            'basic_paid' => $basic, 'pt_amount' => $pt,
            'custom_earnings' => json_encode($customEarn), 'custom_deductions' => '{}',
            'total_earnings' => $earn, 'total_deductions' => $pt, 'net_salary' => $earn - $pt,
            'incentive' => 0, 'pr_bonus' => 0, 'reimbursement' => 0,
        ];
    }

    private function extras(array $earnings = [], array $deductions = []): array
    {
        return ['earnings' => $earnings, 'deductions' => $deductions];
    }

    public function test_three_months_are_grouped_by_employee_in_month_order_and_a_missing_month_has_no_row(): void
    {
        // Unsorted on purpose; employee 002 has no June run.
        $rows = [
            $this->row('002', '2026-07', 2000), $this->row('001', '2026-07', 1002), $this->row('001', '2026-05', 1000),
            $this->row('002', '2026-05', 2000), $this->row('001', '2026-06', 1001),
        ];
        // rowsForMonths sorts; tdsTable keeps the order it is given, so sort the way the service does.
        usort($rows, fn ($a, $b) => strnatcasecmp($a['_master']['employee_code'], $b['_master']['employee_code']) ?: $a['_ym'] <=> $b['_ym']);
        $t = $this->tds()->tdsTable($rows, $this->extras());

        $monthCol = array_search('Month', $t['headers'], true);
        $yearCol = array_search('Year', $t['headers'], true);
        $seen = array_map(fn ($r) => $r[0].' '.$r[$monthCol].' '.$r[$yearCol], $t['rows']);
        $this->assertSame([
            '001 May 2026 2026', '001 June 2026 2026', '001 July 2026 2026',
            '002 May 2026 2026', '002 July 2026 2026',
        ], $seen);
    }

    public function test_totals_columns_totals_row_and_net_equals_earnings_minus_deductions(): void
    {
        $rows = [$this->row('001', '2026-05', 1000, ['arrears' => 50.0]), $this->row('001', '2026-06', 1100), $this->row('002', '2026-05', 2000)];
        $t = $this->tds()->tdsTable($rows, $this->extras(['arrears' => 'Arrears']));
        $h = array_flip($t['headers']);
        $this->assertSame(50.0, $t['rows'][0][$h['Arrears']]);
        $this->assertNull($t['rows'][1][$h['Arrears']], 'no value stays an empty cell');
        foreach ($t['rows'] as $r) {
            $this->assertEqualsWithDelta($r[$h['Total Earnings']] - $r[$h['Total Deductions']], $r[$h['Net Pay']], 0.001);
        }
        $this->assertSame('TOTAL', $t['totals'][0]);
        $this->assertSame(4150.0, $t['totals'][$h['Total Earnings']]);
        $this->assertSame(600.0, $t['totals'][$h['Total Deductions']]);
        $this->assertSame(3550.0, $t['totals'][$h['Net Pay']]);
        $this->assertSame(50.0, $t['totals'][$h['Arrears']]);
    }

    public function test_totals_that_do_not_add_up_fail_loudly(): void
    {
        $bad = $this->row('001', '2026-05', 1000);
        $bad['total_earnings'] = 1500.0; // earning lines add up to 1000
        $this->expectException(HttpException::class);
        $this->expectExceptionMessageMatches('/do not reconcile for 001 May 2026/');
        $this->tds()->tdsTable([$bad], $this->extras());
    }

    public function test_net_must_equal_earnings_minus_deductions(): void
    {
        $bad = $this->row('001', '2026-05', 1000);
        $bad['net_salary'] = 1.0;
        $this->assertNotSame([], PayrollExportTotals::problems($bad));
        $this->assertSame([], PayrollExportTotals::problems($this->row('001', '2026-05', 1000)));
    }

    public function test_a_single_month_keeps_the_existing_tds_columns(): void
    {
        $rows = [$this->row('001', '2026-05', 1000), $this->row('002', '2026-05', 2000)];
        $before = $this->tds()->tdsTable($rows, null);
        $after = $this->tds()->tdsTable($rows, $this->extras());
        $this->assertCount(44, $before['headers']);
        $this->assertSame($before['headers'], array_slice($after['headers'], 0, 44));
        foreach ($rows as $i => $_) {
            $this->assertSame($before['rows'][$i], array_slice($after['rows'][$i], 0, 44), 'the 44 TDS values are unchanged');
        }
        $this->assertSame(['Month', 'Year'], array_slice($after['headers'], 44, 2));
    }

    public function test_month_list_parsing_and_file_name_range(): void
    {
        $svc = new PeriodReportService;
        $this->assertSame(['2026-05', '2026-06', '2026-07'], $svc->parseMonths('2026-07,2026-05,2026-06,2026-05'));
        $this->assertSame('2026-05_to_2026-07', PeriodReportService::rangeLabel(['2026-05', '2026-06', '2026-07']));
        $this->assertSame('2026-05', PeriodReportService::rangeLabel(['2026-05']));
        $this->expectException(HttpException::class);
        $svc->parseMonths('2026-13');
    }

    public function test_only_generated_months_are_selectable(): void
    {
        $company = DB::table('cirt_monthly_payroll')->value('company_id');
        $company !== null || $this->markTestSkipped('No generated payroll in this database.');
        $svc = new PeriodReportService;
        $listed = array_column($svc->periods((string) $company), 'ym');
        $generated = DB::table('cirt_monthly_payroll')->where('company_id', $company)->selectRaw("to_char(month_year,'YYYY-MM') ym")->distinct()->pluck('ym')->sort()->values()->all();
        $this->assertSame($generated, $listed);
        $this->expectException(HttpException::class);
        $svc->periodIdsFor((string) $company, ['2031-01']); // a month with no run (draft-only or nothing)
    }

    private function addDefinition(string $company, string $key, string $label, string $group, bool $active): void
    {
        DB::table('cirt_payroll_field_definitions')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $company, 'field_label' => $label, 'field_key' => $key,
            'field_group' => $group, 'field_type' => 'number', 'calculation_type' => 'manual_entry',
            'include_in_total_earnings' => $group === 'earnings', 'include_in_total_deductions' => $group !== 'earnings',
            'is_system' => false, 'is_active' => $active, 'display_order' => 999, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_a_field_added_in_settings_appears_in_the_preview_and_both_workbooks(): void
    {
        $company = (string) DB::table('cirt_payroll_field_definitions')->value('company_id');
        $company !== '' || $this->markTestSkipped('No payroll fields in this database.');
        $this->addDefinition($company, 'tmp_new_earning', 'Brand New Earning', 'earnings', true);
        $this->addDefinition($company, 'tmp_new_deduction', 'Brand New Recovery', 'deductions', true);
        $this->addDefinition($company, 'tmp_old_inactive', 'Old Inactive Earning', 'earnings', false);
        $this->addDefinition($company, 'tmp_old_unused', 'Old Unused Earning', 'earnings', false);

        $svc = new PeriodReportService;
        $bags = [['{"tmp_old_inactive": 75, "tmp_unknown": 5}', '{}']];
        $cols = $svc->customColumns($company, $bags, PeriodReportService::EMPLOYEE_FIXED_CUSTOM);
        $this->assertSame('Brand New Earning', $cols['earnings']['tmp_new_earning'], 'active, even with no value yet');
        $this->assertSame('Brand New Recovery', $cols['deductions']['tmp_new_deduction']);
        $this->assertArrayHasKey('tmp_old_inactive', $cols['earnings'], 'inactive but holds a value: not dropped');
        $this->assertArrayNotHasKey('tmp_old_unused', $cols['earnings'], 'inactive and empty: hidden');
        $this->assertSame('tmp_unknown', $cols['earnings']['tmp_unknown'], 'saved key with no definition: not dropped');
        $this->assertArrayNotHasKey('telephone_allowance', $cols['earnings'], 'has its own fixed column in Export Employee Payroll');

        // TDS Data: preview table and Excel.
        $all = $svc->customColumns($company, [], []);
        $rows = [$this->row('001', '2026-05', 1000, ['tmp_new_earning' => 40.0])];
        $t = $this->tds()->tdsTable($rows, $all);
        $this->assertContains('Brand New Earning', $t['headers']);
        $this->assertContains('Brand New Recovery', $t['headers']);
        $path = $this->tds()->save($this->tds()->buildTds($rows, $all));
        $sheet = IOFactory::load($path)->getActiveSheet();
        @unlink($path);
        $headerRow = $sheet->rangeToArray('A2:'.$sheet->getHighestColumn().'2', null, true, false)[0];
        $this->assertContains('Brand New Earning', $headerRow);
        $col = array_search('Brand New Earning', $headerRow, true);
        $this->assertSame(40.0, (float) $sheet->getCell([$col + 1, 3])->getValue(), 'a real numeric cell');
        $this->assertSame('TOTAL', $sheet->getCell([1, 4])->getValue(), 'totals row');
        $this->assertSame('B3', $sheet->getFreezePane());

        // Export Employee Payroll: header row.
        $headers = app(EmployeePayrollExportService::class)->buildHeaders([
            'earnings' => array_keys($cols['earnings']), 'deductions' => array_keys($cols['deductions']),
            'labels' => $cols['earnings'] + $cols['deductions'],
        ]);
        $this->assertContains('Brand New Earning', $headers);
        $this->assertContains('Brand New Recovery', $headers);
    }

    public function test_tds_columns_put_each_total_beside_the_fields_it_sums_and_preview_matches_excel(): void
    {
        $extras = [
            'earnings' => ['tmp_a' => 'Alpha Earn', 'arrears' => 'Arrears', 'tmp_hra' => 'HRA'],
            'deductions' => ['tmp_d' => 'Beta Ded', 'gpf' => 'GPF'],
        ];
        $rows = [$this->row('001', '2026-05', 1000, ['tmp_a' => 10.0]), $this->row('001', '2026-06', 1100)];
        $t = $this->tds()->tdsTable($rows, $extras);

        $this->assertSame(
            ['Month', 'Year', 'Alpha Earn', 'Arrears', 'HRA (Custom)', 'Total Earnings', 'Beta Ded', 'GPF', 'Total Deductions', 'Net Pay'],
            array_slice($t['headers'], 44),
            'Month | Year | custom earnings | Total Earnings | custom deductions | Total Deductions | Net Pay',
        );
        $this->assertSame(PostPayrollDownloadService::TDS_COLUMNS, array_slice($t['headers'], 0, 44), 'the 44 TDS columns keep their order');
        $h = array_flip($t['headers']);
        $this->assertSame(1010.0, $t['rows'][0][$h['Total Earnings']]);
        $this->assertSame(10.0, $t['rows'][0][$h['Alpha Earn']]);
        $this->assertSame(810.0, $t['rows'][0][$h['Net Pay']]);

        // The Excel header row is the preview's header row, cell for cell.
        $path = $this->tds()->save($this->tds()->buildTds($rows, $extras));
        $sheet = IOFactory::load($path)->getActiveSheet();
        @unlink($path);
        $excelHeaders = array_map('strval', $sheet->rangeToArray('A2:'.$sheet->getHighestColumn().'2', null, true, false)[0]);
        $this->assertSame($t['headers'], $excelHeaders, 'preview and Excel use exactly the same column order');
        $excelRow = $sheet->rangeToArray('A3:'.$sheet->getHighestColumn().'3', null, true, false)[0];
        $this->assertSame(1010.0, (float) $excelRow[$h['Total Earnings']]);
    }

    public function test_employee_export_keeps_totals_beside_their_fields_and_preview_matches_excel(): void
    {
        $svc = app(EmployeePayrollExportService::class);
        $keys = ['earnings' => ['tmp_a', 'arrears'], 'deductions' => ['tmp_d'], 'labels' => ['tmp_a' => 'Alpha Earn', 'arrears' => 'Arrears', 'tmp_d' => 'Beta Ded']];
        $headers = $svc->buildHeaders($keys);
        $pos = array_flip($headers);
        $this->assertSame('Arrears (Custom)', $headers[$pos['Alpha Earn'] + 1], 'a custom field named like a fixed column keeps the (Custom) suffix');
        $this->assertTrue($pos['Month'] + 1 === $pos['Year'], 'Month then Year');
        $this->assertTrue($pos['Alpha Earn'] < $pos['Arrears (Custom)'] && $pos['Arrears (Custom)'] < $pos['Total Earnings'], 'custom earnings, then Total Earnings');
        $this->assertSame($pos['Arrears (Custom)'] + 1, $pos['Total Earnings']);
        $this->assertTrue($pos['Total Earnings'] < $pos['Income Tax'] && $pos['Other Deduction'] < $pos['Beta Ded'], 'fixed deductions, then custom deductions');
        $this->assertSame($pos['Beta Ded'] + 1, $pos['Total Deductions'], 'custom deductions, then Total Deductions');
        $this->assertSame('Net Salary', $headers[count($headers) - 1], 'net pay is last');
        $this->assertSame($pos['Telephone Allowance'], array_search('Telephone Allowance', $headers, true), 'fixed columns stay where they are');

        $period = new HrmsPayrollPeriod;
        $period->id = 'p-may';
        $period->period_name = 'May 2026 (through day 31)';
        $period->period_start = \Illuminate\Support\Carbon::parse('2026-05-01');
        $gov = new HrmsGovernmentMonthlyPayroll;
        $gov->forceFill([
            'employee_user_id' => 'u1', 'basic_paid' => 1000, 'total_earnings' => 1010, 'total_deductions' => 5, 'net_salary' => 1005,
            'custom_earnings' => ['tmp_a' => 10], 'custom_deductions' => ['tmp_d' => 5],
        ]);
        $masters = ['u1' => ['employeeCode' => '001', 'name' => 'Emp 1']];
        $table = $svc->buildTable([$period], ['p-may' => [$gov]], $masters, [], [], $keys);
        $this->assertSame($headers, $table['headers'], 'preview headers are the shared column definition');

        $sheet = $svc->buildSpreadsheet([$period], ['p-may' => [$gov]], $masters, [], [], $keys)->getActiveSheet();
        $excelHeaders = array_map('strval', $sheet->rangeToArray('A1:'.$sheet->getHighestColumn().'1', null, true, false)[0]);
        $this->assertSame($table['headers'], $excelHeaders, 'preview and Excel use exactly the same column order');
        $col = array_flip($table['headers']);
        $this->assertSame(10.0, (float) $table['rows'][0][$col['Alpha Earn']]);
        $this->assertSame(1010.0, (float) $table['rows'][0][$col['Total Earnings']]);
        $this->assertSame(1005.0, (float) $table['rows'][0][$col['Net Salary']]);
    }

    public function test_real_september_preview_totals_reconcile_and_match_the_workbook(): void
    {
        $company = DB::table('cirt_monthly_payroll')->value('company_id');
        $company !== null || $this->markTestSkipped('No generated payroll in this database.');
        $company = (string) $company;
        $svc = new PeriodReportService;
        $months = [$svc->periods($company)[0]['ym']];
        $rows = $this->tds()->rowsForMonths($company, $months);
        $extras = $svc->customColumns($company, array_map(fn ($r) => [$r['custom_earnings'], $r['custom_deductions']], $rows));
        $t = $this->tds()->tdsTable($rows, $extras);
        $h = array_flip($t['headers']);
        $this->assertCount(count($rows), $t['rows']);
        $this->assertEqualsWithDelta(
            $t['totals'][$h['Total Earnings']] - $t['totals'][$h['Total Deductions']], $t['totals'][$h['Net Pay']], 0.01,
            'earnings - deductions = net, on the totals row too',
        );
        $this->assertEqualsWithDelta(array_sum(array_map(fn ($r) => (float) $r['total_earnings'], $rows)), $t['totals'][$h['Total Earnings']], 0.01);

        $employee = app(EmployeePayrollExportService::class)->previewTable($company, $svc->periodIdsFor($company, $months));
        $e = array_flip($employee['headers']);
        $this->assertCount(count($rows), $employee['rows']);
        $this->assertEqualsWithDelta($t['totals'][$h['Net Pay']], $employee['totals'][$e['Net Salary']], 0.01, 'both exports agree on net');
        $this->assertEqualsWithDelta($t['totals'][$h['Total Earnings']], $employee['totals'][$e['Total Earnings']], 0.01);
    }
}
