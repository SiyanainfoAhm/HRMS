/**
 * Run: npx --yes tsx src/lib/exactMoney.test.ts
 *
 * Run Payroll keeps paise: every calculated line is rounded ONCE, half up, to 2 decimals using integer-paise
 * steps (src/lib/money.ts). The PHP mirror (backend/app/Support/Money.php) reads the same fixture,
 * backend/tests/fixtures/money_cases.json, with zero tolerance. Statutory whole-rupee items (CPF, DA/TR
 * arrear months) are NOT part of this rule.
 */
import { readFileSync } from "node:fs";
import { percentOf, proportion, round2, sumMoney, toPaise } from "./money";
import { calculateNightAllowanceAmount } from "./nightAllowanceCalculation";
import { roundElectricityDeduction } from "./electricityTariffCalculation";
import { computeEolHplDeductions } from "./hplEolDeductions";
import { applyAutoArrearsToGovernmentMonthly } from "./payrollArrearCalc";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { deserializePayrollDraftEmployee, sumResolvedPayrollTotals } from "./deserializePayrollDraftEmployee";
import { fmtIn } from "../components/payroll/payrollRunPreviewShared";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/money_cases.json", import.meta.url), "utf8")) as {
  percent: Array<{ amount: number; percent: number; expected: number }>;
  proportion: Array<{ amount: number; numerator: number; denominator: number; expected: number }>;
  named: Record<string, number>;
};

// 1. The shared rule, zero tolerance against an independent BigInt oracle.
for (const c of fixture.percent) assertEq(percentOf(c.amount, c.percent), c.expected, `${c.amount} x ${c.percent}%`);
for (const c of fixture.proportion) assertEq(proportion(c.amount, c.numerator, c.denominator), c.expected, `${c.amount} x ${c.numerator}/${c.denominator}`);
assertEq(round2(1.005), 1.01, "1.005 rounds half up, not to 1.00 (float drift)");
assertEq(round2(2.675), 2.68, "2.675 rounds half up");
assertEq(round2(-1.005), -1.01, "negatives round away from zero");
assertEq(sumMoney(0.1, 0.2), 0.3, "0.1 + 0.2 is exactly 0.30");

// 2. The examples from the brief.
assertEq(calculateNightAllowanceAmount(8.5, 23.2, "duty"), 24.65, "NDA: 8.5 hours at 23.20/duty = 24.65, not a whole rupee");
assertEq(fixture.named.nda_8_5h_at_23_20, 24.65, "fixture agrees");
assertEq(calculateNightAllowanceAmount(120, 23.2, "duty"), 348, "NDA: 120 hours = 348.00");
assertEq(percentOf(33333, 30), 9999.9, "HRA 30% of 33,333 = 9,999.90 (not 10,000)");
assertEq(proportion(15000, 30, 31), 14516.13, "HRA prorated for 30 of 31 days, to paise");
assertEq(roundElectricityDeduction(710.849), 710.85, "electricity deduction keeps paise");
assertEq(roundElectricityDeduction(4869.905), 4869.91, "electricity deduction rounds half up once");
assertEq(
  computeEolHplDeductions({ referenceSalary: { basic: 30000, da: 15900, hra: 9000, medical: 0 }, daysInReferenceMonth: 28, eolDays: 1 }).eolDeduction,
  1960.71,
  "EOL: 54,900 / 28 days x 1 day = 1,960.71",
);

// 3. Display: every amount with 2 decimals.
assertEq(fmtIn(1923), "1,923.00", "arrear chip");
assertEq(fmtIn(2784), "2,784.00", "NDA chip");
assertEq(fmtIn(197.2), "197.20", "197.20");
assertEq(fmtIn(24.65), "24.65", "24.65");

// 4. A whole row: lines have at most 2 decimals, gross and net are exactly the sum of the lines.
const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr = (extra: Partial<GovRecalcPayload> = {}): GovRecalcPayload => ({
  grossBasic: 33333, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 1, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
  ...extra,
});
const run = (g: GovRecalcPayload, payDays = 31) =>
  runGovernmentPayrollCompute(g, { daysInMonth: 31, payDays, runYear: 2026, runMonth: 10, payrollConfig: null, governmentMonthly: null })
    .comp as unknown as Record<string, number> & { deductions: Record<string, number> };

