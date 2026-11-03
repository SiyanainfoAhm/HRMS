/**
 * Run: npx --yes tsx src/lib/exactMoney.test.ts
 *
 * Whole-rupee rule (CIRT): every payroll line is rounded ONCE, to the nearest rupee (0.50 up), using
 * integer-paise steps (src/lib/money.ts). The PHP mirror (backend/app/Support/Money.php) reads the same
 * fixture, backend/tests/fixtures/money_cases.json, with zero tolerance. The fixture carries the expected
 * value for both rules ("rupee" and "paise"); its "rule" must match the code switch.
 */
import { readFileSync } from "node:fs";
import { MONEY_WHOLE_RUPEES, formatMoney, percentOf, proportion, roundMoney, sumMoney } from "./money";
import { calculateNightAllowanceAmount } from "./nightAllowanceCalculation";
import { roundElectricityDeduction } from "./electricityTariffCalculation";
import { computeEolHplDeductions } from "./hplEolDeductions";
import { applyAutoArrearsToGovernmentMonthly, calculateMonthDaArrear } from "./payrollArrearCalc";
import { calculateCpfFromBasis } from "./payrollCpfCalculation";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { deserializePayrollDraftEmployee, sumResolvedPayrollTotals } from "./deserializePayrollDraftEmployee";
import { fmtIn } from "../components/payroll/payrollRunPreviewShared";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

type Pair = { expectedRupee: number; expectedPaise: number };
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/money_cases.json", import.meta.url), "utf8")) as {
  rule: "rupee" | "paise";
  percent: Array<{ amount: number; percent: number } & Pair>;
  proportion: Array<{ amount: number; numerator: number; denominator: number } & Pair>;
  round: Array<{ value: number } & Pair>;
  named: Record<string, { rupee: number; paise: number }>;
};
assertEq(fixture.rule, MONEY_WHOLE_RUPEES ? "rupee" : "paise", "fixture rule matches the switch in money.ts");
const pick = (p: Pair) => (fixture.rule === "rupee" ? p.expectedRupee : p.expectedPaise);
const named = (k: string) => (fixture.rule === "rupee" ? fixture.named[k].rupee : fixture.named[k].paise);

// 1. The shared rule, zero tolerance against an independent BigInt oracle.
for (const c of fixture.percent) assertEq(percentOf(c.amount, c.percent), pick(c), `${c.amount} x ${c.percent}%`);
for (const c of fixture.proportion) assertEq(proportion(c.amount, c.numerator, c.denominator), pick(c), `${c.amount} x ${c.numerator}/${c.denominator}`);
for (const c of fixture.round) assertEq(roundMoney(c.value), pick(c), `roundMoney(${c.value})`);
assertEq(roundMoney(0.5), 1, "0.50 rounds up");
assertEq(roundMoney(0.49), 0, "0.49 rounds down");
assertEq(roundMoney(54.09), 54, "a typed 54.09 becomes 54");
assertEq(sumMoney(0.4, 0.4, 0.4), 0, "each line is rounded first, so the sum is the sum of the rounded lines");
assertEq(sumMoney(10.4, 10.4, 10.4), 30, "sum of rounded lines");

