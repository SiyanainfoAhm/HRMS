<?php

namespace Tests\Unit;

use App\Models\HrmsElectricityTariff;
use App\Services\ElectricityTariffService;
use App\Services\PayrollDraftService;
use PHPUnit\Framework\TestCase;

/**
 * Mirrors src/lib/electricityUnitsRegression.test.ts: a Payroll Master that is
 * manual_fixed with a flat default (49) must not override recorded units.
 */
final class ElectricityUnitsRegressionTest extends TestCase
{
    private const MASTER_FIXED = 49.0;

    private function tariff(): array
    {
        return [
            'id' => 'april-2026', 'effectiveFrom' => '2026-04-01', 'sthirAakar' => 130,
            'vahanAakarPerUnit' => 1.6, 'fuelCharge' => 0, 'dutyPercentage' => 16,
            'slabs' => [
                ['fromUnit' => 0, 'toUnit' => 100, 'ratePerUnit' => 3.96, 'fuelChargePerUnit' => 0.35, 'sortOrder' => 1],
                ['fromUnit' => 101, 'toUnit' => 300, 'ratePerUnit' => 10.8, 'fuelChargePerUnit' => 0.65, 'sortOrder' => 2],
                ['fromUnit' => 301, 'toUnit' => 500, 'ratePerUnit' => 15.03, 'fuelChargePerUnit' => 0.85, 'sortOrder' => 3],
            ],
        ];
    }

    private function expected(float $units): float
    {
        $slab = static fn (int $from, int $to, float $rate, float $fuel): float => max(0, min($units, $to) - $from + 1) * ($rate + $fuel);
        $energy = $slab(1, 100, 3.96, 0.35) + $slab(101, 300, 10.8, 0.65) + $slab(301, 500, 15.03, 0.85);

        return round((130 + $energy + $units * 1.6) * 1.16);
    }

    public function test_units_are_billed_from_tariff_whatever_mode_master_seeded(): void
    {
        $svc = new ElectricityTariffService;
        foreach ([10, 11, 40, 80, 301] as $units) {
            $fixedMode = $svc->calculateBill((float) $units, $this->tariff(), true, 'manual_fixed', 0, self::MASTER_FIXED);
            $unitMode = $svc->calculateBill((float) $units, $this->tariff(), true, 'unit_based', 0, self::MASTER_FIXED);
            $this->assertSame((float) $unitMode['total'], (float) $fixedMode['total'], "units {$units}");
            $this->assertSame('unit_based', $fixedMode['mode']);
            $this->assertEqualsWithDelta($this->expected($units), (float) $fixedMode['total'], 1.0, "units {$units}");
            $this->assertNotEquals(self::MASTER_FIXED, (float) $fixedMode['total'], "units {$units} must not be the master default");
        }
    }

    public function test_zero_units_keep_master_flat_charge_and_manual_amount_is_exact(): void
    {
        $svc = new ElectricityTariffService;
        $zero = $svc->calculateBill(0.0, $this->tariff(), true, 'manual_fixed', 0, self::MASTER_FIXED);
        $this->assertSame(49.0, (float) $zero['total']);
        $manual = $svc->calculateBill(80.0, $this->tariff(), true, 'manual_fixed', 0, self::MASTER_FIXED, true, 0.0);
        $this->assertSame(0.0, (float) $manual['total'], 'typed 0 is honoured');
        $off = $svc->calculateBill(80.0, $this->tariff(), false, 'manual_fixed', 0, self::MASTER_FIXED);
        $this->assertSame(0.0, (float) $off['total']);
        $this->assertSame(0.0, (float) $svc->calculateBill(-5.0, $this->tariff(), true, 'unit_based')['units']);
    }

    public function test_draft_saved_with_master_mode_and_stale_49_is_repaired_on_reconcile(): void
    {
        $tariff = $this->tariff();
        $tariffs = $this->createMock(ElectricityTariffService::class);
        $real = new ElectricityTariffService;
        $tariffs->method('resolveForDate')->willReturn($this->createMock(HrmsElectricityTariff::class));
        $tariffs->method('formatTariff')->willReturn($tariff);
        $tariffs->method('calculateBill')->willReturnCallback(
            fn (float $u, ?array $t, bool $a, string $m, float $l, float $f, bool $o, ?float $ma) => $real->calculateBill($u, $t, $a, $m, $l, $f, $o, $ma),
        );
        $service = new PayrollDraftService(null, null, $tariffs);

        $payload = [
            'grossPay' => 50000,
            'governmentMonthly' => [
                'basicPaid' => 50000, 'electricityUnitsConsumed' => 80, 'electricityMode' => 'manual_fixed',
                'totalEarnings' => 50000,
                'deductions' => ['electricity' => 49, 'water' => 314, 'mess' => 25],
            ],
            'govRecalc' => [
                'electricityUnitsConsumed' => 80, 'electricityMode' => 'manual_fixed', 'electricityApplicable' => true,
                'electricityManualOverride' => false, 'deductionDefaults' => ['electricity' => 49],
            ],
        ];
        // Saved by an unrelated edit (water) so units were not flagged as edited.
        $out = $service->reconcileDraftElectricity($payload, 'company', 2026, 9, ['govDeduction_water']);
        $this->assertEqualsWithDelta($this->expected(80), (float) $out['governmentMonthly']['deductions']['electricity'], 1.0);
        $this->assertSame(314, $out['governmentMonthly']['deductions']['water']);
        $this->assertSame(25, $out['governmentMonthly']['deductions']['mess']);
        $this->assertSame('unit_based', $out['govRecalc']['electricityMode']);
        $this->assertEqualsWithDelta(
            50000 - (float) $out['governmentMonthly']['totalDeductions'],
            (float) $out['governmentMonthly']['netSalary'],
            0.01,
        );

        // Zero units + Master manual_fixed: the flat amount is preserved.
        $flat = $payload;
        $flat['governmentMonthly']['electricityUnitsConsumed'] = 0;
        $flat['govRecalc']['electricityUnitsConsumed'] = 0;
        $keep = $service->reconcileDraftElectricity($flat, 'company', 2026, 9, ['govDeduction_water']);
        $this->assertSame(49, $keep['governmentMonthly']['deductions']['electricity']);
    }
}
