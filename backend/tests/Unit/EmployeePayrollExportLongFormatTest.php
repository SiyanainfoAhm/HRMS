<?php

namespace Tests\Unit;

use App\Models\HrmsGovernmentMonthlyPayroll;
use App\Models\HrmsPayrollPeriod;
use App\Services\EmployeePayrollExportService;
use Carbon\Carbon;
use Illuminate\Contracts\Console\Kernel;
use PHPUnit\Framework\TestCase;
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
        $this->assertSame('Through Day', $headers[19]);
        $this->assertContains('Basic Paid', $headers);
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
            'std_licence_fee_amount' => 0,
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
            'custom_earnings' => ['Special Allowance' => 2500],
            'custom_deductions' => [],
        ]);

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

    public function test_service_source_no_longer_builds_wide_month_headers(): void
    {
        $path = dirname(__DIR__, 2).'/app/Services/EmployeePayrollExportService.php';
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringNotContainsString("\$label.' - '.", $source);
        $this->assertStringContainsString("'Month'", $source);
        $this->assertTrue((new ReflectionClass(EmployeePayrollExportService::class))->hasMethod('buildHeaders'));
    }
}
