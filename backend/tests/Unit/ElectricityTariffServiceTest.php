<?php

namespace Tests\Unit;

use App\Services\ElectricityTariffService;
use PHPUnit\Framework\TestCase;

/**
 * Progressive electricity tariff calculation (mirrors src/lib/electricityTariffCalculation.ts).
 */
final class ElectricityTariffServiceTest extends TestCase
{
    private ElectricityTariffService $service;

    /** @return array<string, mixed> */
    private function april2026Tariff(): array
    {
        return [
            'id' => 'tariff-apr-2026',
            'effectiveFrom' => '2026-04-01',
            'sthirAakar' => 130,
            'vahanAakarPerUnit' => 1.6,
            'fuelCharge' => 200.70,
            'dutyPercentage' => 16,
            'slabs' => [
                ['from_unit' => 0, 'to_unit' => 100, 'rate_per_unit' => 3.96, 'sort_order' => 1],
                ['from_unit' => 101, 'to_unit' => 300, 'rate_per_unit' => 10.80, 'sort_order' => 2],
                ['from_unit' => 301, 'to_unit' => 500, 'rate_per_unit' => 15.03, 'sort_order' => 3],
                ['from_unit' => 501, 'to_unit' => 1000, 'rate_per_unit' => 17.53, 'sort_order' => 4],
                ['from_unit' => 1001, 'to_unit' => null, 'rate_per_unit' => 17.53, 'sort_order' => 5],
            ],
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ElectricityTariffService;
    }

    public function test_progressive_slab_boundaries(): void
    {
        $slabs = $this->april2026Tariff()['slabs'];
        $cases = [
            0 => 0.0,
            1 => round(1 * 3.96, 2),
            100 => round(100 * 3.96, 2),
            101 => round(100 * 3.96 + 1 * 10.80, 2),
            300 => round(100 * 3.96 + 200 * 10.80, 2),
            301 => round(100 * 3.96 + 200 * 10.80 + 1 * 15.03, 2),
            500 => round(100 * 3.96 + 200 * 10.80 + 200 * 15.03, 2),
            501 => round(100 * 3.96 + 200 * 10.80 + 200 * 15.03 + 1 * 17.53, 2),
            1000 => round(100 * 3.96 + 200 * 10.80 + 200 * 15.03 + 500 * 17.53, 2),
            1001 => round(100 * 3.96 + 200 * 10.80 + 200 * 15.03 + 500 * 17.53 + 1 * 17.53, 2),
            1500 => round(100 * 3.96 + 200 * 10.80 + 200 * 15.03 + 500 * 17.53 + 500 * 17.53, 2),
        ];

        foreach ($cases as $units => $expected) {
            $result = $this->service->calculateSlabCharge((float) $units, $slabs);
            $this->assertEqualsWithDelta($expected, $result['charge'], 0.001, "units={$units}");
        }
    }

    public function test_350_unit_full_bill(): void
    {
        $bill = $this->service->calculateBill(350, $this->april2026Tariff(), true, 'unit_based');
        $this->assertEqualsWithDelta(130.0, $bill['sthirAakar'], 0.001);
        $this->assertEqualsWithDelta(3307.5, $bill['consumptionCharge'], 0.001);
        $this->assertEqualsWithDelta(560.0, $bill['vahanAakar'], 0.001);
        $this->assertEqualsWithDelta(200.7, $bill['fuelCharge'], 0.001);
        $this->assertEqualsWithDelta(4198.2, $bill['subtotal'], 0.001);
        $this->assertEqualsWithDelta(671.71, $bill['dutyAmount'], 0.001);
        $this->assertEqualsWithDelta(4869.91, $bill['totalExact'], 0.001);
        $this->assertSame(4870, (int) $bill['total']);
    }

    public function test_zero_units_still_applies_fixed_charges(): void
    {
        $bill = $this->service->calculateBill(0, $this->april2026Tariff(), true, 'unit_based');
        $this->assertEqualsWithDelta(130.0, $bill['sthirAakar'], 0.001);
        $this->assertSame(0.0, (float) $bill['consumptionCharge']);
        $this->assertSame(0.0, (float) $bill['vahanAakar']);
        $this->assertEqualsWithDelta(200.7, $bill['fuelCharge'], 0.001);
        $this->assertGreaterThan(0, $bill['total']);
    }

    public function test_not_applicable_is_zero(): void
    {
        $bill = $this->service->calculateBill(350, $this->april2026Tariff(), false, 'unit_based');
        $this->assertSame(0, (int) $bill['total']);
    }

    public function test_manual_override_and_fixed_mode(): void
    {
        $override = $this->service->calculateBill(350, $this->april2026Tariff(), true, 'unit_based', 0, 0, true, 500);
        $this->assertSame(500, (int) $override['total']);

        $zero = $this->service->calculateBill(350, $this->april2026Tariff(), true, 'unit_based', 0, 0, true, 0);
        $this->assertSame(0, (int) $zero['total']);

        $fixed = $this->service->calculateBill(0, $this->april2026Tariff(), true, 'manual_fixed', 0, 250);
        $this->assertSame(250, (int) $fixed['total']);
    }

    public function test_config_changes_alter_bill(): void
    {
        $base = $this->april2026Tariff();
        $changed = $base;
        $changed['sthirAakar'] = 200;
        $changed['vahanAakarPerUnit'] = 2;
        $changed['fuelCharge'] = 100;
        $changed['dutyPercentage'] = 10;
        $changed['slabs'][0]['rate_per_unit'] = 5;

        $a = $this->service->calculateBill(50, $base, true, 'unit_based');
        $b = $this->service->calculateBill(50, $changed, true, 'unit_based');
        $this->assertNotSame((int) $a['total'], (int) $b['total']);
        $this->assertEqualsWithDelta(200.0, $b['sthirAakar'], 0.001);
        $this->assertEqualsWithDelta(100.0, $b['vahanAakar'], 0.001);
        $this->assertEqualsWithDelta(100.0, $b['fuelCharge'], 0.001);
        $this->assertEqualsWithDelta(10.0, $b['dutyPercentage'], 0.001);
    }

    public function test_slab_validation_rejects_overlap_and_gap(): void
    {
        $overlap = $this->service->validateSlabs([
            ['from_unit' => 0, 'to_unit' => 100, 'rate_per_unit' => 1],
            ['from_unit' => 90, 'to_unit' => 300, 'rate_per_unit' => 2],
        ]);
        $this->assertNotEmpty(array_filter($overlap, fn ($e) => str_contains($e, 'overlap')));

        $gap = $this->service->validateSlabs([
            ['from_unit' => 0, 'to_unit' => 100, 'rate_per_unit' => 1],
            ['from_unit' => 201, 'to_unit' => 300, 'rate_per_unit' => 2],
        ]);
        $this->assertNotEmpty(array_filter($gap, fn ($e) => str_contains($e, 'Gap')));

        $ok = $this->service->validateSlabs($this->april2026Tariff()['slabs']);
        $this->assertSame([], $ok);
    }
}
