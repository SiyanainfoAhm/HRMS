<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use PHPUnit\Framework\TestCase;

/** PHP half of src/lib/payrollMasterParity.test.ts: same inputs, same fixture, same figures. */
final class MasterCalcParityTest extends TestCase
{
    public function test_php_master_calculation_matches_the_typescript_preview(): void
    {
        $cases = json_decode((string) file_get_contents(__DIR__.'/../fixtures/master_calc_parity.json'), true, 512, JSON_THROW_ON_ERROR);
        $svc = new PayrollCalculationService;
        $config = ['cpf_percentage' => 12, 'cpf_basis_field_keys' => ['gross_basic', 'da', 'hra', 'medical', 'transport'], 'cpf_calculation_mode' => 'percentage', 'cpf_fixed_amount' => 0];
        foreach ($cases as $case) {
            $out = $svc->calculateMaster($case['input'], null, null, $config);
            $actual = [
                'da_amount' => $out['da_amount'], 'hra_amount' => $out['hra_amount'], 'transport_total' => $out['transport_total'],
                'total_earnings' => $out['total_earnings'], 'cpf' => $out['cpf_effective'],
                'total_deductions' => $out['total_deductions'], 'take_home' => $out['take_home'],
            ];
            foreach ($case['expected'] as $key => $expected) {
                // One money rule (whole rupee, App Support Money = src/lib/money.ts): the Master screen (TypeScript) and
                // the server must agree to the rupee; zero tolerance.
                $tolerance = 0.0;
                $this->assertEqualsWithDelta($expected, (float) $actual[$key], $tolerance, "{$case['name']}: {$key}");
            }
        }
    }
}
