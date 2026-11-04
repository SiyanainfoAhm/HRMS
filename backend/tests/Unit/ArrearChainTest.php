<?php

namespace Tests\Unit;

use App\Services\PayrollDraftService;
use App\Services\PostPayrollDownloadService;
use App\Support\PayrollTotals;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * PHP half of src/lib/arrearChain.test.ts: DA, TR and CPF Arrears are the inputs; Gross Arrears = DA + TR and
 * Net Arrears = Gross - CPF Arr are derived. Gross (earnings) holds DA and TR once, Total Deductions holds
 * CPF Arr once, Net Pay = Gross - Total Deductions, so Net Arrears is a memo.
 */
final class ArrearChainTest extends TestCase
{
    private function base(): array
    {
        return [
            'governmentMonthly' => [
                'basicPaid' => 34590, 'transportPaid' => 5760, 'hraPaid' => 25830, 'medicalPaid' => 3000,
                'daArrearsPaid' => 0, 'transportArrearsPaid' => 0, 'grossArrear' => 0, 'cpfArrear' => 0, 'netArrear' => 0,
                'deductions' => ['pt' => 200, 'cpf' => 4151],
                'totalEarnings' => 69180, 'totalDeductions' => 4351, 'netSalary' => 64829,
            ],
            'daArrear' => 0, 'transportArrear' => 0, 'grossArrear' => 0, 'cpfArrear' => 0, 'netArrear' => 0,
        ];
    }

    /** What a draft save does with a changed-fields patch, then the totals recalculation. */
    private function save(array $before, array $incomingGm, array $changed): array
    {
        $service = new PayrollDraftService;
        $ref = new ReflectionClass($service);
        $patch = $ref->getMethod('applyChangedFields');
        $patch->setAccessible(true);
        $totals = $ref->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $incoming = ['governmentMonthly' => $incomingGm];
        foreach (['daArrearsPaid' => 'daArrear', 'transportArrearsPaid' => 'transportArrear', 'cpfArrear' => 'cpfArrear'] as $gmKey => $rowKey) {
            if (array_key_exists($gmKey, $incomingGm)) $incoming[$rowKey] = $incomingGm[$gmKey];
        }

        return $totals->invoke($service, $patch->invoke($service, $before, $incoming, $changed), []);
    }

    private function assertChain(array $payload, float $da, float $tr, float $cpf, string $label): void
    {
        $gm = $payload['governmentMonthly'];
        $this->assertSame($da + $tr, (float) $gm['grossArrear'], "$label: gross arrears = DA + TR");
        $this->assertSame($da + $tr - $cpf, (float) $gm['netArrear'], "$label: net arrears = gross - CPF Arr");
        $this->assertSame(69180.0 + $da + $tr, (float) $gm['totalEarnings'], "$label: Gross holds DA + TR once");
        $this->assertSame(4351.0 + $cpf, (float) $gm['totalDeductions'], "$label: Total Deductions holds CPF Arr once");
        $this->assertSame((float) $gm['totalEarnings'] - (float) $gm['totalDeductions'], (float) $gm['netSalary'], "$label: Net Pay = Gross - Total Deductions");
        $this->assertSame(64829.0 + ($da + $tr) - $cpf, (float) $gm['netSalary'], "$label: Net Pay moved by gross arrears - CPF Arr");
        $this->assertSame((float) $gm['totalEarnings'], (float) $payload['grossPay']);
        $this->assertSame((float) $gm['netSalary'], (float) $payload['netPay']);
    }

    public function test_the_shared_fixture(): void
    {
        $cases = json_decode((string) file_get_contents(__DIR__.'/../fixtures/arrear_chain_cases.json'), true, 512, JSON_THROW_ON_ERROR)['cases'];
        foreach ($cases as $c) {
            $r = PayrollTotals::arrearChain($c['da'], $c['tr'], $c['cpf']);
            $this->assertSame((float) $c['grossArrear'], $r['grossArrear'], "gross for {$c['da']}+{$c['tr']}");
            $this->assertSame((float) $c['netArrear'], $r['netArrear'], "net for {$c['da']}+{$c['tr']}-{$c['cpf']}");
        }
    }