const full = run(gr({ nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }));
assertEq(full.nightAllowancePaid, 24.65, "row NDA 8.5h = 24.65");
assertEq(full.hraPaid, 9999.9, "row HRA 9,999.90");
assertEq(full.daPaid, 17666.49, "row DA 33,333 x 53% = 17,666.49");
const partial = run(gr({ nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }), 30);
assertEq(partial.hraPaid, proportion(9999.9, 30, 31), "HRA prorated 30/31 in paise");
assertEq(partial.basicPaid, proportion(33333, 30, 31), "Basic prorated 30/31 in paise");
for (const row of [full, partial]) {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" && /Paid$|Actual$|^total|^net/.test(k)) assertEq(toPaise(v) / 100, v, `${k} has at most 2 decimals`);
  }
  const lines = ["basicPaid", "daPaid", "hraPaid", "medicalPaid", "transportPaid", "spPayPaid", "extraWorkAllowancePaid", "nightAllowancePaid", "uniformAllowancePaid", "educationAllowancePaid", "daArrearsPaid", "transportArrearsPaid", "encashmentPaid", "encashmentDaPaid"];
  assertEq(row.totalEarnings, sumMoney(...lines.map((k) => row[k] ?? 0)), "gross = exact sum of the displayed earning lines");
  assertEq(sumMoney(row.totalEarnings, -row.totalDeductions), row.netSalary, "gross - deductions = net, exactly");
}

// 5. Typed values stay exactly as typed.
const typed = run(gr({ nightHours: 15, nightAllowanceRate: 28.85, nightAllowanceRateBasis: "duty", nightAllowanceManualOverride: true, earningPaidOverrides: { daPaid: 777.77, nightAllowancePaid: 54.09 }, deductionPaidOverrides: { mess: 12.34 } }));
assertEq(typed.daPaid, 777.77, "typed DA");
assertEq(typed.nightAllowancePaid, 54.09, "typed NDA");
assertEq(typed.deductions.mess, 12.34, "typed mess deduction");

// 6. Arrears typed with paise are kept; gross/net move by exactly the typed amounts.
const base = run(gr());
const arr = applyAutoArrearsToGovernmentMonthly(base, { daArrear: 1000.5, transportArrear: 200.25, grossArrear: 1200.75, cpfArrear: 144.09, netArrear: 1056.66 });
assertEq(sumMoney(arr.totalEarnings, -base.totalEarnings), 1200.75, "gross rises by the typed arrear");
assertEq(sumMoney(arr.totalDeductions, -base.totalDeductions), 144.09, "deductions rise by the typed CPF arrear");
assertEq(sumMoney(arr.totalEarnings, -arr.totalDeductions), arr.netSalary, "gross - deductions = net with paise arrears");

// 7. Draft save/reload keeps the decimals; header totals are the exact sum of the rows.
const payload = JSON.parse(JSON.stringify({ govRecalc: gr({ nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }), governmentMonthly: full }));
const reloaded = deserializePayrollDraftEmployee(
  { employeeUserId: "u", rowPayload: payload } as never,
  { employeeUserId: "u", payrollMode: "government" } as never,
) as unknown as Record<string, unknown> & { governmentMonthly: Record<string, number> };
assertEq(reloaded.governmentMonthly.nightAllowancePaid, 24.65, "reload keeps NDA paise");
assertEq(reloaded.governmentMonthly.totalEarnings, full.totalEarnings, "reload keeps gross");
assertEq(reloaded.governmentMonthly.netSalary, full.netSalary, "reload keeps net");
const totals = sumResolvedPayrollTotals([
  { governmentMonthly: full },
  { governmentMonthly: partial },
] as Array<Record<string, unknown>>);
assertEq(totals.gross, sumMoney(full.totalEarnings, partial.totalEarnings), "header gross is the exact sum");
assertEq(totals.net, sumMoney(full.netSalary, partial.netSalary), "header net is the exact sum");
assertEq(sumMoney(totals.gross, -totals.deductions), totals.net, "header gross - deductions = net");

// 8. Workbook summary: gross - deductions = net, exactly.
const rows: PayrollRunExportRow[] = [full, partial].map((gm, i) => ({
  employeeUserId: `e${i}`, payrollMode: "government", payDays: 31, grossPay: gm.totalEarnings, deductions: gm.totalDeductions,
  netPay: gm.netSalary, takeHome: gm.netSalary, governmentMonthly: gm as unknown as Record<string, unknown>,
})) as unknown as PayrollRunExportRow[];
const summary = aggregatePayrollSummary(rows);
assertEq(summary.totalEarnings, sumMoney(full.totalEarnings, partial.totalEarnings), "workbook gross");
assertEq(summary.netPayable, sumMoney(full.netSalary, partial.netSalary), "workbook net");
assertEq(sumMoney(summary.totalEarnings, -summary.totalDeductions), summary.netPayable, "workbook gross - deductions = net");

console.log("exactMoney.test.ts passed");