// 2. The examples from the brief.
assertEq(calculateNightAllowanceAmount(8.5, 23.2, "duty"), 25, "NDA: 8.5 hours at 23.20/duty = 24.65 -> 25");
assertEq(named("nda_8_5h_at_23_20"), 25, "fixture agrees");
assertEq(calculateNightAllowanceAmount(120, 23.2, "duty"), 348, "NDA: 120 hours = 348");
assertEq(percentOf(33333, 30), 10000, "HRA 30% of 33,333 = 9,999.90 -> 10,000");
assertEq(proportion(15000, 30, 31), 14516, "HRA prorated for 30 of 31 days (14,516.13 -> 14,516)");
assertEq(roundElectricityDeduction(710.849), 711, "electricity deduction is a whole rupee");
assertEq(roundElectricityDeduction(4869.5), 4870, "electricity deduction: 0.50 rounds up");
assertEq(roundElectricityDeduction(4869.49), 4869, "electricity deduction: 0.49 rounds down");
const eol = computeEolHplDeductions({ referenceSalary: { basic: 30000, da: 15900, hra: 9000, medical: 0 }, daysInReferenceMonth: 28, eolDays: 1 });
assertEq(eol.eolDeduction, 1961, "EOL: 54,900 / 28 days x 1 day = 1,960.71 -> 1,961");
const hpl = computeEolHplDeductions({ referenceSalary: { basic: 30000, da: 15900, hra: 9000, medical: 0 }, daysInReferenceMonth: 30, hplDays: 3 });
assertEq(hpl.hplDeduction, 2295, "HPL: (basic + DA) 45,900 x 3 days x 0.5 / 30 = 2,295");
assertEq(calculateCpfFromBasis(0, 33333 + 17666, 12, 0), 6120, "CPF: 12% of 50,999 = 6,119.88 -> 6,120");
assertEq(calculateCpfFromBasis(0, 550, 12, 0), 66, "CPF: 12% of 550 = 66");
const arrM = calculateMonthDaArrear(33333, 3600, 50, 53);
assertEq(arrM.daArrear, 999, "DA arrear: 17,666 (53%) - 16,667 (50%: 16,666.50 rounds up) = 999");
assertEq(arrM.transportArrear, 108, "transport arrear: 3% of 3,600 = 108");
assertEq(arrM.grossArrear, arrM.daArrear + arrM.transportArrear, "gross arrear is the sum of the lines");
assertEq(arrM.netArrear, arrM.grossArrear - arrM.cpfArrear, "net arrear = gross - CPF arrear");
assertEq(Number.isInteger(arrM.cpfArrear), true, "CPF arrear is a whole rupee");

// 3. Display: whole rupees, no .00.
assertEq(formatMoney(1923), "1,923", "arrear chip");
assertEq(formatMoney(1923.4), "1,923", "display shows the rounded value");
assertEq(formatMoney(1234567), "12,34,567", "Indian grouping");
assertEq(fmtIn(2784), "2,784", "NDA chip");
assertEq(fmtIn(197.2), "197", "197.20 shows as 197");

// 4. A whole row: every line is a whole rupee; gross and net are exactly the sum of the lines.
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
assertEq(full.nightAllowancePaid, 25, "row NDA 8.5h = 25");
assertEq(full.hraPaid, 10000, "row HRA 10,000");
assertEq(full.daPaid, 17666, "row DA 33,333 x 53% = 17,666.49 -> 17,666");
const partial = run(gr({ nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }), 30);
assertEq(partial.hraPaid, proportion(10000, 30, 31), "HRA prorated 30/31");
assertEq(partial.basicPaid, proportion(33333, 30, 31), "Basic prorated 30/31");
const lines = ["basicPaid", "daPaid", "hraPaid", "medicalPaid", "transportPaid", "spPayPaid", "extraWorkAllowancePaid", "nightAllowancePaid", "uniformAllowancePaid", "educationAllowancePaid", "daArrearsPaid", "transportArrearsPaid", "encashmentPaid", "encashmentDaPaid"];
for (const row of [full, partial]) {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" && /Paid$|Actual$|^total|^net/.test(k)) assertEq(Number.isInteger(v), true, `${k} (${v}) is a whole rupee`);
  }
  for (const [k, v] of Object.entries(row.deductions)) assertEq(Number.isInteger(v), true, `deduction ${k} (${v}) is a whole rupee`);
  assertEq(row.totalEarnings, sumMoney(...lines.map((k) => row[k] ?? 0)), "gross = exact sum of the displayed earning lines");
  assertEq(row.totalEarnings - row.totalDeductions, row.netSalary, "gross - deductions = net, exactly");
}

