/**
 * Run: npx --yes tsx src/lib/nightAllowanceHourly.test.ts
 *
 * NDA = hours x (perDuty / 8), rounded once. All 14 slabs x hours 0 / 8 / 120 / 8.5 against the
 * shared fixture (backend/tests/fixtures/night_allowance_cases.json, also read by the PHP test),
 * ceiling, Level 1 x 120h = 2784, label, open-draft normalisation, draft save/reload.
 */
import { readFileSync } from "node:fs";
import {
  calculateNightAllowanceAmount,
  nightAllowanceRateLabel,
  hourlyRateToPerDuty,
  nightHourlyRateForDisplay,
  nightRateAsHourly,
  perDutyToHourlyText,
  resolveNightAllowanceAmount,
} from "./nightAllowanceCalculation";
import { ensureOpenRowNightAllowanceDuty, type RunPayrollRowLike } from "./resolveRunPayrollRow";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { deserializePayrollDraftEmployee } from "./deserializePayrollDraftEmployee";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const fixture = JSON.parse(
  readFileSync(new URL("../../backend/tests/fixtures/night_allowance_cases.json", import.meta.url), "utf8"),
) as { anchors: { level1_120h: number }; cases: Array<{ slab: number; level: number; perDuty: number; hours: number; expected: number }> };

// 14 slabs x 4 hour values.
assertEq(fixture.cases.length, 56, "14 slabs x 4 hour values");
for (const c of fixture.cases) {
  assertEq(
    calculateNightAllowanceAmount(c.hours, c.perDuty, "duty"),
    c.expected,
    `slab ${c.slab} level ${c.level} ${c.hours}h at ${c.perDuty}/duty`,
  );
}
assertEq(calculateNightAllowanceAmount(120, 185.6, "duty"), 2784, "Level 1, 120h = 2784.00");
assertEq(fixture.anchors.level1_120h, 2784, "fixture anchor");
assertEq(nightHourlyRateForDisplay(185.6), 23.2, "Level 1 hourly = 23.20");
assertEq(nightAllowanceRateLabel(185.6, "duty"), "₹23.20/hr", "label shows the hourly rate only");
assertEq(nightAllowanceRateLabel(28.85, undefined), "₹28.85/hr", "legacy hourly row keeps its hourly label");

// Ceiling: payable only when Basic Pay <= ceiling.
const base = { hours: 120, rate: 185.6, rateBasis: "duty" as const, ceiling: 43600 };
assertEq(resolveNightAllowanceAmount({ ...base, basicPay: 43600 }).amount, 2784, "at the ceiling is payable");
assertEq(resolveNightAllowanceAmount({ ...base, basicPay: 43601 }).amount, 0, "above the ceiling is not payable");

// Open draft saved before the per-duty rate (basis missing, hourly rate 28.85): moved to duty, rate re-resolved.
const gm = { nightHours: 15, nightAllowanceRate: 28.85, nightAllowancePaid: 433, totalEarnings: 50000, netSalary: 40000 };
const stale = {
  employeeUserId: "u", payrollMode: "government", grossPay: 50000, netPay: 40000, takeHome: 40000,
  govRecalc: { nightHours: 15, nightAllowanceRate: 28.85 }, governmentMonthly: gm,
} as unknown as RunPayrollRowLike;
const fresh = {
  employeeUserId: "u",
  govRecalc: { nightAllowanceRate: 230.8, nightAllowanceRateBasis: "duty", nightAllowanceSlabNo: 3 },
} as unknown as RunPayrollRowLike;
const fixed = ensureOpenRowNightAllowanceDuty(stale, fresh);
assertEq(fixed.govRecalc?.nightAllowanceRateBasis, "duty", "basis forced to duty");
assertEq(fixed.govRecalc?.nightAllowanceRate, 230.8, "rate re-resolved from the slab");
assertEq(fixed.govRecalc?.nightHours, 15, "typed hours kept");
assertEq((fixed.governmentMonthly as Record<string, number>).nightAllowancePaid, 433, "15h x 230.80 / 8 = 432.75 -> 433, same as before");
assertEq(fixed.grossPay, 50000, "gross unchanged");
assertEq(ensureOpenRowNightAllowanceDuty(fixed, fresh), fixed, "idempotent");
const noSlab = ensureOpenRowNightAllowanceDuty(stale, {
  govRecalc: { nightAllowanceRate: 0, nightAllowanceRateBasis: "duty" },
} as unknown as RunPayrollRowLike);
assertEq(noSlab, stale, "no slab: stored values kept");
const typed = {
  ...stale,
  govRecalc: { ...stale.govRecalc, nightAllowanceManualOverride: true },
  governmentMonthly: { ...gm, nightAllowancePaid: 999 },
} as unknown as RunPayrollRowLike;
assertEq(
  (ensureOpenRowNightAllowanceDuty(typed, fresh).governmentMonthly as Record<string, number>).nightAllowancePaid,
  999,
  "typed amount kept",
);
// A wrong stored amount (hours x per-duty) is corrected; gross and net move by the same delta.
const wrong = { ...stale, governmentMonthly: { ...gm, nightAllowancePaid: 15 * 230.8, totalEarnings: 53462, netSalary: 43462 } } as unknown as RunPayrollRowLike;
const corrected = ensureOpenRowNightAllowanceDuty(wrong, fresh);
const cgm = corrected.governmentMonthly as Record<string, number>;
assertEq(cgm.nightAllowancePaid, 433, "wrong amount corrected");
assertEq(cgm.totalEarnings - cgm.netSalary, 10000, "gross - net unchanged by the correction");

