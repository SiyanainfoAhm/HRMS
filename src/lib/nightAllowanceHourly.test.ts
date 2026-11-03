/**
 * Run: npx --yes tsx src/lib/nightAllowanceHourly.test.ts
 *
 * The 7th CPC table (Level 1 = 23.20 ...) is the amount per DUTY of 8 hours: NDA = hours / 8 x rate,
 * rounded once to the rupee. All 14 slabs x hours 0 / 8 / 120 / 8.5 against the shared fixture
 * (backend/tests/fixtures/night_allowance_cases.json, also read by the PHP test), ceiling,
 * Level 1 x 120h = 348, label, open-draft normalisation (basis, never a rate threshold), draft reload.
 */
import { readFileSync } from "node:fs";
import {
  calculateNightAllowanceAmount,
  nightAllowanceRateLabel,
  resolveNightAllowanceAmount,
  resolveNightAllowanceRateByPayLevel,
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

// 14 slabs x 4 hour values; the fixture carries the table values themselves (23.20 ... 63.60).
assertEq(fixture.cases.length, 56, "14 slabs x 4 hour values");
const TABLE = [23.2, 26.1, 28.85, 32.65, 36.55, 38.05, 39.6, 41.25, 43.5, 46, 50.4, 55.45, 58.55, 63.6];
fixture.cases.filter((c) => c.hours === 0).forEach((c, i) => assertEq(c.perDuty, TABLE[i], `slab ${c.slab} is the table value`));
for (const c of fixture.cases) {
  assertEq(
    calculateNightAllowanceAmount(c.hours, c.perDuty, "duty"),
    c.expected,
    `slab ${c.slab} level ${c.level} ${c.hours}h at ${c.perDuty}/duty`,
  );
}
assertEq(calculateNightAllowanceAmount(120, 23.2, "duty"), 348, "Level 1, 120h = 15 duties x 23.20 = 348");
assertEq(fixture.anchors.level1_120h, 348, "fixture anchor");
assertEq(nightAllowanceRateLabel(23.2, "duty"), "₹23.20/duty", "label shows the per-duty rate");
assertEq(nightAllowanceRateLabel(28.85, undefined), "₹28.85/hr", "legacy hour-basis row keeps its label");

// A stored table rate is used exactly (no x8, no /8) when the rate row has no separate per-duty column.
const l1 = resolveNightAllowanceRateByPayLevel(
  [{ slabNo: 1, payLevel: 1, ratePerHour: 23.2, ratePerDuty: 23.2, effectiveFrom: "2026-01-01", isActive: true }], 1, "2026-09-30");
assertEq(l1.rate, 23.2, "slab rate returned as stored");
assertEq(
  resolveNightAllowanceRateByPayLevel([{ slabNo: 1, payLevel: 1, ratePerHour: 23.2, ratePerDuty: null, isActive: true }], 1).rate,
  23.2,
  "legacy column carries the same table amount",
);

// Ceiling: payable only when Basic Pay <= ceiling.
const base = { hours: 120, rate: 23.2, rateBasis: "duty" as const, ceiling: 43600 };
assertEq(resolveNightAllowanceAmount({ ...base, basicPay: 43600 }).amount, 348, "at the ceiling is payable");
assertEq(resolveNightAllowanceAmount({ ...base, basicPay: 43601 }).amount, 0, "above the ceiling is not payable");

// Open draft saved when the table rate was applied per hour (basis missing, 15h x 28.85 = 433):
// moved to duty, rate from the slab, amount recalculated from the typed hours (15 / 8 x 28.85 = 54).
const gm = { nightHours: 15, nightAllowanceRate: 28.85, nightAllowancePaid: 433, totalEarnings: 50000, netSalary: 40000 };
const stale = {
  employeeUserId: "u", payrollMode: "government", grossPay: 50000, netPay: 40000, takeHome: 40000,
  govRecalc: { nightHours: 15, nightAllowanceRate: 28.85 }, governmentMonthly: gm,
} as unknown as RunPayrollRowLike;
const fresh = {
  employeeUserId: "u",
  govRecalc: { nightAllowanceRate: 28.85, nightAllowanceRateBasis: "duty", nightAllowanceSlabNo: 3 },
} as unknown as RunPayrollRowLike;
const fixed = ensureOpenRowNightAllowanceDuty(stale, fresh);
const fgm = fixed.governmentMonthly as Record<string, number>;
assertEq(fixed.govRecalc?.nightAllowanceRateBasis, "duty", "basis forced to duty");
assertEq(fixed.govRecalc?.nightAllowanceRate, 28.85, "rate from the slab");
assertEq(fixed.govRecalc?.nightHours, 15, "typed hours kept");
assertEq(fgm.nightAllowancePaid, 54, "15h / 8 x 28.85 = 54.09 -> 54");
assertEq(fgm.totalEarnings, 50000 - 433 + 54, "gross moves by exactly the NDA change");
assertEq(fgm.netSalary, 40000 - 433 + 54, "net moves by exactly the NDA change");
assertEq(fixed.grossPay, 50000 - 433 + 54, "row gross");
assertEq(ensureOpenRowNightAllowanceDuty(fixed, fresh), fixed, "idempotent");

// A row saved on 'duty' while the slabs were 8x too high (230.80) is corrected; a rate that is not 8x is left alone.
const eight = {
  ...stale,
  govRecalc: { nightHours: 15, nightAllowanceRate: 230.8, nightAllowanceRateBasis: "duty" },
  governmentMonthly: { ...gm, nightAllowanceRate: 230.8, nightAllowanceRateBasis: "duty", nightAllowancePaid: 433 },
} as unknown as RunPayrollRowLike;
const eightFixed = ensureOpenRowNightAllowanceDuty(eight, fresh);
assertEq(eightFixed.govRecalc?.nightAllowanceRate, 28.85, "8x rate corrected");
assertEq((eightFixed.governmentMonthly as Record<string, number>).nightAllowancePaid, 54, "8x amount recalculated");
const custom = { ...eight, govRecalc: { ...eight.govRecalc, nightAllowanceRate: 100 } } as unknown as RunPayrollRowLike;
assertEq(ensureOpenRowNightAllowanceDuty(custom, fresh), custom, "a duty row that is not exactly 8x the slab is untouched (no threshold)");

// No slab for the level: stored values kept. Typed NDA override: kept as typed.
assertEq(
  ensureOpenRowNightAllowanceDuty(stale, { govRecalc: { nightAllowanceRate: 0, nightAllowanceRateBasis: "duty" } } as unknown as RunPayrollRowLike),
  stale,
  "no slab: stored values kept",
);
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
const lvl1 = run(gr({ nightHours: 120, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }));
assertEq(lvl1.nightAllowancePaid, 348, "compute: Level 1, 120h = 348");
assertEq(lvl1.totalEarnings - none.totalEarnings, 348, "gross rises by exactly the allowance");
assertEq(lvl1.netSalary - none.netSalary, 348, "net rises by exactly the allowance");
assertEq(lvl1.totalEarnings - lvl1.totalDeductions, lvl1.netSalary, "gross - deductions = net");
assertEq(run(gr({ nightHours: 120, nightAllowanceRate: 23.2 })).nightAllowancePaid, 348, "no basis defaults to per duty");

// Draft save/reload keeps the typed hours exactly.
const payload = {
  govRecalc: { nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" },
  governmentMonthly: { nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty", nightAllowancePaid: 25 },
};
const reloaded = deserializePayrollDraftEmployee(
  { employeeUserId: "u", rowPayload: JSON.parse(JSON.stringify(payload)) } as never,
  { employeeUserId: "u", payrollMode: "government" } as never,
) as unknown as RunPayrollRowLike;
assertEq(reloaded.govRecalc?.nightHours, 8.5, "reload keeps typed hours");

// Settings > Night Allowance shows and saves the per-duty amount exactly as typed: no x8 or /8 anywhere.
const settingsSrc = readFileSync(new URL("../components/settings/NightAllowanceSettings.tsx", import.meta.url), "utf8");
assertEq(settingsSrc.includes("Night Allowance Rate / Duty (8 h)"), true, "per-duty column header");
assertEq(settingsSrc.includes("ratePerDuty: Number(form.ratePerDuty)"), true, "saves the typed per-duty amount as typed");
assertEq(/rate\w*\s*[*/]\s*8\b/i.test(settingsSrc), false, "no rate x8 or /8 conversion in Settings");
const masterSrc = readFileSync(new URL("../components/payroll/PayrollMasterScreen.tsx", import.meta.url), "utf8");
assertEq(masterSrc.includes("resolvedNightAllowance.rate.toFixed(2)}/duty"), true, "Payroll Master shows the per-duty rate");

console.log("nightAllowanceHourly.test.ts passed");