// 5. Typed paise are rounded to the rupee in the result.
const typed = run(gr({ nightHours: 15, nightAllowanceRate: 28.85, nightAllowanceRateBasis: "duty", nightAllowanceManualOverride: true, earningPaidOverrides: { daPaid: 777.77, nightAllowancePaid: 54.09 }, deductionPaidOverrides: { mess: 12.34 } }));
assertEq(typed.daPaid, 778, "typed DA 777.77 -> 778");
assertEq(typed.nightAllowancePaid, 54, "typed NDA 54.09 -> 54");
assertEq(typed.deductions.mess, 12, "typed mess 12.34 -> 12");
assertEq(typed.totalEarnings - typed.totalDeductions, typed.netSalary, "gross - deductions = net with typed paise");

// 6. Arrears typed with paise are rounded; gross/net move by exactly the rounded amounts.
const base = run(gr());
const arr = applyAutoArrearsToGovernmentMonthly(base, { daArrear: 1000.5, transportArrear: 200.25, grossArrear: 1200.75, cpfArrear: 144.09, netArrear: 1056.66 });
assertEq(arr.totalEarnings - base.totalEarnings, 1201, "gross rises by the rounded typed arrear (1,200.75 -> 1,201)");
assertEq(arr.totalDeductions - base.totalDeductions, 144, "deductions rise by the rounded CPF arrear (144.09 -> 144)");
assertEq(arr.totalEarnings - arr.totalDeductions, arr.netSalary, "gross - deductions = net with arrears");

// 7. Draft save/reload keeps whole rupees; header totals are the exact sum of the rows.
const payload = JSON.parse(JSON.stringify({ govRecalc: gr({ nightHours: 8.5, nightAllowanceRate: 23.2, nightAllowanceRateBasis: "duty" }), governmentMonthly: full }));
const reloaded = deserializePayrollDraftEmployee(
  { employeeUserId: "u", rowPayload: payload } as never,
  { employeeUserId: "u", payrollMode: "government" } as never,
) as unknown as Record<string, unknown> & { governmentMonthly: Record<string, number> };
assertEq(reloaded.governmentMonthly.nightAllowancePaid, 25, "reload keeps NDA");
assertEq(reloaded.governmentMonthly.totalEarnings, full.totalEarnings, "reload keeps gross");
assertEq(reloaded.governmentMonthly.netSalary, full.netSalary, "reload keeps net");
const totals = sumResolvedPayrollTotals([
  { governmentMonthly: full },
  { governmentMonthly: partial },
] as Array<Record<string, unknown>>);
assertEq(totals.gross, sumMoney(full.totalEarnings, partial.totalEarnings), "header gross is the exact sum");
assertEq(totals.net, sumMoney(full.netSalary, partial.netSalary), "header net is the exact sum");
assertEq(totals.gross - totals.deductions, totals.net, "header gross - deductions = net");
// A draft saved under the old paise rule: the header shows the rounded amounts.
const oldDraft = sumResolvedPayrollTotals([{ governmentMonthly: { totalEarnings: 1000.4, totalDeductions: 200.4, netSalary: 800 } }] as Array<Record<string, unknown>>);
assertEq(oldDraft.gross, 1000, "old paise gross shows rounded");
assertEq(oldDraft.deductions, 200, "old paise deductions show rounded");

// 8. Workbook summary and displayed totals: gross - deductions = net, exactly.
const rows: PayrollRunExportRow[] = [full, partial].map((gm, i) => ({
  employeeUserId: `e${i}`, payrollMode: "government", payDays: 31, grossPay: gm.totalEarnings, deductions: gm.totalDeductions,
  netPay: gm.netSalary, takeHome: gm.netSalary, governmentMonthly: gm as unknown as Record<string, unknown>,
})) as unknown as PayrollRunExportRow[];
const summary = aggregatePayrollSummary(rows);
assertEq(summary.totalEarnings, sumMoney(full.totalEarnings, partial.totalEarnings), "workbook gross");
assertEq(summary.netPayable, sumMoney(full.netSalary, partial.netSalary), "workbook net");
assertEq(summary.totalEarnings - summary.totalDeductions, summary.netPayable, "workbook gross - deductions = net");
const shown = (n: number) => Number(fmtIn(n).replace(/,/g, ""));
assertEq(shown(full.totalEarnings) - shown(full.totalDeductions), shown(full.netSalary), "on screen: displayed gross - deductions = displayed net");

console.log("exactMoney.test.ts passed");
