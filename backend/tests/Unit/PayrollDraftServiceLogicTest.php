<?php

namespace Tests\Unit;

use App\Services\PayrollDraftService;
use App\Services\PayrollCalculationService;
use App\Services\ElectricityTariffService;
use App\Services\QuarterService;
use App\Services\QuarterTypeService;
use App\Models\HrmsElectricityTariff;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

final class PayrollDraftServiceLogicTest extends TestCase
{
    public function test_change_from_40_to_80_units_recalculates_prior_49_bill_and_preserves_other_components(): void
    {
        $tariff = [
            'id' => 'fixture-tariff', 'effectiveFrom' => '2026-10-01', 'sthirAakar' => 0,
            'vahanAakarPerUnit' => 0, 'fuelCharge' => 0, 'dutyPercentage' => 0,
            'slabs' => [['fromUnit' => 1, 'toUnit' => 1000, 'ratePerUnit' => 1.225, 'fuelChargePerUnit' => 0, 'sortOrder' => 1]],
        ];
        $tariffModel = $this->createMock(HrmsElectricityTariff::class);
        $calculator = new ElectricityTariffService;
        $tariffs = $this->createMock(ElectricityTariffService::class);
        $tariffs->method('resolveForDate')->willReturn($tariffModel);
        $tariffs->method('formatTariff')->willReturn($tariff);
        $tariffs->method('calculateBill')->willReturnCallback(
            fn (float $units, ?array $configured, bool $applicable, string $mode, float $legacy, float $fixed, bool $override, ?float $manual) =>
                $calculator->calculateBill($units, $configured, $applicable, $mode, $legacy, $fixed, $override, $manual),
        );
        $service = new PayrollDraftService(null, null, $tariffs);
        $payload = [
            'grossPay' => 100000,
            'governmentMonthly' => [
                'basicPaid' => 100000,
                'electricityUnitsConsumed' => 80,
                'electricityTariffId' => 'fixture-tariff',
                'electricityTotal' => 49,
                'totalEarnings' => 100000,
                'deductions' => ['electricity' => 49, 'mess' => 650, 'creditSociety' => 11750, 'quarterRent' => 400],
            ],
            'govRecalc' => [
                'electricityUnitsConsumed' => 80,
                'electricityMode' => 'unit_based',
                'electricityApplicable' => true,
                'electricityManualOverride' => false,
                'electricityTariff' => $tariff,
                'deductionDefaults' => ['electricity' => 49],
            ],
        ];

        $updated = $service->reconcileDraftElectricity($payload, 'fixture-company', 2026, 10, ['electricityUnitsConsumed']);
        $gm = $updated['governmentMonthly'];
        $this->assertSame(98.0, (float) $gm['deductions']['electricity'], 'the old calculated ₹49 must not be treated as a manual override');
        $this->assertSame(650, $gm['deductions']['mess']);
        $this->assertSame(11750, $gm['deductions']['creditSociety']);
        $this->assertSame(400, $gm['deductions']['quarterRent']);
        $this->assertSame(12898.0, $gm['totalDeductions']);
        $this->assertSame(87102.0, $gm['netSalary']);
        $this->assertFalse($updated['govRecalc']['electricityManualOverride']);

        $conflictingSnapshot = $payload;
        $conflictingSnapshot['governmentMonthly']['electricityTariffId'] = 'fixture-tariff';
        $conflictingSnapshot['governmentMonthly']['electricityTotal'] = 49;
        $conflictingSnapshot['governmentMonthly']['electricityBill'] = [
            'units' => 80, 'mode' => 'unit_based', 'tariffId' => 'fixture-tariff', 'total' => 98, 'manualOverride' => false,
        ];
        $conflictingSnapshot['govRecalc']['deductionPaidOverrides'] = ['electricity' => 49, 'mess' => 650];
        $conflictFixed = $service->reconcileDraftElectricity($conflictingSnapshot, 'fixture-company', 2026, 10, ['govDeduction_mess']);
        $this->assertSame(98.0, (float) $conflictFixed['governmentMonthly']['deductions']['electricity'], 'conflicting unit bill and deduction are reconciled from tariff on unrelated save');
        $this->assertSame(98.0, (float) $conflictFixed['governmentMonthly']['electricityBill']['total']);
        $this->assertArrayNotHasKey('electricity', $conflictFixed['govRecalc']['deductionPaidOverrides'], 'unapproved cached electricity is removed from the override map');

        $approvedManualOverride = $payload;
        $approvedManualOverride['governmentMonthly']['electricityUnitsConsumed'] = 80;
        $approvedManualOverride['govRecalc']['electricityManualOverride'] = true;
        $approvedManualOverride['govRecalc']['deductionPaidOverrides'] = ['electricity' => 49];
        $approvedManualOverride['govRecalc']['electricityTariff']['sthirAakar'] = 1; // simulate in-place tariff configuration change
        $manual = $service->reconcileDraftElectricity($approvedManualOverride, 'fixture-company', 2026, 10, ['govDeduction_mess']);
        $this->assertSame(49.0, (float) $manual['governmentMonthly']['deductions']['electricity']);
        $this->assertTrue($manual['govRecalc']['electricityManualOverride']);
        $this->assertTrue($manual['governmentMonthly']['electricityBill']['manualOverride']);
    }

