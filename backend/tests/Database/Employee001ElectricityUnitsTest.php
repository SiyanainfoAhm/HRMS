<?php

namespace Tests\Database;

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsPayrollMaster;
use App\Services\ElectricityTariffService;
use App\Services\PayrollDraftService;
use Illuminate\Support\Facades\DB;

/**
 * CIRT-01: 80 units entered for employee code 001 must stay 80 and bill from the tariff through
 * save -> reload -> generate; the Master default (49 in the report) may only apply at 0 units.
 */
final class Employee001ElectricityUnitsTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private function payload(float $units, float $masterDefault, string $mode = 'manual_fixed', float $electricity = 49.0): array
    {
        return [
            'grossPay' => 50000,
            'governmentMonthly' => [
                'basicPaid' => 50000, 'totalEarnings' => 50000, 'electricityUnitsConsumed' => $units, 'electricityMode' => $mode,
                'deductions' => ['electricity' => $electricity, 'mess' => 25, 'creditSociety' => 100],
            ],
            'govRecalc' => [
                'electricityUnitsConsumed' => $units, 'electricityMode' => $mode, 'electricityApplicable' => true,
                'electricityManualOverride' => false, 'deductionDefaults' => ['electricity' => $masterDefault],
            ],
        ];
    }

    public function test_eighty_units_survive_every_step_and_bill_from_the_tariff(): void
    {
        $before = $this->finalizedSnapshot();
        $master = HrmsPayrollMaster::query()->where('employee_code', '001')->whereNull('effective_to')->first();
        $master !== null || $this->markTestSkipped('Employee 001 is not in the local database.');
        $companyId = (string) $master->company_id;
        $tariffService = app(ElectricityTariffService::class);
        $tariff = $tariffService->resolveForDate($companyId, '2026-12-31');
        $tariff !== null || $this->markTestSkipped('No electricity tariff locally.');
        $bill80 = $tariffService->calculateBill(80.0, $tariffService->formatTariff($tariff), true, 'unit_based');
        $this->assertGreaterThan(49.0, (float) $bill80['total'], 'the tariff bill for 80 units is not the 49 default');

        $drafts = app(PayrollDraftService::class);

        // 1. Save: the draft still carries Master mode manual_fixed and the stale 49.
        $saved = $drafts->reconcileDraftElectricity($this->payload(80, 49), $companyId, 2026, 12, ['electricityUnitsConsumed'], $master);
        $this->assertEquals(80, $saved['governmentMonthly']['electricityUnitsConsumed']);
        $this->assertEqualsWithDelta((float) $bill80['total'], (float) $saved['governmentMonthly']['deductions']['electricity'], 0.01);

        // 2. Reload (GET) and a second save by an unrelated edit: units and bill are stable.
        for ($i = 0; $i < 2; $i++) {
            $saved = $drafts->reconcileDraftElectricity($saved, $companyId, 2026, 12, ['govDeduction_mess'], $master);
            $this->assertEquals(80, $saved['governmentMonthly']['electricityUnitsConsumed'], "reload {$i}");
            $this->assertEqualsWithDelta((float) $bill80['total'], (float) $saved['governmentMonthly']['deductions']['electricity'], 0.01, "reload {$i}");
        }
        $this->assertEquals(25, $saved['governmentMonthly']['deductions']['mess'], 'other components untouched');
        $this->assertEquals(100, $saved['governmentMonthly']['deductions']['creditSociety']);

        // 3. Generate: the server recomputes from the tariff, never from the browser value or the Master default.
        $controller = app(PayrollController::class);
        $apply = new \ReflectionMethod($controller, 'applyAuthoritativeGovernmentPayrollAmounts');
        $out = $apply->invoke($controller, $saved['governmentMonthly'], $master, $companyId, '2026-12-31', false);
        $this->assertEquals(80, $out['electricityUnitsConsumed']);
        $this->assertEqualsWithDelta((float) $bill80['total'], (float) $out['deductions']['electricity'], 0.01);
        $this->assertSame("unit_based", $out["electricityMode"], "stored mode is the one used to bill (not the Master manual_fixed)");
        $expectedTotal = 50000 - $out['totalDeductions'];
        $this->assertEqualsWithDelta($expectedTotal, (float) $out['netSalary'], 0.01, 'net = gross - deductions with the tariff bill');

        // 4. Reset: back to Master values means units 0 and the Master flat amount, explicitly.
        $reset = $drafts->reconcileDraftElectricity($this->payload(0, 49), $companyId, 2026, 12, ['electricityUnitsConsumed'], $master);
        $this->assertEquals(0, $reset['governmentMonthly']['electricityUnitsConsumed']);

        $this->assertFinalizedUnchanged($before, 'the electricity units chain');
    }
}
