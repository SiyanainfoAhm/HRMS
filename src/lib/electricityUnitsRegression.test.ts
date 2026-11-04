/**
 * Run: npx --yes tsx src/lib/electricityUnitsRegression.test.ts
 *
 * Regression: an employee whose Payroll Master is `manual_fixed` with a flat
 * Electricity default (e.g. 49) must be billed from the tariff as soon as units
 * are recorded, and must stay that way when any other field on the row changes.
 */
import {
  calculateElectricityBill,
  DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
} from "./electricityTariffCalculation";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { applyGovernmentSheetMonetaryEdit, type GovernmentSheetRow } from "./runPayrollSheetEdit";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const tariff = DEFAULT_APRIL_2026_ELECTRICITY_TARIFF;
const MASTER_FIXED = 49;

/** Hand-computed from the April 2026 tariff: 1.16 * (130 + slabs + 1.6u + fuel), to the whole rupee. */
function expectedBill(units: number): number {
  const slab = (from: number, to: number, rate: number, fuel: number) => {
    const n = Math.max(0, Math.min(units, to) - from + 1);
    return n * (rate + fuel);
  };
  const energy =
    slab(1, 100, 3.96, 0.35) + slab(101, 300, 10.8, 0.65) + slab(301, 500, 15.03, 0.85);
  return Math.round((130 + energy + units * 1.6) * 1.16);
}

for (const units of [10, 11, 40, 80, 301]) {
  const fixedMode = calculateElectricityBill({ units, tariff, mode: "manual_fixed", fixedAmount: MASTER_FIXED });
  const unitMode = calculateElectricityBill({ units, tariff, mode: "unit_based", fixedAmount: MASTER_FIXED });
  assertEq(fixedMode.total, unitMode.total, `units ${units}: stored mode must not change the bill`);
  assertEq(fixedMode.mode, "unit_based", `units ${units}: effective mode`);
  assertEq(fixedMode.total === expectedBill(units), true, `units ${units}: ${fixedMode.total} vs ${expectedBill(units)}`);
  assertEq(fixedMode.total === MASTER_FIXED, false, `units ${units}: must not equal master default`);
}

// Zero units keep the Master flat charge (nothing consumed to bill).
assertEq(
  calculateElectricityBill({ units: 0, tariff, mode: "manual_fixed", fixedAmount: MASTER_FIXED }).total,
  MASTER_FIXED,
  "units 0 manual_fixed keeps the master flat charge",
);

// A typed amount stays exactly as entered, even with units and a tariff.
assertEq(
  calculateElectricityBill({
    units: 80, tariff, mode: "manual_fixed", fixedAmount: MASTER_FIXED, manualOverride: true, manualAmount: 0,
  }).total,
  0,
  "manual override of 0 is honoured",
);

// Not applicable -> nothing.
assertEq(
  calculateElectricityBill({ units: 80, tariff, applicable: false, mode: "manual_fixed", fixedAmount: 49 }).total,
  0,
  "not applicable",
);

// Boundary / garbage input.
assertEq(calculateElectricityBill({ units: -5, tariff, mode: "unit_based" }).units, 0, "negative units clamp to 0");
assertEq(Number.isFinite(calculateElectricityBill({ units: 1e9, tariff, mode: "unit_based" }).total), true, "very large units finite");

// ---- Whole-row scenario: the screen's engine, master seeded as manual_fixed/49 ----
const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: MASTER_FIXED, water: 314, mess: 25, loanRecovery: 0, welfare: 0, hpl: 0,
  eol: 0, vehCharge: 0, other: 0, quarterRent: 0,
};
const gr: GovRecalcPayload = {
  grossBasic: 34590, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 10,
  electricityUnitsConsumed: 80,
  electricityMode: "manual_fixed", // what Payroll Master seeds
  electricityApplicable: true,
  electricityTariff: tariff,
  deductionDefaults: { ...ded },
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
};
const compute = (g: GovRecalcPayload) =>
  runGovernmentPayrollCompute(g, { daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null }).comp;

const first = compute(gr);
assertEq(first.deductions.electricity, expectedBill(80), "row with units 80 and master 49");
assertEq(first.deductions.electricity === 49, false, "never the master default when units are present");

// Re-running the compute for any unrelated input change keeps the units bill.
for (const patch of [{ hplDays: 0 }, { nightHours: 3 }, { daPercent: 55 }] as Array<Partial<GovRecalcPayload>>) {
  assertEq(compute({ ...gr, ...patch }).deductions.electricity, expectedBill(80), `unrelated change ${JSON.stringify(patch)}`);
}

// Editing Water on the sheet patches Water + totals only; Electricity is untouched.
const row: GovernmentSheetRow = {
  employeeUserId: "e1", payDays: 30, grossPay: first.totalEarnings, deductions: first.totalDeductions,
  netPay: first.netSalary, takeHome: first.netSalary, governmentMonthly: first, govRecalc: gr,
};
const edited = applyGovernmentSheetMonetaryEdit(row, "govDeduction_water", 400) as GovernmentSheetRow;
const ged = (edited.governmentMonthly as { deductions: Record<string, number> }).deductions;
assertEq(ged.water, 400, "water edit applied");
assertEq(ged.electricity, expectedBill(80), "electricity unchanged by water edit");
assertEq(Math.abs(edited.grossPay - edited.deductions - edited.netPay) < 0.01, true, "gross - deductions = net after edit");

console.log("electricity units regression: ok");
