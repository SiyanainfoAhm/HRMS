<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use App\Support\PayrollTotals;
use PHPUnit\Framework\TestCase;

/**
 * DA CPF = CPF on the DA arrears = the CPF Arr line (cpf_arrear), through ONE function (PayrollTotals::daCpf).
 * The stored deductions DA CPF (da_cpf_amount) is always 0 / stale and must never be read by a report.
 * Covers the function, the Division-wise table + workbook and the CPF/VPF sheet. Synthetic rows, no database.
 * TS mirror: src/lib/daCpf.test.ts.
 */
final class DaCpfTest extends TestCase
{
    /** @return array<string, mixed> one saved monthly row */
    private function row(string $code, string $name, string $division, float $cpf, float $cpfArrear, float $vpf, float $staleDaCpf = 0): array
    {
        return [
            'employee_user_id' => 'u-'.$code, 'month_year' => '2026-10-01', '_ym' => 202610, 'pay_level' => 8,
            'division_name' => $division, 'designation_name' => null,
            'basic_actual' => 100000, 'unpaid_days' => 0, 'basic_paid' => 100000, 'da_paid' => 0, 'hra_paid' => 0, 'transport_paid' => 0, 'medical_paid' => 0,
            'cpf_amount' => $cpf, 'cpf_arrear' => $cpfArrear, 'da_cpf_amount' => $staleDaCpf, 'vpf_amount' => $vpf,
            'total_earnings' => 100000, 'total_deductions' => $cpf + $cpfArrear + $vpf, 'net_salary' => 100000 - ($cpf + $cpfArrear + $vpf),
            'custom_deductions' => '{}',
            '_master' => ['employee_code' => $code, 'name' => $name, 'designation' => 'Officer', 'division' => $division, 'uan' => '1'.$code, 'cpf_no' => 'C'.$code],
            '_user' => [],
        ];
    }

    /** @return list<array<string, mixed>> */
    private function rows(): array
    {
        return [
            $this->row('001', 'Karalkar', 'Accounts', 11780, 498, 0, 7000), // a stale da_cpf_amount of 7,000 must be ignored
            $this->row('002', 'Beta', 'Accounts', 5000, 0, 3000),
            $this->row('003', 'Gamma', 'Quantum Lab', 6000, 250, 1000),
        ];
    }

    public function test_the_function_reads_cpf_arr_and_never_the_stored_da_cpf(): void
    {
        $this->assertSame(498.0, PayrollTotals::daCpf(['cpfArrear' => 498]));
        $this->assertSame(498.0, PayrollTotals::daCpf(['cpf_arrear' => 498]));
        $this->assertSame(498.0, PayrollTotals::daCpf((object) ['cpf_arrear' => 498, 'da_cpf_amount' => 7000]));
        $this->assertSame(498.0, PayrollTotals::daCpf(['cpfArrear' => 498, 'deductions' => ['daCpf' => 7000], 'da_cpf_amount' => 7000]));
        $this->assertSame(0.0, PayrollTotals::daCpf(['deductions' => ['daCpf' => 7000], 'da_cpf_amount' => 7000]), 'no CPF Arr = no DA CPF');
        $this->assertSame(12278.0, PayrollTotals::totalCpf(['cpf_amount' => 11780, 'cpf_arrear' => 498]), 'Total CPF = CPF + DA CPF');
        $this->assertSame(12278.0, PayrollTotals::totalCpf(['deductions' => ['cpf' => 11780], 'cpfArrear' => 498]));
    }

    public function test_division_wise_has_da_cpf_and_total_cpf_in_every_subtotal_and_the_grand_total(): void
    {
        $t = (new PostPayrollDownloadService)->divisionWiseTable($this->rows(), []);
        $h = $t['headers'];
        $this->assertSame(['CPF Employer Contr.', 'DA CPF', 'Total CPF'], array_slice($h, 11, 3), 'DA CPF right after CPF, then Total CPF');
        $this->assertSame([8, 9, 10, 11, 12, 13], $t['moneyColumns']);

        $detail = array_values(array_filter($t['rows'], fn ($r) => $r[1] !== ''));
        $karalkar = array_values(array_filter($detail, fn ($r) => $r[2] === 'Karalkar'))[0];
        $this->assertSame([11780.0, 498.0, 12278.0], array_slice($karalkar, 11, 3), 'Karalkar: CPF, DA CPF (not the stale 7,000), Total CPF');

        $subtotals = array_values(array_filter($t['rows'], fn ($r) => str_ends_with((string) $r[0], ' - Subtotal')));
        $this->assertSame([16780.0, 498.0, 17278.0], array_slice($subtotals[0], 11, 3), 'Accounts subtotal');
        $this->assertSame([6000.0, 250.0, 6250.0], array_slice($subtotals[1], 11, 3), 'Quantum Lab subtotal');
        $this->assertSame([22780.0, 748.0, 23528.0], array_slice($t['totals'], 11, 3), 'Grand total');
        foreach ([11, 12, 13] as $c) {
            $this->assertSame($t['totals'][$c], array_sum(array_column($subtotals, $c)), "sum of divisions = grand total, column {$c}");
        }
        $this->assertSame($t['totals'][11] + $t['totals'][12], $t['totals'][13], 'Total CPF = CPF + DA CPF');
    }

    public function test_division_wise_workbook_carries_the_new_columns(): void
    {
        $ws = (new PostPayrollDownloadService)->buildDivisionWise($this->rows(), 202610, [])->getSheet(0);
        $this->assertSame(['CPF Employer Contr.', 'DA CPF', 'Total CPF'], [$ws->getCell('L1')->getValue(), $ws->getCell('M1')->getValue(), $ws->getCell('N1')->getValue()]);
        $last = $ws->getHighestRow();
        $this->assertSame('Grand Total', $ws->getCell("A{$last}")->getValue());
        $this->assertEquals([22780, 748, 23528], [$ws->getCell("L{$last}")->getValue(), $ws->getCell("M{$last}")->getValue(), $ws->getCell("N{$last}")->getValue()]);
    }

    public function test_cpf_sheet_has_da_cpf_and_total_cpf_and_cpf_recovery_equals_their_sum(): void
    {
        $ws = (new PostPayrollDownloadService)->buildCpf($this->rows(), 202610, null)->getActiveSheet();
        $this->assertSame(['CPF', 'DA CPF', 'Total CPF', 'VPF'], array_map(fn ($c) => $ws->getCell([$c, 4])->getValue(), [13, 14, 15, 16]));
        $this->assertEquals([11780, 498, 12278], [$ws->getCell('M5')->getValue(), $ws->getCell('N5')->getValue(), $ws->getCell('O5')->getValue()], 'Karalkar');

        $grand = $cpfRow = null;
        for ($r = 5; $r <= $ws->getHighestRow(); $r++) {
            if ($ws->getCell("C{$r}")->getValue() === 'GRAND TOTAL') $grand = $r;
            if ($ws->getCell("C{$r}")->getValue() === 'CPF Recovery') $cpfRow = $r;
        }
        foreach (['M' => 22780, 'N' => 748, 'O' => 23528, 'P' => 4000] as $col => $expected) {
            $this->assertEquals($expected, $ws->getCell("{$col}{$grand}")->getCalculatedValue(), "grand total {$col}");
        }
        $this->assertEquals(23528, $ws->getCell("D{$cpfRow}")->getCalculatedValue(), 'CPF Recovery = CPF + DA CPF = Total CPF');
        $this->assertEquals($ws->getCell("O{$grand}")->getCalculatedValue(), $ws->getCell("D{$cpfRow}")->getCalculatedValue());
    }
}