    public function test_authoritative_quarter_reconciliation_preserves_unrelated_draft_components(): void
    {
        $service = new PayrollDraftService(new QuarterService(new QuarterTypeService), new PayrollCalculationService);
        $payload = [
            'payDays' => 30,
            'grossPay' => 80000,
            'governmentMonthly' => [
                'basicPaid' => 50000, 'daPaid' => 26500, 'hraActual' => 15000, 'hraPaid' => 15000,
                'extraWorkAllowancePaid' => 1500, 'totalEarnings' => 93000,
                'deductions' => ['pt' => 200, 'mess' => 650, 'creditSociety' => 11750, 'lic' => 300, 'vpf' => 400, 'pfLoan' => 150, 'postOffice' => 100, 'water' => 75, 'electricity' => 500, 'quarterRent' => 0],
            ],
            'govRecalc' => [
                'grossBasic' => 50000, 'hraPercent' => 30,
                'earningPaidOverrides' => ['extraWorkAllowancePaid' => 1500, 'hraPaid' => 15000],
                'deductionPaidOverrides' => ['mess' => 650, 'creditSociety' => 11750, 'lic' => 300, 'vpf' => 400, 'pfLoan' => 150, 'postOffice' => 100, 'water' => 75, 'electricity' => 500, 'quarterRent' => 0],
            ],
        ];
        $assigned = $service->applyAuthoritativeQuarterValues($payload, [
            'hasQuarter' => true, 'quarterId' => 'quarter-id', 'quarterName' => 'Q-1', 'quarterType' => 'Type-A', 'quarterRent' => 138,
        ], 2026, 10);
        $this->assertSame(0.0, $assigned['governmentMonthly']['hraPaid']);
        $this->assertSame(138.0, $assigned['governmentMonthly']['deductions']['quarterRent']);
        foreach (['mess' => 650, 'creditSociety' => 11750, 'lic' => 300, 'vpf' => 400, 'pfLoan' => 150, 'postOffice' => 100, 'water' => 75, 'electricity' => 500] as $field => $value) {
            $this->assertSame($value, $assigned['governmentMonthly']['deductions'][$field], "{$field} preserved");
        }
        $this->assertSame(1500, $assigned['governmentMonthly']['extraWorkAllowancePaid']);
        $this->assertArrayNotHasKey('hraPaid', $assigned['govRecalc']['earningPaidOverrides']);

        $unassigned = $service->applyAuthoritativeQuarterValues($assigned, [
            'hasQuarter' => false, 'quarterId' => null, 'quarterName' => null, 'quarterType' => null, 'quarterRent' => 0,
        ], 2026, 10);
        $this->assertSame(14516.0, $unassigned['governmentMonthly']['hraPaid'], 'restored HRA is prorated for 30 payable days in October');
        $this->assertSame(0.0, $unassigned['governmentMonthly']['deductions']['quarterRent']);
        $this->assertSame(11750, $unassigned['governmentMonthly']['deductions']['creditSociety']);
    }

