/**
 * Run: npx --yes tsx src/lib/nightAllowanceDuty.test.ts
 *
 * CIRT-08: Night Duty Allowance = (Total Night Duty Hours / 8) x rate for the Pay Level.
 * NDA = (hours x perDuty) / 8, rounded once to the whole rupee (CIRT).
 */
import { readFileSync } from "node:fs";
import {
  NIGHT_DUTY_BASE_HOURS,
  calculateNightAllowanceAmount,
  resolveNightAllowanceAmount,
  resolveNightAllowanceRateByPayLevel,
} from "./nightAllowanceCalculation";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

assertEq(NIGHT_DUTY_BASE_HOURS, 8, "base hours");

// Example Pay Level 7 rate: 403.20 per 8-hour duty.
const RATE = 403.2;
assertEq(calculateNightAllowanceAmount(24, RATE, "duty"), 1210, "24h = 3 duties x 403.20 = 1209.60 -> 1210");
assertEq(calculateNightAllowanceAmount(8, RATE, "duty"), 403, "8h = 1 duty (403.20 -> 403)");
assertEq(calculateNightAllowanceAmount(4, RATE, "duty"), 202, "4h = 0.5 duty = 201.60 -> 202");
assertEq(calculateNightAllowanceAmount(10, RATE, "duty"), 504, "10h = 1.25 duty = 504.0");
// Fractional hours: no intermediate rounding; the amount is rounded once, to the whole rupee.
assertEq(calculateNightAllowanceAmount(5, 400, "duty"), 250, "5h at 400/duty = 250 exactly");
assertEq(calculateNightAllowanceAmount(7.5, RATE, "duty"), 378, "7.5h x 403.20 / 8 = 378.0");
assertEq(calculateNightAllowanceAmount(0.5, RATE, "duty"), 25, "0.5h x 403.20 / 8 = 25.20 -> 25");
assertEq(calculateNightAllowanceAmount(0, RATE, "duty"), 0, "no hours");
assertEq(calculateNightAllowanceAmount(-3, RATE, "duty"), 0, "negative hours clamp");
assertEq(calculateNightAllowanceAmount(24, -5, "duty"), 0, "negative rate clamps");

// Legacy rows (stored per-hour rate, no basis) keep hours x rate, so generated payroll recomputes unchanged.
assertEq(calculateNightAllowanceAmount(10, 50.4), 63, "default basis is per duty (10h x 50.4 / 8)");
assertEq(calculateNightAllowanceAmount(10, 50.4, "hour"), 504, "legacy hour basis");
// Seeded per-duty rate (= hourly x 8) reproduces the previous amount for whole-duty hours.
assertEq(Math.abs(calculateNightAllowanceAmount(16, 50.4 * 8, "duty") - calculateNightAllowanceAmount(16, 50.4, "hour")) < 0.5, true, "both bases are whole rupees");

// Rate table: per-Pay-Level, per-duty rate; falls back to hourly x 8 only when a row has no per-duty rate.
const rates = [
  { slabNo: 1, payLevel: 7, ratePerHour: 50.4, ratePerDuty: 403.2, effectiveFrom: "2026-01-01", isActive: true },
  { slabNo: 2, payLevel: 8, ratePerHour: 55.45, ratePerDuty: null, effectiveFrom: "2026-01-01", isActive: true },
];
const l7 = resolveNightAllowanceRateByPayLevel(rates, 7, "2026-09-30");
assertEq(l7.rate, 403.2, "level 7 per-duty rate");
assertEq(l7.basis, "duty", "new rates are per duty");
assertEq(resolveNightAllowanceRateByPayLevel(rates, 8, "2026-09-30").rate, 55.45, "no per-duty column -> the legacy column already holds the table amount (no x8)");
assertEq(resolveNightAllowanceRateByPayLevel(rates, 3, "2026-09-30").rate, 0, "no rate for level");

// Ceiling and manual override still apply on top.
const ceil = resolveNightAllowanceAmount({ hours: 24, rate: RATE, rateBasis: "duty", basicPay: 50000, ceiling: 43600 });
assertEq(ceil.eligible, false, "above ceiling not eligible");
assertEq(ceil.amount, 0, "above ceiling amount 0");
assertEq(
  resolveNightAllowanceAmount({ hours: 24, rate: RATE, rateBasis: "duty", basicPay: 30000, ceiling: 43600, manualOverride: true, manualAmount: 999 }).amount,
  999,
  "manual override wins",
);

// Whole compute: 24 night hours at Level 7 adds 1210 to gross; the same row on a legacy hourly rate is unchanged.
const ded = {
  incomeTax: 0, pt: 0, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr = (extra: Partial<GovRecalcPayload>): GovRecalcPayload => ({
  grossBasic: 30000, daPercent: 50, hraPercent: 30, medicalFixed: 0, payLevel: 7, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
  ...extra,
});
const run = (g: GovRecalcPayload) =>
  runGovernmentPayrollCompute(g, { daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null })
    .comp as unknown as Record<string, number>;
const none = run(gr({}));
const duty = run(gr({ nightHours: 24, nightAllowanceRate: RATE, nightAllowanceRateBasis: "duty" }));
assertEq(duty.nightAllowancePaid, 1210, "compute: 24h at 403.20/duty");
assertEq(duty.totalEarnings - none.totalEarnings, 1210, "compute: gross rises by the allowance");
const legacy = run(gr({ nightHours: 10, nightAllowanceRate: 50.4, nightAllowanceRateBasis: "hour" }));
assertEq(legacy.nightAllowancePaid, 504, "compute: explicit legacy per-hour row unchanged");

// PHP mirror declares the same constants and the same rounding.
const php = readFileSync(new URL("../../backend/app/Services/NightAllowanceRateService.php", import.meta.url), "utf8");
for (const needle of ["DUTY_BASE_HOURS = 8"]) {
  if (!php.includes(needle)) throw new Error(`PHP mirror missing ${needle}`);
}

console.log("nightAllowanceDuty.test.ts passed");
