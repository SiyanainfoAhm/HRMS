<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use PHPUnit\Framework\TestCase;

/**
 * The CPF remittance sheet (PostPayrollDownloadService::buildCpf): the DA CPF column (CPF on DA arrears), the totals rows,
 * the summary block (CPF Recovery = CPF + DA CPF, VPF Recovery, Employers P F Contribution = Pension + Emp Contr.), and the
 * "employer share not configured" note. Builds the workbook in memory from synthetic rows; no database.
 */
final class CpfSheetTest extends TestCase
{
    /** @return array<string, mixed> */
    private function row(string $code, string $name, float $basic, float $da, float $hra, float $cpf, float $cpfArrear, float $vpf, array $custom = []): array
    {
        return [
            'employee_user_id' => $code, '_ym' => 202610, '_master' => ['employee_code' => $code, 'name' => $name, 'uan' => '100'.$code, 'cpf_no' => 'C'.$code],
            'basic_actual' => $basic, 'unpaid_days' => 0, 'basic_paid' => $basic, 'da_paid' => $da, 'hra_paid' => $hra, 'transport_paid' => 0, 'medical_paid' => 0,
            'cpf_amount' => $cpf, 'cpf_arrear' => $cpfArrear, 'vpf_amount' => $vpf, 'custom_deductions' => json_encode($custom),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function rows(): array
    {
        return [
            $this->row('001', 'Alpha One', 40000, 25200, 12000, 9264, 500, 3000),     // Total 77,200; 12% = 9,264
            $this->row('002', 'Beta Two', 30000, 18900, 0, 5868, 250, 0),               // Total 48,900; 12% = 5,868
            $this->row('003', 'Gamma Gpf', 50000, 31500, 15000, 0, 0, 0, ['gpf' => 41666]),  // GPF member: no CPF
        ];
    }

    private function sheet(?array $rule = null): \PhpOffice\PhpSpreadsheet\Worksheet\Worksheet
    {
        return (new PostPayrollDownloadService)->buildCpf($this->rows(), 202610, $rule)->getActiveSheet();
    }

    /** First row (from 5) whose column B or C equals the label. */
    private function find(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $ws, string $label): int
    {
        for ($r = 5; $r <= $ws->getHighestRow(); $r++) {
            if ($ws->getCell("B{$r}")->getValue() === $label || $ws->getCell("C{$r}")->getValue() === $label) return $r;
        }
        $this->fail("row '{$label}' not found");
    }

    public function test_da_cpf_column_follows_cpf_and_holds_the_cpf_arrear(): void
    {
        $ws = $this->sheet();
        $this->assertSame(
            ['SR NO', 'UAN', 'NAME AS PER UAN', 'CPF  NO', 'GBASIC', 'NCP DAYS', 'BASIC', 'DA', 'HRA', 'TPT', 'MEDICAL', 'Total', 'CPF', 'DA CPF', 'VPF', 'PENSION', 'EMP_ CONTR.'],
            array_map(fn ($c) => $ws->getCell([$c, 4])->getValue(), range(1, 17)),
        );
        $this->assertEquals([9264, 5868, 0], [$ws->getCell('M5')->getValue(), $ws->getCell('M6')->getValue(), $ws->getCell('M7')->getValue()], 'CPF');
        $this->assertEquals([500, 250, 0], [$ws->getCell('N5')->getValue(), $ws->getCell('N6')->getValue(), $ws->getCell('N7')->getValue()], 'DA CPF = CPF Arr');
        $this->assertEquals([3000, 0, 0], [$ws->getCell('O5')->getValue(), $ws->getCell('O6')->getValue(), $ws->getCell('O7')->getValue()], 'VPF moved one column right');
    }

    public function test_totals_rows_include_the_da_cpf_column(): void
    {
        $ws = $this->sheet();
        $cirt = $this->find($ws, 'CIRT TOTAL');
        $contract = $this->find($ws, 'CONTRACT TOTAL');
        $grand = $this->find($ws, 'GRAND TOTAL');
        foreach (['M', 'N', 'O', 'P', 'Q'] as $col) {
            $this->assertStringStartsWith("=SUBTOTAL(109,{$col}5:{$col}", (string) $ws->getCell("{$col}{$cirt}")->getValue(), "CIRT TOTAL {$col}");
            $this->assertSame(0, $ws->getCell("{$col}{$contract}")->getValue(), "CONTRACT TOTAL {$col} (no contract employees)");
            $this->assertSame("={$col}{$cirt}+{$col}{$contract}", $ws->getCell("{$col}{$grand}")->getValue(), "GRAND TOTAL {$col}");
        }
        $this->assertEquals(15132, $ws->getCell("M{$grand}")->getCalculatedValue(), 'CPF total');
        $this->assertEquals(750, $ws->getCell("N{$grand}")->getCalculatedValue(), 'DA CPF total');
        $this->assertEquals(3000, $ws->getCell("O{$grand}")->getCalculatedValue(), 'VPF total');
    }

    public function test_summary_block_formulas_and_total(): void
    {
        $ws = $this->sheet();
        $grand = $this->find($ws, 'GRAND TOTAL');
        $cpfRow = $this->find($ws, 'CPF Recovery');
        $vpfRow = $this->find($ws, 'VPF Recovery');
        $employerRow = $this->find($ws, 'Employers P F Contribution');
        $total = $this->find($ws, 'TOTAL');

        $this->assertSame([$cpfRow + 1, $cpfRow + 2], [$vpfRow, $employerRow], 'order: CPF Recovery, VPF Recovery, Employers P F Contribution');
        $this->assertSame([1, 2, 3], [$ws->getCell("B{$cpfRow}")->getValue(), $ws->getCell("B{$vpfRow}")->getValue(), $ws->getCell("B{$employerRow}")->getValue()]);
        $this->assertSame("=M{$grand}+N{$grand}", $ws->getCell("D{$cpfRow}")->getValue(), 'CPF Recovery = CPF + DA CPF (employee deductions)');
        $this->assertSame("=O{$grand}", $ws->getCell("D{$vpfRow}")->getValue(), 'VPF Recovery = VPF');
        $this->assertSame("=P{$grand}+Q{$grand}", $ws->getCell("D{$employerRow}")->getValue(), 'Employers P F Contribution = PENSION + EMP_ CONTR.');
        $this->assertSame('=SUM(D'.$cpfRow.':D'.$employerRow.')', $ws->getCell("D{$total}")->getValue(), 'TOTAL = sum of the three');
        $this->assertEquals(15882, $ws->getCell("D{$cpfRow}")->getCalculatedValue());
        $this->assertEquals(3000, $ws->getCell("D{$vpfRow}")->getCalculatedValue());
        $this->assertEquals(0, $ws->getCell("D{$employerRow}")->getCalculatedValue(), 'nothing configured: employer share is 0, not invented');
        $this->assertEquals(18882, $ws->getCell("D{$total}")->getCalculatedValue());
    }

    public function test_without_a_rule_pension_and_employer_columns_stay_empty_and_the_note_is_printed(): void
    {
        $ws = $this->sheet(null);
        foreach ([5, 6, 7] as $r) {
            $this->assertNull($ws->getCell("P{$r}")->getValue(), "PENSION row {$r} empty");
            $this->assertNull($ws->getCell("Q{$r}")->getValue(), "EMP_ CONTR. row {$r} empty");
        }
        $total = $this->find($ws, 'TOTAL');
        $this->assertSame(
            'Employer share (Pension / Employer contribution) not configured — confirm ASRTU CPF Trust rule.',
            $ws->getCell('C'.($total + 1))->getValue(),
        );
    }

    public function test_with_a_rule_both_columns_are_calculated_per_employee_and_the_note_goes_away(): void
    {
        // Pension 8.33% of the CPF wage (Total) capped at 15,000; employer contribution 3.67% of the wage.
        $ws = $this->sheet(['pensionPercentage' => 8.33, 'pensionWageCeiling' => 15000.0, 'employerContributionPercentage' => 3.67]);
        $this->assertEquals(1250, $ws->getCell('P5')->getValue(), 'Alpha: 8.33% of min(77,200; 15,000) = 1,249.50 -> 1,250');
        $this->assertEquals(1250, $ws->getCell('P6')->getValue(), 'Beta: capped at 15,000 too');
        $this->assertEquals(2833, $ws->getCell('Q5')->getValue(), 'Alpha: 3.67% of 77,200 = 2,833.24');
        $this->assertEquals(1795, $ws->getCell('Q6')->getValue(), 'Beta: 3.67% of 48,900 = 1,794.63');
        $this->assertNull($ws->getCell('P7')->getValue(), 'GPF member pays no CPF, so no employer share');
        $this->assertNull($ws->getCell('Q7')->getValue());

        $grand = $this->find($ws, 'GRAND TOTAL');
        $this->assertEquals(2500, $ws->getCell("P{$grand}")->getCalculatedValue());
        $this->assertEquals(4628, $ws->getCell("Q{$grand}")->getCalculatedValue());
        $employer = $this->find($ws, 'Employers P F Contribution');
        $this->assertEquals(7128, $ws->getCell("D{$employer}")->getCalculatedValue(), 'Employers P F Contribution = Pension + Emp Contr.');
        $total = $this->find($ws, 'TOTAL');
        $this->assertNotSame(
            'Employer share (Pension / Employer contribution) not configured — confirm ASRTU CPF Trust rule.',
            $ws->getCell('C'.($total + 1))->getValue(),
            'the note only appears while the rule is empty',
        );
    }
}