// Compute: Level 1, 120 hours.
const ded = {
  incomeTax: 0, pt: 0, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr = (extra: Partial<GovRecalcPayload>): GovRecalcPayload => ({
  grossBasic: 18000, daPercent: 50, hraPercent: 30, medicalFixed: 0, payLevel: 1, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
  ...extra,
});
const run = (g: GovRecalcPayload) =>
  runGovernmentPayrollCompute(g, { daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null })
    .comp as unknown as Record<string, number>;
const none = run(gr({}));
const l1 = run(gr({ nightHours: 120, nightAllowanceRate: 185.6, nightAllowanceRateBasis: "duty" }));
assertEq(l1.nightAllowancePaid, 2784, "compute: Level 1, 120h = 2784");
assertEq(l1.totalEarnings - none.totalEarnings, 2784, "gross rises by exactly the allowance");
assertEq(l1.netSalary - none.netSalary, 2784, "net rises by exactly the allowance");
assertEq(l1.totalEarnings - l1.totalDeductions, l1.netSalary, "gross - deductions = net");
assertEq(run(gr({ nightHours: 120, nightAllowanceRate: 185.6 })).nightAllowancePaid, 2784, "no basis now defaults to per duty");

// Draft save/reload keeps the typed hours exactly.
const payload = {
  govRecalc: { nightHours: 8.5, nightAllowanceRate: 185.6, nightAllowanceRateBasis: "duty" },
  governmentMonthly: { nightHours: 8.5, nightAllowanceRate: 185.6, nightAllowanceRateBasis: "duty", nightAllowancePaid: 197 },
};
const reloaded = deserializePayrollDraftEmployee(
  { employeeUserId: "u", rowPayload: JSON.parse(JSON.stringify(payload)) } as never,
  { employeeUserId: "u", payrollMode: "government" } as never,
) as unknown as RunPayrollRowLike;
assertEq(reloaded.govRecalc?.nightHours, 8.5, "reload keeps typed hours");

// Settings shows/edits the HOURLY rate; storage stays per duty (hourly x 8, exact at 2 decimals).
const OFFICIAL_HOURLY = ["23.20", "26.10", "28.85", "32.65", "36.55", "38.05", "39.60", "41.25", "43.50", "46.00", "50.40", "55.45", "58.55", "63.60"];
assertEq(fixture.cases.filter((c) => c.hours === 0).length, 14, "14 stored slabs");
fixture.cases.filter((c) => c.hours === 0).forEach((c, i) => {
  assertEq(perDutyToHourlyText(c.perDuty), OFFICIAL_HOURLY[i], `slab ${c.slab}: stored ${c.perDuty}/duty shows as hourly`);
  const stored = hourlyRateToPerDuty(OFFICIAL_HOURLY[i]);
  assertEq(stored, c.perDuty, `slab ${c.slab}: typing ${OFFICIAL_HOURLY[i]} stores exactly 8x`);
  assertEq(hourlyRateToPerDuty(Number(OFFICIAL_HOURLY[i])), c.perDuty, `slab ${c.slab}: numeric input stores the same`);
  // The payroll amount for the same hours is identical whichever way the rate was entered.
  for (const h of [0, 8, 120, 8.5]) {
    assertEq(calculateNightAllowanceAmount(h, stored as number, "duty"), calculateNightAllowanceAmount(h, c.perDuty, "duty"), `slab ${c.slab} ${h}h unchanged`);
  }
});
// Floating-point traps: 0.1 style values still store exactly hourly x 8.
assertEq(hourlyRateToPerDuty("0.29"), 2.32, "0.29 x 8 = 2.32");
assertEq(hourlyRateToPerDuty("57.35"), 458.8, "57.35 x 8 = 458.80");
assertEq(hourlyRateToPerDuty("1234.56"), 9876.48, "1234.56 x 8");
// Validation: positive, at most 2 decimals.
for (const bad of ["", "0", "0.00", "-1", "23.205", "abc", "1e3", "23,2"]) assertEq(hourlyRateToPerDuty(bad), null, `rejects "${bad}"`);
assertEq(hourlyRateToPerDuty("23"), 184, "whole number accepted");
assertEq(hourlyRateToPerDuty("23.2"), 185.6, "one decimal accepted");
// Run Payroll / export rate: hourly only; legacy hourly rows unchanged.
assertEq(nightRateAsHourly(185.6, "duty"), 23.2, "duty row shows hourly");
assertEq(nightRateAsHourly(28.85, "hour"), 28.85, "legacy hourly row unchanged");
assertEq(nightRateAsHourly(108, undefined), 108, "no basis = already hourly");

console.log("nightAllowanceHourly.test.ts passed");
