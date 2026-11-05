/**
 * Run: npx --yes tsx src/lib/monthlySummaryRows.test.ts
 *
 * Monthly Summary sheet (aggregatePayrollSummary):
 *  - the DA CPF row carries the CPF Arr total (paybill rule, CIRT-06), so the deduction rows add up to Total Deductions;
 *  - a free-entry (custom) head that adds up to zero in every row (Past Arrears / Encashment Arrears stored as 0) is left
 *    out, so it cannot add a row and shift the others; a non-zero custom head stays; standard heads stay even at zero.
 */
import { aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";

let failures = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); } else console.log(`ok   ${label}`);
}

const row = (i: number, gm: Record<string, unknown>): PayrollRunExportRow =>
  ({ employeeUserId: `e${i}`, payrollMode: "government", payDays: 31, grossPay: gm.totalEarnings, deductions: gm.totalDeductions, netPay: gm.netSalary, takeHome: gm.netSalary, governmentMonthly: gm }) as unknown as PayrollRunExportRow;

// Two employees: totals are consistent (deductions = pt + cpf + daCpf + cpfArrear + custom).
const a = row(1, { basicPaid: 40000, daPaid: 25000, totalEarnings: 65000, deductions: { pt: 200, cpf: 7800, daCpf: 0 }, cpfArrear: 450, totalDeductions: 8450, netSalary: 56550,
  customEarnings: { past_arrears: 0, encashment_arrears: 0, special_allowance: 200 } });
const b = row(2, { basicPaid: 30000, daPaid: 18000, totalEarnings: 48000, deductions: { pt: 200, cpf: 5760, daCpf: 100 }, cpfArrear: 0, totalDeductions: 6110, netSalary: 41890,
  customEarnings: { past_arrears: 0, encashment_arrears: 0, special_allowance: 0 }, customDeductions: { welfare_extra: 0, gpf_extra: 50 } });
const s = aggregatePayrollSummary([a, b]);

eq(s.deductions["DA CPF"], 550, "DA CPF row = DA CPF deduction (100) + CPF Arr (450)");
const sumLines = Object.values(s.deductions).reduce((x, y) => x + y, 0);
eq(sumLines, s.totalDeductions, "deduction rows add up to Total Deductions (8,450 + 6,110 = 14,560)");
eq(s.totalDeductions, 14560, "total deductions");

const earningLabels = Object.keys(s.earnings);
eq(earningLabels.includes("Past Arrears"), false, "zero Past Arrears row is left out");
eq(earningLabels.includes("Encashment Arrears"), false, "zero Encashment Arrears row is left out");
eq(s.earnings["Special Allowance"], 200, "a non-zero custom head stays");
eq(earningLabels.includes("Special Pay"), true, "a standard head stays at zero");
eq(Object.keys(s.deductions).includes("Welfare Extra"), false, "zero custom deduction head is left out");
eq(s.deductions["Gpf Extra"], 50, "non-zero custom deduction head stays");

// Same data without the zero custom keys gives the same rows (layout does not depend on stored zeros).
const plain = aggregatePayrollSummary([row(1, { ...(a.governmentMonthly as object), customEarnings: { special_allowance: 200 } }), row(2, { ...(b.governmentMonthly as object), customEarnings: {}, customDeductions: { gpf_extra: 50 } })]);
eq(Object.keys(plain.earnings), Object.keys(s.earnings), "earning rows are the same with or without stored zero custom keys");
eq(Object.keys(plain.deductions), Object.keys(s.deductions), "deduction rows are the same with or without stored zero custom keys");

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("monthlySummaryRows: all passed");
