<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use PHPUnit\Framework\TestCase;

/**
 * Client data has company-defined earnings/deductions (special_allowance, arrears, encashment_arrears,
 * over_time_allowance, gpf) that no legacy column knows. They must still reach the paybill and TDS files,
 * and the printed columns must add up to the payroll totals.
 */
final class PostPayrollCustomFieldsTest extends TestCase
{
    /** Employee 037 of the client's September 2026 payroll, plus a quarter and DA + transport arrears (Gross Arrears = DA + TR). */
    private function row(): array
    {
        return [
            'month_year' => '2026-09-01', '_ym' => 202609, '_master' => ['employee_code' => '037', 'name' => 'Amar Pandurang Ghotane', 'cpf_no' => '300'], '_user' => [],
            'pay_level' => 7, 'basic_actual' => 50000, 'basic_paid' => 50000, 'da_paid' => 30000, 'hra_paid' => 0, 'transport_paid' => 5760, 'medical_paid' => 3000,
            'encashment_paid' => 0, 'da_arrears_paid' => 1000, 'transport_arrears_paid' => 200, 'gross_arrear' => 1200,
            'custom_earnings' => '{"arrears": 22636, "encashment_arrears": 869, "special_allowance": 200, "over_time_allowance": 100}',
            'custom_deductions' => '{"gpf": 4000}',
            // Gross Arrears = DA + TR = 1200: nothing recorded beyond the two arrear lines
            'total_earnings' => 50000 + 30000 + 5760 + 3000 + 1200 + 22636 + 869 + 200 + 100,
            'income_tax_amount' => 8000, 'pt_amount' => 200, 'cpf_amount' => 9000, 'cpf_arrear' => 150, 'da_cpf_amount' => 0, 'credit_society_amount' => 2000, 'mess_amount' => 25,
            'quarter_rent_amount' => 440, 'electricity_amount' => 731,
            'total_deductions' => 8000 + 200 + 9000 + 150 + 2000 + 25 + 440 + 731 + 4000, 'net_salary' => 0,
        ];
    }

    private function paybillCells(array $row): array
    {
        $ws = (new PostPayrollDownloadService)->buildPaybill([$row], 202609)->getSheetByName('Paybill');
        $map = [];
        for ($c = 1; $c <= 80; $c++) {
            $h = $ws->getCell([$c, 3])->getValue();
            if ($h !== null && $h !== '') $map[(string) $h] = (float) $ws->getCell([$c, 4])->getValue();
        }

        return $map;
    }

    public function test_paybill_columns_add_up_to_total_pay_and_total_deduction(): void
    {
        $row = $this->row();
        $cells = $this->paybillCells($row);
        $earnCols = array_keys(array_filter(PostPayrollDownloadService::PAYBILL_EARNINGS, fn ($k, $label) => $label !== 'Tot. Pay', ARRAY_FILTER_USE_BOTH));
        $dedCols = array_keys(array_filter(PostPayrollDownloadService::PAYBILL_DEDUCTIONS, fn ($k, $label) => $label !== 'TOT.DED.', ARRAY_FILTER_USE_BOTH));
        $this->assertEqualsWithDelta((float) $row['total_earnings'], array_sum(array_intersect_key($cells, array_flip($earnCols))), 0.01, 'earnings columns = Tot. Pay');
        $this->assertEqualsWithDelta((float) $row['total_deductions'], array_sum(array_intersect_key($cells, array_flip($dedCols))), 0.01, 'deduction columns = TOT.DED.');
        $this->assertSame(23805.0, $cells['Custom Earnings'], 'custom earnings: 22636 + 869 + 200 + 100');
        $this->assertSame(4000.0, $cells['Custom Deductions']);
        $this->assertSame(1200.0, $cells['DA Arrs.'], 'all arrears = Gross Arrears = DA 1000 + TR 200');
        $this->assertSame(440.0, $cells['Quarter Rent']);
        $this->assertSame(150.0, $cells['CPF Arr']);
    }

    public function test_tds_earning_columns_add_up_and_custom_fields_land_in_their_columns(): void
    {
        $row = $this->row();
        $values = (new PostPayrollDownloadService)->tdsValues($row);
        $col = fn (string $name) => (float) ($values[array_search($name, PostPayrollDownloadService::TDS_COLUMNS, true)] ?? 0);
        $this->assertSame(22636.0 + 0.0 + 200.0, $col('Total Arrears'), 'custom arrears + transport arrears (no gross-only remainder any more)');
        $this->assertSame(869.0, $col('ENCASHMENT+ENCA DA'));
        $this->assertSame(100.0, $col('OT ALLOWANCE'));
        $this->assertSame(200.0, $col('PERKS'), 'unmapped custom earning (special_allowance) is kept, not dropped');
        $earnings = ['BASIC+DP', 'DA+DA ARRS', 'MEDICAL REIMBURSEMENT', 'SP PAY', 'FP PAY', 'MEDICAL', 'OT ALLOWANCE', '0', 'ENCASHMENT+ENCA DA', 'EX-GRATIA', 'HON+TUITION FEE+CASH', 'PERKS', 'WASH ALLOW', 'GRATUITY', 'INCENTIVE', 'Total Arrears', 'HRA', 'Conveyance(Taxable)'];
        $sum = 0.0;
        foreach ($earnings as $name) $sum += (float) ($values[array_search($name, PostPayrollDownloadService::TDS_COLUMNS, false)] ?? 0);
        $this->assertEqualsWithDelta((float) $row['total_earnings'], $sum, 0.01, 'TDS earning columns = total earnings');
    }

    public function test_custom_bag_reader_accepts_json_text_empty_list_and_arrays(): void
    {
        $this->assertSame([], PostPayrollDownloadService::customBag(['custom_earnings' => '[]'], 'custom_earnings'));
        $this->assertSame([], PostPayrollDownloadService::customBag([], 'custom_earnings'));
        $this->assertSame(['a' => 5.0], PostPayrollDownloadService::customBag(['custom_earnings' => ['a' => '5', 'b' => 'x']], 'custom_earnings'));
    }
}
