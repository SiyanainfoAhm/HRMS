/**
 * Run: npx --yes tsx src/lib/electricityTariffCalculation.test.ts
 */
import {
  DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
  calculateElectricityBill,
  calculateElectricitySlabCharge,
  roundMoney2,
  validateElectricitySlabs,
} from "./electricityTariffCalculation";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertClose(a: number, b: number, msg: string, eps = 0.001) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: expected ~${b}, got ${a}`);
}

const tariff = DEFAULT_APRIL_2026_ELECTRICITY_TARIFF;
const slabs = tariff.slabs;

// --- Boundary progressive slab tests ---
const boundaries: Array<[number, number]> = [
  [0, 0],
  [1, roundMoney2(1 * 3.96)],
  [100, roundMoney2(100 * 3.96)],
  [101, roundMoney2(100 * 3.96 + 1 * 10.8)],
  [300, roundMoney2(100 * 3.96 + 200 * 10.8)],
  [301, roundMoney2(100 * 3.96 + 200 * 10.8 + 1 * 15.03)],
  [500, roundMoney2(100 * 3.96 + 200 * 10.8 + 200 * 15.03)],
  [501, roundMoney2(100 * 3.96 + 200 * 10.8 + 200 * 15.03 + 1 * 17.53)],
  [1000, roundMoney2(100 * 3.96 + 200 * 10.8 + 200 * 15.03 + 500 * 17.53)],
  [1001, roundMoney2(100 * 3.96 + 200 * 10.8 + 200 * 15.03 + 500 * 17.53 + 1 * 17.53)],
  [1500, roundMoney2(100 * 3.96 + 200 * 10.8 + 200 * 15.03 + 500 * 17.53 + 500 * 17.53)],
];

for (const [units, expected] of boundaries) {
  const { charge } = calculateElectricitySlabCharge(units, slabs);
  assertClose(charge, expected, `slab charge at ${units} units`);
}

// 350-unit exact bill
{
  const expectedSlab =
    roundMoney2(100 * 3.96) + roundMoney2(200 * 10.8) + roundMoney2(50 * 15.03);
  assertClose(expectedSlab, 3307.5, "350 slab expected");
  const { charge, portions } = calculateElectricitySlabCharge(350, slabs);
  assertClose(charge, 3307.5, "350 progressive slab");
  assertEq(portions.length, 3, "three portions for 350");
  assertEq(portions[0].units, 100, "first 100");
  assertEq(portions[1].units, 200, "next 200");
  assertEq(portions[2].units, 50, "remaining 50");

  const bill = calculateElectricityBill({ units: 350, tariff, applicable: true });
  assertClose(bill.sthirAakar, 130, "sthir");
  assertClose(bill.consumptionCharge, 3307.5, "consumption");
  assertClose(bill.vahanAakar, 560, "vahan 350*1.6");
  assertClose(bill.fuelCharge, 200.7, "fuel");
  assertClose(bill.subtotal, 4198.2, "subtotal");
  assertClose(bill.dutyAmount, 671.71, "duty 16%");
  assertClose(bill.totalExact, 4869.91, "exact total");
  assertEq(bill.total, 4870, "whole-rupee deduction");
}

// Zero units still applies fixed charges when applicable
{
  const bill = calculateElectricityBill({ units: 0, tariff, applicable: true });
  assertClose(bill.sthirAakar, 130, "0u sthir");
  assertClose(bill.fuelCharge, 200.7, "0u fuel");
  assertEq(bill.consumptionCharge, 0, "0u consumption");
  assertEq(bill.vahanAakar, 0, "0u vahan");
  assertClose(bill.subtotal, 330.7, "0u subtotal");
  assertClose(bill.dutyAmount, 52.91, "0u duty");
  assertEq(bill.total, Math.round(bill.totalExact), "0u rounded");
  assert(bill.total > 0, "0 units is not zero bill when applicable");
}

// Not applicable → 0
{
  const bill = calculateElectricityBill({ units: 350, tariff, applicable: false });
  assertEq(bill.total, 0, "not applicable");
}

// Manual override
{
  const bill = calculateElectricityBill({
    units: 350,
    tariff,
    manualOverride: true,
    manualAmount: 0,
  });
  assertEq(bill.total, 0, "explicit 0 override");
  const bill2 = calculateElectricityBill({
    units: 350,
    tariff,
    manualOverride: true,
    manualAmount: 500,
  });
  assertEq(bill2.total, 500, "manual 500");
}

// Manual fixed mode
{
  const bill = calculateElectricityBill({
    units: 0,
    tariff,
    mode: "manual_fixed",
    fixedAmount: 250,
  });
  assertEq(bill.total, 250, "manual fixed");
}

// Config changes affect calculation
{
  const changed = {
    ...tariff,
    sthirAakar: 200,
    vahanAakarPerUnit: 2,
    fuelCharge: 100,
    dutyPercentage: 10,
    slabs: tariff.slabs.map((s) =>
      s.fromUnit === 0 ? { ...s, ratePerUnit: 5 } : s,
    ),
  };
  const a = calculateElectricityBill({ units: 50, tariff });
  const b = calculateElectricityBill({ units: 50, tariff: changed });
  assert(b.total !== a.total, "tariff change alters total");
  assertClose(b.sthirAakar, 200, "changed sthir");
  assertClose(b.vahanAakar, 100, "changed vahan");
  assertClose(b.fuelCharge, 100, "changed fuel");
  assertEq(b.dutyPercentage, 10, "changed duty %");
}

// Validation
{
  assertEq(validateElectricitySlabs(slabs).length, 0, "default slabs valid");
  const overlap = validateElectricitySlabs([
    { fromUnit: 0, toUnit: 100, ratePerUnit: 1 },
    { fromUnit: 90, toUnit: 300, ratePerUnit: 2 },
  ]);
  assert(overlap.some((e) => e.includes("overlap")), "overlap rejected");
  const gap = validateElectricitySlabs([
    { fromUnit: 0, toUnit: 100, ratePerUnit: 1 },
    { fromUnit: 201, toUnit: 300, ratePerUnit: 2 },
  ]);
  assert(gap.some((e) => e.includes("Gap")), "gap rejected");
}

console.log("electricityTariffCalculation.test.ts: all assertions passed");