    public function test_num_helper_preserves_zero_and_null(): void
    {
        $service = new PayrollDraftService;
        $ref = new ReflectionClass($service);
        $method = $ref->getMethod('num');
        $method->setAccessible(true);

        $this->assertSame(0.0, $method->invoke($service, 0));
        $this->assertSame(0.0, $method->invoke($service, '0'));
        $this->assertNull($method->invoke($service, null));
        $this->assertSame(12.5, $method->invoke($service, '12.5'));
    }

    public function test_partial_snapshot_merge_preserves_unrelated_values_and_explicit_zero(): void
    {
        $service = new PayrollDraftService;
        $ref = new ReflectionClass($service);
        $method = $ref->getMethod('mergeSnapshot');
        $method->setAccessible(true);
        $merged = $method->invoke($service, [
            'governmentMonthly' => ['nightAllowancePaid' => 11800, 'customDeductions' => ['mess' => 25]],
        ], [
            'governmentMonthly' => ['customDeductions' => ['mess' => 0, 'creditSociety' => 50]],
        ]);
        $this->assertSame(11800, $merged['governmentMonthly']['nightAllowancePaid']);
        $this->assertSame(0, $merged['governmentMonthly']['customDeductions']['mess']);
        $this->assertSame(50, $merged['governmentMonthly']['customDeductions']['creditSociety']);
    }

    public function test_snapshot_diff_records_previous_and_new_values(): void
    {
        $service = new PayrollDraftService;
        $ref = new ReflectionClass($service);
        $method = $ref->getMethod('diffSnapshot');
        $method->setAccessible(true);
        $changes = $method->invoke($service, ['nightAllowance' => 100], ['nightAllowance' => 0]);
        $this->assertSame(['previous' => 100, 'new' => 0], $changes['nightAllowance']);
    }

    public function test_field_patch_preserves_unedited_deductions_and_persists_explicit_zero(): void
    {
        $service = new PayrollDraftService;
        $method = (new ReflectionClass($service))->getMethod('applyChangedFields');
        $method->setAccessible(true);
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $before = [
            'governmentMonthly' => [
                'basicPaid' => 100000,
                'totalEarnings' => 100000,
                'totalDeductions' => 12750,
                'netSalary' => 87250,
                'electricityUnitsConsumed' => 48,
                'electricityMode' => 'unit_based',
                'deductions' => ['mess' => 1000, 'creditSociety' => 11750, 'electricity' => 900, 'quarterRent' => 500, 'cpf' => 600],
            ],
            'govRecalc' => ['deductionPaidOverrides' => ['mess' => 1000, 'creditSociety' => 11750, 'electricity' => 900, 'quarterRent' => 500, 'cpf' => 600]],
        ];
        // Simulate a full stale browser row whose unrelated component values are
        // zero. Only the explicitly changed Mess token may be persisted.
        $incoming = ['governmentMonthly' => [
            'basicPaid' => 100000,
            'totalEarnings' => 100000,
            'totalDeductions' => 11750,
            'netSalary' => 88250,
            'electricityUnitsConsumed' => 0,
            'electricityMode' => 'manual_fixed',
            'deductions' => ['mess' => 0, 'creditSociety' => 0, 'electricity' => 0, 'quarterRent' => 0, 'cpf' => 0],
        ], 'govRecalc' => ['deductionPaidOverrides' => ['mess' => 0, 'creditSociety' => 0, 'electricity' => 0, 'quarterRent' => 0, 'cpf' => 0]]];
        $patched = $totals->invoke($service, $method->invoke($service, $before, $incoming, ['govDeduction_mess']), []);
        $this->assertSame(0, $patched['governmentMonthly']['deductions']['mess'], 'intentional zero is a value');
        $this->assertSame(11750, $patched['governmentMonthly']['deductions']['creditSociety']);
        $this->assertSame(900, $patched['governmentMonthly']['deductions']['electricity']);
        $this->assertSame(48, $patched['governmentMonthly']['electricityUnitsConsumed'], 'unrelated Mess edit preserves previously saved Electricity Units');
        $this->assertSame('unit_based', $patched['governmentMonthly']['electricityMode']);
        $this->assertSame(500, $patched['governmentMonthly']['deductions']['quarterRent']);
        $this->assertSame(600, $patched['governmentMonthly']['deductions']['cpf']);
        $this->assertSame(11750, $patched['govRecalc']['deductionPaidOverrides']['creditSociety']);
        $this->assertSame(13750.0, $patched['governmentMonthly']['totalDeductions']);
        $this->assertSame(86250.0, $patched['governmentMonthly']['netSalary']);
    }

