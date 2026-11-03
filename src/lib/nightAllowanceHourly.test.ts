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
  nightHourlyRateForDisplay,
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
assertEq(nightAllowanceRateLabel(185.6, "duty"), "₹23.20/hr (₹185.60/duty)", "label shows hourly with per-duty in brackets");
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

console.log("nightAllowanceHourly.test.ts passed");
