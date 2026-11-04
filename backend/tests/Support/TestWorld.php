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
    /** @var array{aug: string, sep: string, oct: string} period ids of the generated months */
    public array $periods = [];

    public static function seed(int $employees = 6): self
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
                'company_id' => $w->company, 'employment_status' => 'current', 'government_pay_level' => 10, 'date_of_joining' => '2020-01-01', 'date_of_birth' => '1985-05-05',
                'designation' => 'Test Officer', 'password_hash' => 'x',
                'pan' => $pan = 'ABCD'.chr(64 + $i).sprintf('%04d', $i).'Z', 'aadhaar' => $aadhaar = sprintf('2345678900%02d', $i),
            ], 'id');
            $basic = $basics[($i - 1) % count($basics)];
            $masterId = (string) DB::table('cirt_payroll_master')->insertGetId([
                'company_id' => $w->company, 'employee_user_id' => $userId, 'user_id' => $userId, 'employee_code' => $code, 'name' => $name,
                'email' => strtolower($code).'@test.invalid', 'payroll_mode' => 'government', 'pay_level' => 10,
                'gross_basic' => $basic, 'gross_basic_pay' => $basic, 'gross_salary' => $basic, 'da_percent' => 63, 'hra_percent' => 30,
                'medical_fixed' => 3000, 'medical' => 3000, 'transport_slab_group' => 'high', 'transport_base' => 3600, 'transport_da_percent' => 63,
                'pt_default' => 200, 'water_default' => 314, 'mess_default' => 25, 'electricity_default' => 49,
                'professional_tax' => 200, 'pt' => 200, 'mess' => 25, 'water' => 314, 'electricity' => 49, 'created_by' => $w->adminId,
                'division' => 'Test Division '.($i % 2 ? 'A' : 'B'), 'designation' => 'Test Officer', 'department' => 'Test Dept',
                'pan' => $pan, 'aadhaar' => $aadhaar, 'bank_name' => 'Test Bank', 'bank_account_number' => sprintf('90000000%04d', $i), 'bank_ifsc' => 'TEST0000001',
                'uan' => sprintf('1000000000%02d', $i), 'cpf_no' => sprintf('CPF%04d', $i), 'date_of_joining' => '2020-01-01', 'date_of_birth' => '1985-05-05',
                'status' => 'active', 'effective_start_date' => '2020-01-01', 'effective_from' => '2020-01-01', 'has_quarter' => false,
            ], 'id');
            $w->employees[] = ['id' => $userId, 'code' => $code, 'name' => $name, 'master' => $masterId];
            $lastMaster = $masterId;
        }

        $w->seedQuarters();
        // The last employee's Master carries a quarter (as most real masters do), so quarter-inheritance code paths have one to read.
        DB::table('cirt_payroll_master')->where('id', $lastMaster)->update(['quarter_id' => $w->quarters[0], 'has_quarter' => true, 'quarter_rent' => 880]);
        $w->seedFieldDefinitions();
        $w->seedNightAllowanceRates();
        $w->seedTariffAndRevisions();
        $w->seedGeneratedMonths();
        $w->seedOpenQuarterAssignment();
        $w->seedDraft();

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
        // The application's own default fields and calculation settings, exactly as a new company gets them.
        app(\App\Services\PayrollFieldService::class)->ensureCompanyDefaults($this->company, $this->adminId);
        app(\App\Services\PayrollFieldService::class)->ensureCalculationSettings($this->company);
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
            'id' => $tariffId = (string) Str::uuid(), 'company_id' => $this->company, 'effective_from' => '1999-01-01', 'sthir_aakar' => 140,
            'vahan_aakar_per_unit' => 1.6, 'fuel_charge' => 0, 'duty_percentage' => 16, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('cirt_electricity_tariff_slabs')->insert([
            'id' => (string) Str::uuid(), 'tariff_id' => $tariffId, 'from_unit' => 0, 'to_unit' => null, 'rate_per_unit' => 4, 'fuel_charge_per_unit' => 0, 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // One old-style per-employee activity log row, so the legacy endpoint has something to serve.
        DB::table('cirt_activity_logs')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->company, 'actor_user_id' => $this->adminId, 'action' => 'seed.legacy', 'outcome' => 'succeeded',
        ]);
        DB::table('cirt_da_revision_events')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->company, 'old_da_percent' => 60, 'new_da_percent' => 63,
            'effective_from' => '2026-07-01', 'revision_reason' => 'Test revision', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** August, September and October 2026 as generated (finalized) months, one row + payslip per employee. */
    private function seedGeneratedMonths(): void
    {
        foreach (['aug' => ['2026-08-01', '2026-08-31', 31], 'sep' => ['2026-09-01', '2026-09-30', 30], 'oct' => ['2026-10-01', '2026-10-31', 31]] as $key => [$start, $end, $days]) {
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
                    'gross_pay' => $gross, 'net_pay' => $gross - 539, 'deductions' => 539, 'pay_days' => $days, 'payroll_mode' => 'government',
                ], 'id');
                DB::table('cirt_monthly_payroll')->insert([
                    'company_id' => $this->company, 'payroll_period_id' => $periodId, 'payroll_master_id' => $e['master'], 'employee_user_id' => $e['id'],
                    'payslip_id' => $payslip, 'month_year' => $start, 'salary_date' => $end, 'days_in_month' => $days, 'paid_days' => $days, 'unpaid_days' => 0,
                    'pay_level' => 10, 'basic_actual' => $basic, 'basic_paid' => $basic, 'da_actual' => $da, 'da_paid' => $da,
                    'hra_actual' => $hra, 'hra_paid' => $hra, 'medical_actual' => 3000, 'medical_paid' => 3000,
                    'transport_actual' => 3600, 'transport_paid' => 3600, 'total_earnings' => $gross, 'total_deductions' => 539,
                    'net_salary' => $gross - 539, 'pt_amount' => 200, 'mess_amount' => 25, 'water_amount' => 314,
                    'division_name' => 'Test Division A', 'designation_name' => 'Test Officer',
                ]);
            }
        }
    }

    /** The first employee holds the second quarter through an open assignment (history the quarter code reads). */
    private function seedOpenQuarterAssignment(): void
    {
        DB::table('cirt_quarter_assignments')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->company, 'quarter_id' => $this->quarters[1], 'employee_id' => $this->employees[0]['id'],
            'assigned_from' => '2026-01-01', 'assigned_to' => null, 'rent_at_assignment' => 500, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('cirt_quarters')->where('id', $this->quarters[1])->update(['status' => 'occupied', 'assigned_employee_id' => $this->employees[0]['id'], 'assigned_from' => '2026-01-01']);
    }

    /** A saved draft (Jan 2030) with one calculated government row: the "calculated payroll row" the audit-baseline tests start from. */
    private function seedDraft(): void
    {
        $e = $this->employees[0];
        $draftId = (string) Str::uuid();
        DB::table('cirt_payroll_drafts')->insert([
            'id' => $draftId, 'company_id' => $this->company, 'payroll_month' => 1, 'payroll_year' => 2030, 'status' => 'draft', 'version' => 1,
            'created_by' => $this->adminId, 'updated_by' => $this->adminId, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $payload = [
            'employeeUserId' => $e['id'], 'employeeName' => $e['name'], 'employeeCode' => $e['code'], 'payDays' => 31, 'grossPay' => 96126, 'deductions' => 1000, 'netPay' => 95126,
            'governmentMonthly' => [
                'basicPaid' => 43100, 'daPaid' => 27153, 'hraPaid' => 12930, 'medicalPaid' => 3000, 'transportPaid' => 5868,
                'deductions' => ['pt' => 200, 'cpf' => 800, 'electricity' => 49, 'water' => 314, 'mess' => 25],
                'electricityUnitsConsumed' => 0, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
                'totalEarnings' => 96126, 'totalDeductions' => 1000, 'netSalary' => 95126,
            ],
            'govRecalc' => [
                'grossBasic' => 43100, 'daPercent' => 63, 'hraPercent' => 30, 'medicalFixed' => 3000, 'payLevel' => 10,
                'electricityMode' => 'manual_fixed', 'electricityApplicable' => true, 'electricityManualOverride' => false,
                'deductionDefaults' => ['electricity' => 49, 'water' => 314, 'mess' => 25], 'deductionPaidOverrides' => [],
            ],
        ];
        DB::table('cirt_payroll_draft_employees')->insert([
            'id' => (string) Str::uuid(), 'payroll_draft_id' => $draftId, 'employee_user_id' => $e['id'], 'employee_code' => $e['code'], 'payroll_master_id' => $e['master'],
            'pay_days' => 31, 'gross_pay' => 96126, 'total_earnings' => 96126, 'total_deductions' => 1000, 'net_pay' => 95126, 'row_payload' => json_encode($payload),
            'version' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
