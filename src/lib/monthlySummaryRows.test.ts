/**
 * Run: npx --yes tsx src/lib/monthlySummaryRows.test.ts
 *
 * Monthly Summary sheet (aggregatePayrollSummary), CIRT / FoxPro printed-summary layout:
 *  - Transport includes TR Arrears; DA Arrears is a row of its own; there are no TR Arrears / Gross Arrears rows in the earnings,
 *    so the earnings rows add up exactly to Gross Salary Payable;
 *  - the DA CPF row carries the CPF Arr total, so the deduction rows add up to Total Deductions;
 *  - HPL / EOL are not deduction rows (leave is already deducted from earnings); they are reported as information;
 *  - arrears (DA, TR, Gross, CPF Arr, Net) are an information block;
 *  - a free-entry (custom) head that totals zero in every row (Past Arrears / Encashment Arrears stored as 0) is left out;
 *    a non-zero custom head stays; standard heads stay even at zero.
 */
import { aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";

let failures = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); } else console.log(`ok   ${label}`);
}
const sum = (m: Record<string, number>) => Object.values(m).reduce((x, y) => x + y, 0);

const row = (i: number, gm: Record<string, unknown>): PayrollRunExportRow =>
  ({ employeeUserId: `e${i}`, payrollMode: "government", payDays: 31, grossPay: gm.totalEarnings, deductions: gm.totalDeductions, netPay: gm.netSalary, takeHome: gm.netSalary, governmentMonthly: gm }) as unknown as PayrollRunExportRow;

// a: TR arrears 300, DA arrears 1,000, CPF Arr 450, 2 HPL days (1,200), custom Special Allowance 200.
const a = row(1, {
  basicPaid: 40000, daPaid: 25000, transportPaid: 5000, transportArrearsPaid: 300, daArrearsPaid: 1000, grossArrear: 1300, cpfArrear: 450,
  totalEarnings: 71500, deductions: { pt: 200, cpf: 7800, daCpf: 0, hpl: 0, eol: 0 }, totalDeductions: 8450, netSalary: 63050,
  hplDays: 2, hplAdjustment: 1200,
  customEarnings: { past_arrears: 0, encashment_arrears: 0, special_allowance: 200 },
});
// b: no arrears, 1 EOL day (900), DA CPF 100, custom deduction 50.
const b = row(2, {
  basicPaid: 30000, daPaid: 18000, transportPaid: 5000, totalEarnings: 53000,
  deductions: { pt: 200, cpf: 5760, daCpf: 100, hpl: 0, eol: 0 }, cpfArrear: 0, totalDeductions: 6110, netSalary: 46890,
  eolDays: 1, eolAdjustment: 900,
  customEarnings: { past_arrears: 0, encashment_arrears: 0, special_allowance: 0 }, customDeductions: { welfare_extra: 0, gpf_extra: 50 },
});
const s = aggregatePayrollSummary([a, b]);

// A. earnings
eq(s.earnings["Transport"], 10300, "Transport = Transport (10,000) + TR Arrears (300)");
eq(s.arrears, { "DA Arrears": 1000 }, "only DA Arrears is an arrears row in the earnings block");
const earningLabels = Object.keys(s.earnings);
eq(earningLabels.includes("TR Arrears") || earningLabels.includes("Gross Arrears"), false, "no TR Arrears / Gross Arrears rows in the earnings");
eq(sum(s.earnings) + sum(s.arrears), s.totalEarnings, "earnings rows add up exactly to Gross Salary Payable (124,500)");
eq(s.totalEarnings, 124500, "gross");
eq(earningLabels.includes("Past Arrears") || earningLabels.includes("Encashment Arrears"), false, "zero custom rows are left out");
eq(s.earnings["Special Allowance"], 200, "a non-zero custom head stays (one row)");
eq(earningLabels.includes("Special Pay"), true, "a standard head stays at zero");

// B. deductions
eq(s.deductions["DA CPF"], 550, "DA CPF row = DA CPF deduction (100) + CPF Arr (450)");
eq(Object.keys(s.deductions).includes("HPL") || Object.keys(s.deductions).includes("EOL"), false, "no HPL / EOL deduction rows");
eq(sum(s.deductions), s.totalDeductions, "deduction rows add up exactly to Total Deductions (14,560)");
eq(s.totalDeductions, 14560, "total deductions");
eq(Object.keys(s.deductions).includes("Welfare Extra"), false, "zero custom deduction head is left out");
eq(s.deductions["Gpf Extra"], 50, "non-zero custom deduction head stays");

// information blocks
eq(s.arrearsInfo, { daArrears: 1000, trArrears: 300, grossArrears: 1300, cpfArrear: 450, netArrears: 850 }, "arrears information block");
eq(s.leaveInfo, { hpl: { employees: 1, days: 2, amount: 1200 }, eol: { employees: 1, days: 1, amount: 900 }, total: 2100 }, "leave adjustments information block");

// A legacy typed HPL deduction is kept as a row so the deduction rows still add up.
const legacy = aggregatePayrollSummary([row(3, { basicPaid: 1000, totalEarnings: 1000, deductions: { hpl: 40 }, totalDeductions: 40, netSalary: 960 })]);
eq(legacy.deductions["HPL"], 40, "a non-zero HPL deduction line is kept");
eq(sum(legacy.deductions), legacy.totalDeductions, "...and the rows still add up");

// hplBasisAmount / eolBasisAmount are reference bases carried by rows without leave: they are not leave cuts.
const noLeave = aggregatePayrollSummary([row(4, { basicPaid: 1000, totalEarnings: 1000, deductions: {}, totalDeductions: 0, netSalary: 1000, hplBasisAmount: 63896, eolBasisAmount: 78656, hplAdjustment: 0, eolAdjustment: 0 })]);
eq(noLeave.leaveInfo, { hpl: { employees: 0, days: 0, amount: 0 }, eol: { employees: 0, days: 0, amount: 0 }, total: 0 }, "a row without leave is not counted, whatever its reference basis amounts are");

// Layout does not depend on stored zeros.
const plain = aggregatePayrollSummary([
  row(1, { ...(a.governmentMonthly as object), customEarnings: { special_allowance: 200 } }),
  row(2, { ...(b.governmentMonthly as object), customEarnings: {}, customDeductions: { gpf_extra: 50 } }),
]);
eq(Object.keys(plain.earnings), Object.keys(s.earnings), "earning rows are the same with or without stored zero custom keys");
eq(Object.keys(plain.deductions), Object.keys(s.deductions), "deduction rows are the same with or without stored zero custom keys");

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("monthlySummaryRows: all passed");
