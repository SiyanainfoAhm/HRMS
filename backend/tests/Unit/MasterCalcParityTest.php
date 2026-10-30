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
                // KNOWN, UNRESOLVED BUSINESS DECISION: the Master screen (TypeScript) keeps
                // paise while the server stores whole rupees for DA/HRA/transport, so the
                // saved figure can differ by up to the sum of those roundings. Anything
                // larger than that is a real calculation difference.
                $tolerance = 0.0;
                $this->assertEqualsWithDelta($expected, (float) $actual[$key], $tolerance, "{$case['name']}: {$key}");
            }
        }
    }
}
