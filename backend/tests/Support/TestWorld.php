<?php

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Known, synthetic fixtures for the database tests: one company, an admin, a few employees with Payroll Masters,
 * quarters, field definitions, night-allowance rates, an electricity tariff and two generated (finalized) months.
 *
 * Seeded fresh inside every test's transaction (DatabaseTestCase::setUp) and rolled back with it, so each test
 * starts from exactly this and nothing here resembles the real payroll data: names are "Test Employee X",
 * codes are T1..T4, the company is "Test Institute". Tests that need more create it themselves.
 */
final class TestWorld
{
    public const COMPANY_NAME = 'Test Institute';
    public const ADMIN_EMAIL = 'admin@test.invalid';

    public string $company;
    public string $adminId;
    /** @var list<array{id: string, code: string, name: string, master: string}> */
    public array $employees = [];
    /** @var list<string> */
    public array $quarters = [];
    /** @var array{aug: string, sep: string} period ids of the two generated months */
    public array $periods = [];

    public static function seed(int $employees = 4): self
    {
        $w = new self;
        $w->company = (string) DB::table('cirt_institute')->insertGetId([
            'name' => self::COMPANY_NAME, 'code' => 'TEST', 'default_da_percent' => 63, 'default_hra_percent' => 30,
        ], 'id');

        $w->adminId = (string) DB::table('cirt_users')->insertGetId([
            'email' => self::ADMIN_EMAIL, 'name' => 'Test Admin', 'role' => 'admin', 'company_id' => $w->company,
            'employment_status' => 'current', 'password_hash' => 'x',
        ], 'id');

        $basics = [43100, 76500, 27900, 52000, 35000, 61000];
        for ($i = 1; $i <= $employees; $i++) {
            $code = "T{$i}";
            $name = 'Test Employee '.chr(64 + $i);
            $userId = (string) DB::table('cirt_users')->insertGetId([
                'email' => strtolower($code).'@test.invalid', 'name' => $name, 'employee_code' => $code, 'role' => 'employee',
                'company_id' => $w->company, 'employment_status' => 'current', 'government_pay_level' => 10, 'date_of_joining' => '2020-01-01',
                'designation' => 'Test Officer', 'password_hash' => 'x',
            ], 'id');
            $basic = $basics[($i - 1) % count($basics)];
            $masterId = (string) DB::table('cirt_payroll_master')->insertGetId([
                'company_id' => $w->company, 'employee_user_id' => $userId, 'user_id' => $userId, 'employee_code' => $code, 'name' => $name,
                'email' => strtolower($code).'@test.invalid', 'payroll_mode' => 'government', 'pay_level' => 10,
                'gross_basic' => $basic, 'gross_basic_pay' => $basic, 'gross_salary' => $basic, 'da_percent' => 63, 'hra_percent' => 30,
                'medical_fixed' => 3000, 'medical' => 3000, 'transport_slab_group' => 'high', 'transport_base' => 3600, 'transport_da_percent' => 63,
                'pt_default' => 200, 'water_default' => 314, 'mess_default' => 25, 'electricity_default' => 49,
                'division' => 'Test Division '.($i % 2 ? 'A' : 'B'), 'designation' => 'Test Officer', 'department' => 'Test Dept',
                'status' => 'active', 'effective_start_date' => '2020-01-01', 'effective_from' => '2020-01-01', 'has_quarter' => false,
            ], 'id');
            $w->employees[] = ['id' => $userId, 'code' => $code, 'name' => $name, 'master' => $masterId];
        }

        $w->seedQuarters();
        $w->seedFieldDefinitions();
        $w->seedNightAllowanceRates();
        $w->seedTariffAndRevisions();
        $w->seedGeneratedMonths();

        return $w;
    }

