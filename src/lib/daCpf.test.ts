/**
 * Run with: npx --yes tsx src/lib/daCpf.test.ts
 * DA CPF = CPF on the DA arrears = CPF Arr, through ONE function (daCpfOf). deductions.daCpf / da_cpf_amount is never read by a report.
 * PHP mirror: backend/tests/Unit/DaCpfTest.php (PayrollTotals::daCpf).
 */
import * as XLSX from "xlsx-js-style";
import { daCpfOf, totalCpfOf } from "./daCpf";
import { aggregatePayrollSummary, buildEmployeeDetailSheet, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { governmentPayslipDeductionPairs } from "./governmentPayslipLayout";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// 1. The function: every shape of source, the stale daCpf deduction ignored.
assertEq(daCpfOf({ cpfArrear: 498 }), 498, "camel snapshot");
assertEq(daCpfOf({ cpf_arrear: 498 }), 498, "snake DB row");
assertEq(daCpfOf({ governmentMonthly: { cpfArrear: 498 } }), 498, "Run Payroll row");
assertEq(daCpfOf({ cpfArrear: 498, deductions: { daCpf: 7000 }, da_cpf_amount: 7000 }), 498, "stored daCpf is never read");
assertEq(daCpfOf({ deductions: { daCpf: 7000 } }), 0, "no CPF Arr = no DA CPF, whatever deductions.daCpf says");
assertEq(daCpfOf(null), 0, "null");
assertEq(daCpfOf({ cpfArrear: "x" }), 0, "not a number");
assertEq(totalCpfOf({ deductions: { cpf: 11780 }, cpfArrear: 498 }), 12278, "Total CPF = CPF + DA CPF (Karalkar)");
assertEq(totalCpfOf({ cpf_amount: 11780, cpf_arrear: 498 }), 12278, "Total CPF from a DB row");

// 2. Every TS reader agrees.
const gm = {
  basicPaid: 40000, totalEarnings: 40000, cpfArrear: 498, deductions: { cpf: 11780, daCpf: 0 },
  totalDeductions: 12278, netSalary: 27722,
};
const row = { employeeUserId: "e1", employeeName: "Karalkar", payrollMode: "government", payDays: 30, grossPay: 40000, deductions: 12278, netPay: 27722, takeHome: 27722, governmentMonthly: gm } as unknown as PayrollRunExportRow;

const summary = aggregatePayrollSummary([row]);
assertEq(summary.deductions["DA CPF"], 498, "Monthly Summary DA CPF row");
assertEq(Object.values(summary.deductions).reduce((a, b) => a + b, 0), summary.totalDeductions, "Monthly Summary rows add up to Total Deductions");

const stale = aggregatePayrollSummary([{ ...row, governmentMonthly: { ...gm, deductions: { cpf: 11780, daCpf: 300 } } } as PayrollRunExportRow]);
assertEq(stale.deductions["DA CPF"], 498, "Monthly Summary ignores a stale deductions.daCpf");

const sheet = buildEmployeeDetailSheet([row], { month: 10, year: 2026, status: "Draft" });
const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
const hi = grid.findIndex((r) => r.includes("GrossTotal"));
const head = grid[hi] as string[];
assertEq(grid[hi + 1][head.indexOf("DA CPF")], 498, "Employee Detail DA CPF");

const pairs = governmentPayslipDeductionPairs({ cpf_amount: 11780, da_cpf_amount: 0, cpf_arrear: 498 } as never);
assertEq(pairs.find(([l]) => l === "DA CPF")?.[1], 498, "payslip DA CPF");
assertEq(pairs.some(([l]) => l === "CPF Arr"), false, "payslip prints the amount once");

console.log("daCpf.test.ts passed");
