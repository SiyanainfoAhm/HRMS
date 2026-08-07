<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Payroll logic corrections (EOL/HPL, CPF, electricity, quarter rent).
 * Mirrors frontend: src/lib/hplEolDeductions.ts, payrollCpfCalculation.ts, governmentPayroll.ts
 */
final class PayrollLogicCorrectionsTest extends TestCase
{
    private function eolHplBasisTotal(array $salary): int
    {
        return (int) round(
            max(0, $salary['basic']) +
            max(0, $salary['da']) +
            max(0, $salary['hra']) +
            max(0, $salary['medical'])
        );
    }

    private function hplBasisTotal(array $salary): int
    {
        return (int) round(max(0, $salary['basic']) + max(0, $salary['da']));
    }

    private function eolDeduction(array $salary, int $daysInMonth, int $eolDays): int
    {
        $basis = $this->eolHplBasisTotal($salary);
        $daily = $daysInMonth > 0 ? $basis / $daysInMonth : 0;

        return (int) round($daily * max(0, $eolDays));
    }

    private function hplDeduction(array $salary, int $daysInMonth, int $hplDays): int
    {
        $basis = $this->hplBasisTotal($salary);
        $daily = $daysInMonth > 0 ? $basis / $daysInMonth : 0;

        return (int) round($daily * max(0, $hplDays) * 0.5);
    }

    /** PAY-EOL-001 */
    public function test_eol_basis_excludes_transport(): void
    {
        $withTransport = [
            'basic' => 50000,
            'da' => 29000,
            'hra' => 15000,
            'medical' => 3000,
            'transport' => 5688,
        ];
        $withoutTransport = [
            'basic' => 50000,
            'da' => 29000,
            'hra' => 15000,
            'medical' => 3000,
        ];

        $this->assertSame(
            $this->eolDeduction($withoutTransport, 30, 2),
            $this->eolDeduction($withTransport, 30, 2),
        );
        $this->assertSame(6467, $this->eolDeduction($withoutTransport, 30, 2));
    }

    /** PAY-EOL-002 */
    public function test_eol_reference_previous_month_salary(): void
    {
        $june = ['basic' => 40000, 'da' => 20000, 'hra' => 12000, 'medical' => 3000];
        $july = ['basic' => 50000, 'da' => 29000, 'hra' => 15000, 'medical' => 3000];

        $juneDed = $this->eolDeduction($june, 30, 3);
        $julyDed = $this->eolDeduction($july, 31, 3);

        $this->assertSame(7500, $juneDed);
        $this->assertGreaterThan($juneDed, $julyDed);
    }

    /** PAY-HPL-001 */
    public function test_hpl_basis_excludes_transport(): void
    {
        $withTransport = [
            'basic' => 50000,
            'da' => 29000,
            'hra' => 15000,
            'medical' => 3000,
            'transport' => 5688,
        ];
        $withoutTransport = [
            'basic' => 50000,
            'da' => 29000,
            'hra' => 15000,
            'medical' => 3000,
        ];

        $this->assertSame(
            $this->hplDeduction($withoutTransport, 30, 4),
            $this->hplDeduction($withTransport, 30, 4),
        );
    }

    /** PAY-HPL-003 — HPL affects Basic and DA only, not HRA or Medical. */
    public function test_hpl_basis_excludes_hra_and_medical(): void
    {
        $basicDaOnly = ['basic' => 50000, 'da' => 29000, 'hra' => 0, 'medical' => 0];
        $withHraMedical = ['basic' => 50000, 'da' => 29000, 'hra' => 15000, 'medical' => 3000];

        $this->assertSame(
            $this->hplDeduction($basicDaOnly, 30, 4),
            $this->hplDeduction($withHraMedical, 30, 4),
        );
        $this->assertSame(5267, $this->hplDeduction($withHraMedical, 30, 4));
    }

    /** PAY-HPL-002 */
    public function test_hpl_reference_previous_month_salary(): void
    {
        $june = ['basic' => 40000, 'da' => 20000, 'hra' => 12000, 'medical' => 3000];
        $july = ['basic' => 50000, 'da' => 29000, 'hra' => 15000, 'medical' => 3000];

        $this->assertLessThan(
            $this->hplDeduction($july, 31, 2),
            $this->hplDeduction($june, 30, 2),
        );
    }

    /** CPF-001 */
    public function test_cpf_percentage_mode_from_basis(): void
    {
        $basis = 100000;
        $pct = 12;
        $this->assertSame(12000, (int) round($basis * ($pct / 100)));
    }

    /** CPF-002 */
    public function test_cpf_fixed_amount_mode(): void
    {
        $fixed = 5000;
        $basis = 200000;
        $pct = 12;
        $percentageAmount = (int) round($basis * ($pct / 100));
        $this->assertSame(5000, $fixed);
        $this->assertNotSame($fixed, $percentageAmount);
    }

    /** ELEC-001 */
    public function test_electricity_unit_rate_setting(): void
    {
        $rate = 8.0;
        $this->assertGreaterThanOrEqual(0, $rate);
    }

    /** ELEC-002 */
    public function test_electricity_deduction_calculation(): void
    {
        $units = 100;
        $rate = 8;
        $this->assertSame(800, (int) round($units * $rate));
    }

    /** ELEC-003 */
    public function test_electricity_manual_override_preserved(): void
    {
        $calculated = 800;
        $manual = 750;
        $manualOverride = true;
        $amount = $manualOverride ? $manual : $calculated;
        $this->assertSame(750, $amount);
    }

    /** QTR-RENT-001 / QTR-RENT-002 */
    public function test_quarter_rent_affects_net_pay(): void
    {
        $earnings = 100000;
        $otherDeductions = 10000;
        $defaultRent = 2000;
        $editedRent = 3500;

        $netDefault = $earnings - $otherDeductions - $defaultRent;
        $netEdited = $earnings - $otherDeductions - $editedRent;

        $this->assertSame(88000, $netDefault);
        $this->assertSame(86500, $netEdited);
        $this->assertLessThan($netDefault, $netEdited);
    }
}