    public function test_changing_da_then_tr_then_cpf_arr_in_a_draft_save_updates_the_whole_chain(): void
    {
        $saved = $this->base();
        // DA only
        $gm = $saved['governmentMonthly'];
        $gm['daArrearsPaid'] = 1923;
        $saved = $this->save($saved, $gm, ['daArrear']);
        $this->assertChain($saved, 1923, 0, 0, 'DA only');
        // then TR
        $gm = $saved['governmentMonthly'];
        $gm['transportArrearsPaid'] = 100;
        $saved = $this->save($saved, $gm, ['transportArrear']);
        $this->assertChain($saved, 1923, 100, 0, 'then TR');
        // then CPF Arr
        $gm = $saved['governmentMonthly'];
        $gm['cpfArrear'] = 243;
        $saved = $this->save($saved, $gm, ['cpfArrear']);
        $this->assertChain($saved, 1923, 100, 243, 'then CPF Arr');
        // a stale client sending its own gross/net does not win (409 merge: the server derives them)
        $gm = $saved['governmentMonthly'];
        $gm['daArrearsPaid'] = 2000;
        $gm['grossArrear'] = 99999;
        $gm['netArrear'] = 99999;
        $saved = $this->save($saved, $gm, ['daArrear', 'grossArrear', 'netArrear']);
        $this->assertChain($saved, 2000, 100, 243, 'stale gross/net from a conflicting client');
    }

    public function test_zero_and_large_values_and_paise(): void
    {
        $gm = $this->base()['governmentMonthly'];
        $gm['daArrearsPaid'] = 0;
        $this->assertChain($this->save($this->base(), $gm, ['daArrear']), 0, 0, 0, 'zero');
        $gm['daArrearsPaid'] = 100000000;
        $gm['transportArrearsPaid'] = 50000000;
        $gm['cpfArrear'] = 18000000;
        $this->assertChain($this->save($this->base(), $gm, ['daArrear', 'transportArrear', 'cpfArrear']), 100000000, 50000000, 18000000, 'large');
        $gm['daArrearsPaid'] = 1000.5;
        $gm['transportArrearsPaid'] = 0;
        $gm['cpfArrear'] = 144.09;
        $this->assertChain($this->save($this->base(), $gm, ['daArrear', 'transportArrear', 'cpfArrear']), 1001, 0, 144, 'paise rounded to the rupee');
    }

    public function test_reload_of_an_old_draft_rederives_gross_and_net(): void
    {
        // The one kind of row seen in practice: gross arrears 2148 stored next to DA 2040 + TR 324 and CPF Arr 257.76.
        $old = $this->base();
        $old['governmentMonthly'] = array_merge($old['governmentMonthly'], [
            'daArrearsPaid' => 2040, 'transportArrearsPaid' => 324, 'grossArrear' => 2148, 'cpfArrear' => 257.76, 'netArrear' => 1890.24,
            'totalEarnings' => 69180 + 2364, 'totalDeductions' => 4351 + 257.76, 'netSalary' => 64829 + 2364 - 257.76,
        ]);
        $service = new PayrollDraftService;
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $out = $totals->invoke($service, $old, []);
        $this->assertChain($out, 2040, 324, 258, 'old draft re-derived');
    }

    public function test_totals_helpers_agree_with_the_chain(): void
    {
        $gm = ['daArrearsPaid' => 2000, 'transportArrearsPaid' => 100, 'grossArrear' => 99999, 'cpfArrear' => 243];
        $this->assertSame(2100.0, PayrollTotals::arrearsTotal($gm), 'a stored gross is never trusted');
        $this->assertSame(1857.0, PayrollTotals::netArrear($gm));
        $this->assertSame(2100.0, PostPayrollDownloadService::arrearsTotal(['da_arrears_paid' => 2000, 'transport_arrears_paid' => 100, 'gross_arrear' => 99999]), 'report arrears = DA + TR');
        $this->assertSame(0.0, PayrollTotals::arrearsTotal([]));
    }
}
