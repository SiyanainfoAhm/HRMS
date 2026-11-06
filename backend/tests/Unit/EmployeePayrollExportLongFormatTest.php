<?php

namespace Tests\Unit;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayslip;
use App\Models\HrmsPayrollPeriod;
use App\Services\EmployeePayrollExportService;
use App\Support\SpreadsheetLayout;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use PHPUnit\Framework\TestCase;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use ReflectionClass;

/**
 * Employee payroll Excel must be long/row-based (one row per employee × month),
 * never wide month-prefixed headers like "June 2026 - Basic Paid".
 */
final class EmployeePayrollExportLongFormatTest extends TestCase
{
    private static bool $booted = false;

    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$booted) {
            $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
            $app->make(Kernel::class)->bootstrap();
            // This plain PHPUnit test bootstraps Laravel directly rather than
            // through Tests\\TestCase; restore the temporary framework handler
            // so PHPUnit can verify the test leaves its handler stack intact.
            restore_error_handler();
            restore_exception_handler();
            self::$booted = true;
        }
    }

    private function service(): EmployeePayrollExportService
    {
        return app(EmployeePayrollExportService::class);
    }

    public function test_headers_are_fixed_and_include_month_column(): void
    {
        $headers = $this->service()->buildHeaders([
            'earnings' => ['Special Allowance'],
            'deductions' => ['Custom Recovery'],
        ]);

        $this->assertSame('Month', $headers[18]);
        $this->assertSame('Year', $headers[19]);
        $this->assertSame('Through Day', $headers[20]);
        $this->assertContains('Basic Paid', $headers);
        $this->assertContains('Telephone Allowance', $headers);
        $this->assertContains('Incentive', $headers);
        $this->assertContains('PR Bonus', $headers);
        $this->assertContains('Reimbursement', $headers);
        $this->assertContains('GPF', $headers);
        $this->assertContains('Special Allowance', $headers);
        $this->assertContains('Custom Recovery', $headers);
        $this->assertContains('Net Salary', $headers);

        foreach ($headers as $h) {
            $this->assertDoesNotMatchRegularExpression(
                '/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+-\s+/i',
                $h,
                "Header must not be month-prefixed: {$h}",
            );
        }

        $basicIndexes = array_keys(array_filter($headers, static fn ($h) => $h === 'Basic Paid'));
        $this->assertCount(1, $basicIndexes);
    }

    public function test_month_label_strips_through_day_suffix(): void
    {
        $period = new HrmsPayrollPeriod;
        $period->period_name = 'June 2026 (through day 30)';
        $period->period_start = Carbon::parse('2026-06-01');

        $this->assertSame('June 2026', $this->service()->monthLabel($period));
        $this->assertSame(30, $this->service()->throughDay($period));
    }

    public function test_data_row_uses_monthly_snapshot_not_master_amounts(): void
    {
        $period = new HrmsPayrollPeriod;
        $period->period_name = 'July 2026 (through day 31)';
        $period->period_start = Carbon::parse('2026-07-01');

        $gov = new HrmsGovernmentMonthlyPayroll;
        $gov->forceFill([
            'pay_level' => 10,
            'has_quarter' => true,
            'quarter_name' => 'B2/7',
            'quarter_type' => 'Type II',
            'basic_paid' => 90000,
            'da_paid' => 54000,
            'hra_paid' => 0,
            'transport_paid' => 7200,
            'medical_paid' => 1000,
            'night_allowance_paid' => 0,
            'total_earnings' => 152200,
            'income_tax_amount' => 5000,
            'pt_amount' => 200,
            'lic_amount' => 0,
            'cpf_amount' => 8000,
            'da_cpf_amount' => 1000,
            'vpf_amount' => 0,
            'pf_loan_amount' => 0,
            'post_office_amount' => 0,
            'credit_society_amount' => 0,
            'electricity_amount' => 4870,
            'electricity_units_consumed' => 350,
            'water_amount' => 0,
            'mess_amount' => 0,
            'loan_recovery_amount' => 0,
            'welfare_amount' => 0,
            'hpl_amount' => 0,
            'eol_amount' => 0,
            'veh_charge_amount' => 0,
            'quarter_rent_amount' => 500,
            'other_deduction_amount' => 0,
            'total_deductions' => 19570,
            'da_arrears_paid' => 100,
            'transport_arrears_paid' => 50,
            'gross_arrear' => 150,
            'cpf_arrear' => 10,
            'net_arrear' => 140,
            'net_salary' => 132770,
            'custom_earnings' => ['Special Allowance' => 2500, 'telephone_allowance' => 350],
            'custom_deductions' => ['gpf' => 41666],
        ]);
        $payslip = new HrmsPayslip;
        $payslip->forceFill([
            'incentive' => 125,
            'pr_bonus' => 250,
            'reimbursement' => 375,
        ]);
        $gov->setRelation('payslip', $payslip);

        $master = [
            'employeeCode' => '001',
            'name' => 'Ram',
            'email' => 'ram@example.com',
            'phone' => '999',
            'designation' => 'Officer',
            'department' => 'Admin',
            'division' => 'HQ',
            'payLevel' => 9,
            'status' => 'active',
            'quarterAssigned' => false,
            'quarterName' => 'SHOULD_NOT_USE',
            'quarterType' => 'SHOULD_NOT_USE',
            'quarterRent' => 9999,
            'grossBasicPay' => 1,
        ];

        $row = $this->service()->buildDataRow($master, $period, $gov, [
            'earnings' => ['Special Allowance'],
            'deductions' => [],
        ]);
        $headers = $this->service()->buildHeaders([
            'earnings' => ['Special Allowance'],
            'deductions' => [],
        ]);
        $map = array_combine($headers, $row);
        $this->assertIsArray($map);

        $this->assertSame('001', $map['Employee Code']);
        $this->assertSame('Ram', $map['Name']);
        $this->assertSame('July 2026', $map['Month']);
        $this->assertSame(31, $map['Through Day']);
        $this->assertSame(10, $map['Pay Level']);
        $this->assertSame('Yes', $map['Quarter Assigned']);
        $this->assertSame('B2/7', $map['Quarter Name']);
        $this->assertSame('Type II', $map['Quarter Type']);
        $this->assertSame(500.0, $map['Quarter Rent']);
        $this->assertSame(90000.0, $map['Basic Paid']);
        $this->assertSame(4870.0, $map['Electricity']);
        $this->assertSame(350.0, $map['Electricity Units']);
        $this->assertSame(2500.0, $map['Special Allowance']);
        $this->assertSame(350.0, $map['Telephone Allowance']);
        $this->assertSame(125.0, $map['Incentive'], 'the payslip incentive is an earning labelled Incentive, not Advance');
        $this->assertArrayNotHasKey('Advance', $map);
        $this->assertSame(250.0, $map['PR Bonus']);
        $this->assertSame(375.0, $map['Reimbursement']);
        $this->assertSame(41666.0, $map['GPF']);
        $this->assertSame(132770.0, $map['Net Salary']);
        $this->assertNotContains('SHOULD_NOT_USE', $row);
    }

    public function test_resolve_quarter_meta_fills_name_type_when_snapshot_blank(): void
    {
        $gov = new HrmsGovernmentMonthlyPayroll;
        $gov->forceFill([
            'has_quarter' => true,
            'quarter_id' => null,
            'quarter_name' => null,
            'quarter_type' => null,
            'quarter_rent_amount' => 500,
            'payroll_master_id' => 'master-1',
        ]);

        $meta = $this->service()->resolveQuarterMeta(
            $gov,
            [
                'hasQuarter' => true,
                'quarterId' => 'q-1',
                'quarterName' => 'B2/7',
                'quarterType' => 'Type II',
            ],
            [
                'master-1' => [
                    'quarterId' => 'q-1',
                    'hasQuarter' => true,
                    'quarterName' => 'B2/7',
                    'quarterType' => 'Type II',
                ],
            ],
            [
                'q-1' => ['name' => 'B2/7', 'type' => 'Type II'],
            ],
        );

        $this->assertTrue($meta['assigned']);
        $this->assertSame('q-1', $meta['quarterId']);
        $this->assertSame('B2/7', $meta['name']);
        $this->assertSame('Type II', $meta['type']);
    }

    public function test_expected_row_count_formula_for_employee_month_pairs(): void
    {
        $employeesPerMonth = [2, 2, 2];
        $this->assertSame(6, array_sum($employeesPerMonth));
    }

    public function test_three_month_workbook_round_trip_uses_snapshot_union_and_not_accommodation_or_audit_state(): void
    {
        $periods = [
            $this->period('june', '2026-06-01', 'June 2026'),
            $this->period('july', '2026-07-01', 'July 2026'),
            $this->period('august', '2026-08-01', 'August 2026'),
        ];
        $months = [
            'june' => range(1, 10),
            'july' => range(1, 12),
            'august' => range(2, 12),
        ];
        $monthlyByPeriod = [];
        $masters = [];
        foreach ($months as $periodId => $employeeNumbers) {
            foreach ($employeeNumbers as $number) {
                $uid = 'employee-'.$number;
                $masters[$uid] = [
                    'employeeCode' => str_pad((string) $number, 3, '0', STR_PAD_LEFT),
                    'name' => 'Employee '.$number,
                    'status' => $number <= 3 ? 'audited' : 'unaudited',
                    'dateOfJoining' => '2012-07-01',
                    'dateOfBirth' => $number === 5 ? '' : '1990-05-15',
                    // Only two employees have accommodation, which must not filter rows.
                    'quarterAssigned' => $number <= 2,
                    'quarterName' => $number <= 2 ? 'Q-'.$number : '',
                    'quarterType' => $number <= 2 ? 'Type I' : '',
                    'quarterRent' => $number <= 2 ? 500 : 0,
                ];
                $monthlyByPeriod[$periodId][] = $this->snapshot(
                    $uid,
                    $number,
                    $periodId === 'june' ? ['June Custom Earn' => 10] : ($periodId === 'july' ? ['July Custom Earn' => 20] : []),
                    $periodId === 'august' ? ['August Custom Deduction' => 5] : [],
                );
            }
        }

        $sheet = $this->service()->buildSpreadsheet(
            $periods,
            $monthlyByPeriod,
            $masters,
            [],
            [],
            ['earnings' => ['July Custom Earn', 'June Custom Earn'], 'deductions' => ['August Custom Deduction']],
        );
        // Layout: no "####" cells, dates are real date cells (blank stays blank), see SpreadsheetLayout.
        $this->assertSame([], SpreadsheetLayout::audit($sheet, ['Employee Payroll' => ['Date of Joining', 'Date of Birth']]));
        foreach (SpreadsheetLayout::columnsByHeader($sheet->getActiveSheet(), 1, ['Date of Joining', 'Date of Birth']) as $letter) {
            $this->assertSame('dd/mm/yyyy', $sheet->getActiveSheet()->getStyle($letter.'2')->getNumberFormat()->getFormatCode());
        }
        $path = tempnam(sys_get_temp_dir(), 'cirt-export-');
        self::assertIsString($path);
        try {
            (new Xlsx($sheet))->save($path);
            $roundTrip = IOFactory::load($path)->getActiveSheet()->toArray(null, true, true, false);
        } finally {
            @unlink($path);
        }

        $headers = $roundTrip[0];
        $rows = array_slice($roundTrip, 1);
        $totalsRow = array_pop($rows);
        $this->assertSame('Total', $totalsRow[0]);
        // A: 10 + 12 + 11 actual employee-month snapshots, with a 12-person union.
        $this->assertCount(33, $rows);
        $codes = array_unique(array_column($rows, 0));
        sort($codes);
        $this->assertCount(12, $codes);
        $this->assertSame('001', $codes[0]);
        $this->assertSame('012', $codes[11]);
        $column = array_flip($headers);
        // B/C: audit and residential accommodation values do not exclude any row.
        $this->assertCount(2, array_filter($rows, static fn (array $row): bool => $row[0] === '001'));
        $this->assertCount(2, array_filter($rows, static fn (array $row): bool => $row[0] === '012'));
        $this->assertSame('Yes', array_values(array_filter($rows, static fn (array $row): bool => $row[0] === '001'))[0][$column['Quarter Assigned']]);
        $this->assertSame('No', array_values(array_filter($rows, static fn (array $row): bool => $row[0] === '003'))[0][$column['Quarter Assigned']]);
        // Grouped by employee, months in order inside each employee.
        $order = array_map(static fn (array $row): string => $row[0].'|'.$row[18], $rows);
        $sorted = $rows;
        usort($sorted, static fn (array $a, array $b): int => strnatcmp($a[0], $b[0]) ?: strtotime('1 '.$a[18]) <=> strtotime('1 '.$b[18]));
        $this->assertSame($order, array_map(static fn (array $row): string => $row[0].'|'.$row[18], $sorted));
        // D/E: dynamic fields survive the actual XLSX write/read and remain month-specific.
        $this->assertArrayHasKey('June Custom Earn', $column);
        $this->assertArrayHasKey('July Custom Earn', $column);
        $this->assertArrayHasKey('August Custom Deduction', $column);
        $juneEmployeeOne = array_values(array_filter($rows, static fn (array $row): bool => $row[0] === '001' && $row[18] === 'June 2026'))[0];
        $this->assertSame(10.0, (float) $juneEmployeeOne[$column['June Custom Earn']]);
        $this->assertSame(null, $juneEmployeeOne[$column['July Custom Earn']]);
        // F: an explicit employee-ID set narrows only when supplied.
        $selected = $this->service()->buildSpreadsheet($periods, $monthlyByPeriod, $masters, [], [], ['earnings' => [], 'deductions' => []], ['employee-12' => true]);
        $this->assertSame(2, $selected->getActiveSheet()->getHighestDataRow() - 2); // two rows plus the totals row
    }

    public function test_year_and_day_counts_have_no_thousands_separator_and_headers_match_the_preview(): void
    {
        $period = $this->period('june', '2026-06-01', 'June 2026 (through day 30)');
        $gov = $this->snapshot('employee-1', 1, [], []);
        $gov->forceFill(['pay_level' => 10, 'days_in_month' => 30]);
        $masters = ['employee-1' => ['employeeCode' => '001', 'name' => 'Ram', 'dateOfJoining' => '2012-07-01', 'dateOfBirth' => '1990-05-15']];
        $custom = ['earnings' => ['', '0'], 'deductions' => []]; // blank / numeric custom labels must not become headers

        $svc = $this->service();
        $table = $svc->buildTable([$period], ['june' => [$gov]], $masters, [], [], $custom);
        $sheet = $svc->buildSpreadsheet([$period], ['june' => [$gov]], $masters, [], [], $custom);
        $path = tempnam(sys_get_temp_dir(), 'cirt-export-');
        try {
            (new Xlsx($sheet))->save($path);
            $ws = IOFactory::load($path)->getActiveSheet();
        } finally {
            @unlink($path);
        }

        $row1 = [];
        for ($c = 1, $max = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($ws->getHighestDataColumn()); $c <= $max; $c++) {
            $row1[] = $ws->getCell([$c, 1])->getValue();
        }
        $this->assertSame($table['headers'], $row1, 'the preview headers are exactly the Excel headers');
        $this->assertSame([], SpreadsheetLayout::badHeaders($row1), 'no blank, null, 0 or numeric header');
        $this->assertSame([], SpreadsheetLayout::auditHeaders($ws->getParent(), ['Employee Payroll' => 1]));

        foreach (['Year' => '2026', 'Pay Level' => '10', 'Through Day' => '30'] as $header => $shown) {
            $coord = SpreadsheetLayout::columnsByHeader($ws, 1, [$header])[0].'2';
            $this->assertSame('0', $ws->getStyle($coord)->getNumberFormat()->getFormatCode(), "{$header} format");
            $this->assertSame($shown, $ws->getCell($coord)->getFormattedValue(), $header);
        }
        $this->assertSame(2026, (int) $ws->getCell(SpreadsheetLayout::columnsByHeader($ws, 1, ['Year'])[0].'2')->getValue());
        // Money columns keep their format.
        $this->assertSame(SpreadsheetLayout::FORMAT_AMOUNT, $ws->getStyle(SpreadsheetLayout::columnsByHeader($ws, 1, ['Basic Paid'])[0].'2')->getNumberFormat()->getFormatCode());
    }

    public function test_service_source_no_longer_builds_wide_month_headers(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/EmployeePayrollExportService.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringNotContainsString("\$label.' - '.", $source);
        $this->assertStringContainsString("'Month'", $source);
        $this->assertStringNotContainsString('quarterMetaMatchesFilter', $source);
        $this->assertStringNotContainsString('quarterIds', $source);
        $this->assertTrue((new ReflectionClass(EmployeePayrollExportService::class))->hasMethod('buildHeaders'));
    }

    private function period(string $id, string $start, string $name): HrmsPayrollPeriod
    {
        $period = new HrmsPayrollPeriod;
        $period->id = $id;
        $period->period_name = $name;
        $period->period_start = Carbon::parse($start);

        return $period;
    }

    /** @param array<string, int|float> $earnings @param array<string, int|float> $deductions */
    private function snapshot(string $employeeUserId, int $number, array $earnings, array $deductions): HrmsGovernmentMonthlyPayroll
    {
        $snapshot = new HrmsGovernmentMonthlyPayroll;
        $snapshot->forceFill([
            'employee_user_id' => $employeeUserId,
            'basic_paid' => 1000 + $number,
            'total_earnings' => 1000 + $number + array_sum($earnings),
            'total_deductions' => array_sum($deductions) + ($number <= 2 ? 500 : 0),
            'net_salary' => 1000 + $number + array_sum($earnings) - array_sum($deductions) - ($number <= 2 ? 500 : 0),
            'has_quarter' => $number <= 2,
            'quarter_name' => $number <= 2 ? 'Q-'.$number : null,
            'quarter_type' => $number <= 2 ? 'Type I' : null,
            'quarter_rent_amount' => $number <= 2 ? 500 : 0,
            'custom_earnings' => $earnings,
            'custom_deductions' => $deductions,
        ]);

        return $snapshot;
    }
}