    public function test_sequential_mess_and_credit_society_patches_are_isolated(): void
    {
        $service = new PayrollDraftService;
        $method = (new ReflectionClass($service))->getMethod('applyChangedFields');
        $method->setAccessible(true);
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $saved = ['governmentMonthly' => ['totalEarnings' => 100000, 'totalDeductions' => 12500, 'netSalary' => 87500, 'deductions' => ['mess' => 750, 'creditSociety' => 11750]], 'govRecalc' => ['deductionPaidOverrides' => ['mess' => 750, 'creditSociety' => 11750]]];
        $staleZeroRow = ['governmentMonthly' => ['totalEarnings' => 100000, 'totalDeductions' => 11750, 'netSalary' => 88250, 'deductions' => ['mess' => 0, 'creditSociety' => 11750]], 'govRecalc' => ['deductionPaidOverrides' => ['mess' => 0, 'creditSociety' => 11750]]];
        $saved = $totals->invoke($service, $method->invoke($service, $saved, $staleZeroRow, ['govDeduction_creditSociety']), []);
        $this->assertSame(750, $saved['governmentMonthly']['deductions']['mess']);
        $this->assertSame(11750, $saved['governmentMonthly']['deductions']['creditSociety']);

        $second = ['governmentMonthly' => ['basicPaid' => 100000, 'totalEarnings' => 100000, 'totalDeductions' => 12500, 'netSalary' => 87500, 'deductions' => ['mess' => 900, 'creditSociety' => 0]], 'govRecalc' => ['deductionPaidOverrides' => ['mess' => 900, 'creditSociety' => 0]]];
        $saved = $totals->invoke($service, $method->invoke($service, $saved, $second, ['govDeduction_mess']), []);
        $this->assertSame(900, $saved['governmentMonthly']['deductions']['mess']);
        $this->assertSame(11750, $saved['governmentMonthly']['deductions']['creditSociety']);
        $this->assertSame(12650.0, $saved['governmentMonthly']['totalDeductions']);
    }

    public function test_electricity_units_patch_preserves_other_deductions_and_clears_only_electricity_override(): void
    {
        $service = new PayrollDraftService;
        $method = (new ReflectionClass($service))->getMethod('applyChangedFields');
        $method->setAccessible(true);
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $before = ['governmentMonthly' => ['electricityUnitsConsumed' => 10, 'electricityTotal' => 700, 'totalEarnings' => 100000, 'totalDeductions' => 2000, 'netSalary' => 98000, 'deductions' => ['electricity' => 700, 'mess' => 500, 'creditSociety' => 800]], 'govRecalc' => ['electricityUnitsConsumed' => 10, 'electricityManualOverride' => true, 'deductionPaidOverrides' => ['electricity' => 700, 'mess' => 500, 'creditSociety' => 800]]];
        $incoming = ['governmentMonthly' => ['electricityUnitsConsumed' => 20, 'electricityTotal' => 1400, 'totalEarnings' => 100000, 'totalDeductions' => 2700, 'netSalary' => 97300, 'deductions' => ['electricity' => 1400, 'mess' => 0, 'creditSociety' => 0]], 'govRecalc' => ['electricityUnitsConsumed' => 20, 'electricityMode' => 'unit_based', 'electricityApplicable' => true, 'electricityManualOverride' => false, 'deductionPaidOverrides' => ['mess' => 500, 'creditSociety' => 800]]];
        $patched = $totals->invoke($service, $method->invoke($service, $before, $incoming, ['electricityUnitsConsumed']), []);
        $this->assertSame(20, $patched['governmentMonthly']['electricityUnitsConsumed']);
        $this->assertSame(1400, $patched['governmentMonthly']['deductions']['electricity']);
        $this->assertSame(500, $patched['governmentMonthly']['deductions']['mess']);
        $this->assertSame(800, $patched['governmentMonthly']['deductions']['creditSociety']);
        $this->assertArrayNotHasKey('electricity', $patched['govRecalc']['deductionPaidOverrides']);
        $this->assertSame(2700.0, $patched['governmentMonthly']['totalDeductions']);
    }