    private function seedQuarters(): void
    {
        $typeId = (string) Str::uuid();
        DB::table('cirt_quarter_types')->insert([
            'id' => $typeId, 'company_id' => $this->company, 'name' => 'Type III', 'normalized_name' => 'type iii', 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach (['T3/1' => 880, 'T3/2' => 500, 'T3/3' => 440] as $name => $rent) {
            $id = (string) Str::uuid();
            DB::table('cirt_quarters')->insert([
                'id' => $id, 'company_id' => $this->company, 'quarter_name' => $name, 'quarter_type' => 'Type III', 'quarter_type_id' => $typeId,
                'monthly_rent' => $rent, 'status' => 'available', 'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->quarters[] = $id;
        }
    }

    private function seedFieldDefinitions(): void
    {
        $defs = [
            ['mess', 'Mess', 'deduction'], ['water', 'Water', 'deduction'], ['loan_recovery', 'Bank Recovery', 'deduction'],
            ['welfare', 'Welfare', 'deduction'], ['incentive', 'Incentive', 'earning'],
        ];
        foreach ($defs as $order => [$key, $label, $group]) {
            DB::table('cirt_payroll_field_definitions')->insert([
                'id' => (string) Str::uuid(), 'company_id' => $this->company, 'field_key' => $key, 'field_label' => $label, 'field_group' => $group,
                'include_in_total_earnings' => $group === 'earning', 'include_in_total_deductions' => $group === 'deduction',
                'is_system' => true, 'display_order' => $order, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function seedNightAllowanceRates(): void
    {
        $table = [1 => [1, '23.20'], 2 => [2, '26.10'], 3 => [3, '28.85'], 4 => [4, '32.65'], 5 => [5, '36.55'], 6 => [5, '38.05'],
            7 => [5, '39.60'], 8 => [5, '41.25'], 9 => [6, '43.50'], 10 => [6, '46.00'], 11 => [7, '50.40'], 12 => [8, '55.45'],
            13 => [8, '58.55'], 14 => [9, '63.60']];
        foreach ($table as $slab => [$level, $rate]) {
            DB::table('cirt_night_allowance_rates')->insert([
                'id' => (string) Str::uuid(), 'company_id' => $this->company, 'slab_no' => $slab, 'pay_level' => $level,
                'rate_per_hour' => $rate, 'rate_per_duty' => $rate, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function seedTariffAndRevisions(): void
    {
        DB::table('cirt_electricity_tariffs')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->company, 'effective_from' => '2000-01-01', 'sthir_aakar' => 140,
            'vahan_aakar_per_unit' => 1.6, 'fuel_charge' => 0, 'duty_percentage' => 16, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('cirt_da_revision_events')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->company, 'old_da_percent' => 60, 'new_da_percent' => 63,
            'effective_from' => '2026-07-01', 'revision_reason' => 'Test revision', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** August and September 2026 as generated (finalized) months, one row + payslip per employee. */
    private function seedGeneratedMonths(): void
    {
        foreach (['aug' => ['2026-08-01', '2026-08-31', 31], 'sep' => ['2026-09-01', '2026-09-30', 30]] as $key => [$start, $end, $days]) {
            $periodId = (string) DB::table('cirt_payroll_periods')->insertGetId([
                'company_id' => $this->company, 'period_name' => date('F Y', strtotime($start)), 'period_start' => $start, 'period_end' => $end,
            ], 'id');
            $this->periods[$key] = $periodId;
            foreach ($this->employees as $e) {
                $basic = (float) DB::table('cirt_payroll_master')->where('id', $e['master'])->value('gross_basic');
                $da = round($basic * 0.63);
                $hra = round($basic * 0.30);
                $gross = $basic + $da + $hra + 3000 + 3600;
                $payslip = (string) DB::table('cirt_payslips')->insertGetId([
                    'company_id' => $this->company, 'employee_user_id' => $e['id'], 'payroll_period_id' => $periodId, 'basic' => $basic,
                    'gross_pay' => $gross, 'net_pay' => $gross - 1000, 'deductions' => 1000, 'pay_days' => $days, 'payroll_mode' => 'government',
                ], 'id');
                DB::table('cirt_monthly_payroll')->insert([
                    'company_id' => $this->company, 'payroll_period_id' => $periodId, 'payroll_master_id' => $e['master'], 'employee_user_id' => $e['id'],
                    'payslip_id' => $payslip, 'month_year' => $start, 'salary_date' => $end, 'days_in_month' => $days, 'paid_days' => $days, 'unpaid_days' => 0,
                    'pay_level' => 10, 'basic_actual' => $basic, 'basic_paid' => $basic, 'da_actual' => $da, 'da_paid' => $da,
                    'hra_actual' => $hra, 'hra_paid' => $hra, 'medical_actual' => 3000, 'medical_paid' => 3000,
                    'transport_actual' => 3600, 'transport_paid' => 3600, 'total_earnings' => $gross, 'total_deductions' => 1000,
                    'net_salary' => $gross - 1000, 'pt_amount' => 200, 'mess_amount' => 25, 'water_amount' => 314,
                    'division_name' => 'Test Division A', 'designation_name' => 'Test Officer',
                ]);
            }
        }
    }
}