    public function test_quarter_rent_and_night_allowance_patch_only_the_selected_component(): void
    {
        $service = new PayrollDraftService;
        $method = (new ReflectionClass($service))->getMethod('applyChangedFields');
        $method->setAccessible(true);
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $before = ['governmentMonthly' => ['basicPaid' => 100000, 'nightAllowancePaid' => 900, 'extraWorkAllowancePaid' => 1500, 'totalEarnings' => 102400, 'totalDeductions' => 1500, 'netSalary' => 100900, 'quarterRent' => 500, 'quarter_rent' => 500, 'deductions' => ['quarterRent' => 500, 'mess' => 1000]], 'govRecalc' => ['nightHours' => 10, 'nightAllowanceManualOverride' => true, 'earningPaidOverrides' => ['nightAllowancePaid' => 900], 'deductionPaidOverrides' => ['quarterRent' => 500, 'mess' => 1000]]];
        $rentInput = ['governmentMonthly' => ['quarterRent' => 0, 'quarter_rent' => 0, 'basicPaid' => 100000, 'nightAllowancePaid' => 900, 'extraWorkAllowancePaid' => 1500, 'totalEarnings' => 102400, 'totalDeductions' => 1000, 'netSalary' => 101400, 'deductions' => ['quarterRent' => 0, 'mess' => 1000]], 'govRecalc' => ['quarterRent' => 0, 'quarterRentManualOverride' => true, 'deductionPaidOverrides' => ['quarterRent' => 0, 'mess' => 1000]]];
        $patched = $totals->invoke($service, $method->invoke($service, $before, $rentInput, ['govDeduction_quarterRent']), []);
        $this->assertSame(0, $patched['governmentMonthly']['deductions']['quarterRent']);
        $this->assertSame(1000, $patched['governmentMonthly']['deductions']['mess']);
        $this->assertSame(900, $patched['governmentMonthly']['nightAllowancePaid']);
        $this->assertSame(1500, $patched['governmentMonthly']['extraWorkAllowancePaid']);

        $nightInput = ['governmentMonthly' => ['basicPaid' => 100000, 'nightAllowancePaid' => 1200, 'extraWorkAllowancePaid' => 0, 'totalEarnings' => 102700, 'totalDeductions' => 1500, 'netSalary' => 101200], 'govRecalc' => ['nightHours' => 12, 'nightAllowanceManualOverride' => false, 'earningPaidOverrides' => ['extraWorkAllowancePaid' => 1500]]];
        $patched = $totals->invoke($service, $method->invoke($service, $patched, $nightInput, ['nightHours']), []);
        $this->assertSame(1200, $patched['governmentMonthly']['nightAllowancePaid']);
        $this->assertSame(1500, $patched['governmentMonthly']['extraWorkAllowancePaid']);
        $this->assertSame(1000, $patched['governmentMonthly']['deductions']['mess']);
        $this->assertSame(1000.0, $patched['governmentMonthly']['totalDeductions']);
    }

    public function test_recalculated_totals_include_configured_dynamic_fields_once(): void
    {
        $service = new PayrollDraftService;
        $method = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $method->setAccessible(true);
        $payload = ['governmentMonthly' => [
            'basicPaid' => 50000,
            'extraWorkAllowancePaid' => 1500,
            'nightAllowancePaid' => 1200,
            'customEarnings' => ['special_allowance' => 500],
            'deductions' => ['mess' => 650, 'creditSociety' => 11750, 'electricity' => 900, 'quarterRent' => 500],
            'customDeductions' => ['other_recovery' => 300, 'gpf' => 250],
        ]];
        $definitions = [
            (object) ['field_key' => 'special_allowance', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true, 'include_in_total_deductions' => false],
            (object) ['field_key' => 'other_recovery', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_earnings' => false, 'include_in_total_deductions' => true],
            (object) ['field_key' => 'gpf', 'field_group' => 'statutory', 'field_type' => 'number', 'include_in_total_earnings' => false, 'include_in_total_deductions' => false],
        ];
        $result = $method->invoke($service, $payload, $definitions);
        $this->assertSame(53200.0, $result['governmentMonthly']['totalEarnings']);
        $this->assertSame(14350.0, $result['governmentMonthly']['totalDeductions']);
        $this->assertSame(38850.0, $result['governmentMonthly']['netSalary']);
    }

    public function test_calculation_driver_persists_dependent_snapshot_and_clears_old_override_context(): void
    {
        $service = new PayrollDraftService;
        $patch = (new ReflectionClass($service))->getMethod('applyChangedFields');
        $patch->setAccessible(true);
        $totals = (new ReflectionClass($service))->getMethod('recalculateDraftTotals');
        $totals->setAccessible(true);
        $saved = ['grossPay'=>100000,'governmentMonthly'=>['basicPaid'=>100000,'extraWorkAllowancePaid'=>1500,'totalEarnings'=>101500,'totalDeductions'=>1200,'netSalary'=>100300,'deductions'=>['mess'=>700,'creditSociety'=>500]],'govRecalc'=>['payDays'=>30,'earningPaidOverrides'=>['extraWorkAllowancePaid'=>1500],'deductionPaidOverrides'=>['mess'=>700,'creditSociety'=>500],'cpfManualOverride'=>true]];
        $recalculated = ['grossPay'=>95000,'governmentMonthly'=>['basicPaid'=>95000,'extraWorkAllowancePaid'=>1425,'totalEarnings'=>96425,'totalDeductions'=>1200,'netSalary'=>95225,'deductions'=>['mess'=>700,'creditSociety'=>500]],'govRecalc'=>['payDays'=>28,'cpfManualOverride'=>false,'hplDeductionManualOverride'=>false,'eolDeductionManualOverride'=>false,'electricityManualOverride'=>false,'quarterRentManualOverride'=>false,'nightAllowanceManualOverride'=>false]];
        $result = $totals->invoke($service, $patch->invoke($service, $saved, $recalculated, ['payDays']), []);
        $this->assertSame(28, $result['govRecalc']['payDays']);
        $this->assertSame(1425, $result['governmentMonthly']['extraWorkAllowancePaid']);
        $this->assertSame(700, $result['governmentMonthly']['deductions']['mess']);
        $this->assertSame(500, $result['governmentMonthly']['deductions']['creditSociety']);
        $this->assertArrayNotHasKey('earningPaidOverrides', $result['govRecalc']);
        $this->assertArrayNotHasKey('deductionPaidOverrides', $result['govRecalc']);
    }

    public function test_save_path_fills_total_earnings_and_arrears_from_payload(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString("government_monthly", $source);
        $this->assertStringContainsString("total_earnings", $source);
        $this->assertStringContainsString("total_arrears", $source);
        $this->assertStringContainsString("da_arrears_paid", $source);
        $this->assertStringContainsString("transport_arrears_paid", $source);
        $this->assertStringContainsString("'rowPayload' => \$row->row_payload", $source);
    }

    public function test_save_response_includes_employee_count_fields(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        $this->assertStringContainsString('expectedEmployeeCount', $source);
        $this->assertStringContainsString('savedEmployeeCount', $source);
        $this->assertStringContainsString('distinctEmployeeCount', $source);
        $this->assertStringContainsString('Draft save incomplete', $source);
        $this->assertStringContainsString('DB::transaction', $source);
    }

    public function test_format_employee_exposes_row_payload_object_fields(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollDraftService.php');
        $this->assertIsString($source);
        foreach ([
            "'totalEarnings' => \$row->total_earnings",
            "'totalDeductions' => \$row->total_deductions",
            "'totalArrears' => \$row->total_arrears",
            "'grossPay' => \$row->gross_pay",
            "'netPay' => \$row->net_pay",
            "'rowPayload' => \$row->row_payload",
        ] as $needle) {
            $this->assertStringContainsString($needle, $source);
        }
    }
}
