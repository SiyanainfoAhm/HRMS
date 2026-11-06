/**
 * Run with: npx --yes tsx src/lib/runPayrollExportColumns.test.ts
 * The Excel "Employee Detail" columns are built from the Run Payroll field list (lib/runPayrollFields):
 * same lines, order and labels; nothing that is not on Run Payroll; exported columns add up to the exported totals.
 */
import * as XLSX from "xlsx-js-style";
import { buildEmployeeDetailSheet, aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { PAYROLL_EXCEL_GROUPS, PAYROLL_EXCEL_HEADER, buildPayrollExcelHeaders, retiredEmptyExcelColumns } from "./payrollExcelExport";
import { RUN_PAYROLL_CPF_ARREAR_LINE, RUN_PAYROLL_DEDUCTION_LINES, RUN_PAYROLL_EARNING_LINES } from "./runPayrollFields";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Three employees; every earning / deduction line carries a distinct amount so a missing or doubled column shows up.
const earnKeys = RUN_PAYROLL_EARNING_LINES.filter((l) => !l.memo).map((l) => l.key);
const dedKeys = RUN_PAYROLL_DEDUCTION_LINES.map((l) => l.key);
function employee(i: number): PayrollRunExportRow {
  const gm: Record<string, unknown> = { payLevel: 10 };
  let gross = 0;
  earnKeys.forEach((k, j) => {
    if (k === "grossArrear") return; // aggregate memo of DA + TR arrears, not added on top
    const v = (i + 1) * 100 + j;
    gm[k] = v;
    gross += v;
  });
  gm.grossArrear = (gm.daArrearsPaid as number) + (gm.transportArrearsPaid as number);
  const deductions: Record<string, number> = {};
  let ded = 0;
  // daCpf is not an input any more (DA CPF is the CPF Arr below), so the stored deduction is 0 and is not counted.
  dedKeys.forEach((k, j) => { deductions[k] = k === "daCpf" ? 0 : (i + 1) * 10 + j; ded += deductions[k]; });
  deductions.stdLicenceFee = 0;
  gm.deductions = deductions;
  gm.cpfArrear = 5 * (i + 1);
  ded += gm.cpfArrear as number;
  gm.totalEarnings = gross;
  gm.totalDeductions = ded;
  gm.netSalary = gross - ded;
  return {
    employeeUserId: `emp-${i}`, employeeName: `Employee ${i}`, payrollMode: "government", payDays: 30,
    grossPay: gross, deductions: ded, netPay: gross - ded, governmentMonthly: gm,
  } as unknown as PayrollRunExportRow;
}
const rows = [0, 1, 2].map(employee);
const sheet = buildEmployeeDetailSheet(rows, { month: 10, year: 2026, status: "Draft" });
const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
const hi = grid.findIndex((r) => r.includes("GrossTotal"));
const head = grid[hi] as string[];

// 1. Columns = the Run Payroll field list, same order and labels.
const screenEarnings = RUN_PAYROLL_EARNING_LINES.filter((l) => !l.memo).map((l) => l.label);
const screenDeductions = RUN_PAYROLL_DEDUCTION_LINES.map((l) => l.label); // CPF Arr is the DA CPF amount: a memo column, not a second deduction
const exportedEarnings = head.filter((h) => PAYROLL_EXCEL_GROUPS[h] === "earning" && screenEarnings.includes(h));
assertEq(exportedEarnings, screenEarnings, "earning columns are the Run Payroll earnings, in screen order and labels");
const exportedDeductions = head.filter((h) => PAYROLL_EXCEL_GROUPS[h] === "deduction" && screenDeductions.includes(h));
assertEq(exportedDeductions, screenDeductions, "deduction columns are the Run Payroll deductions (DA CPF = CPF Arr), in screen order and labels");
assertEq(head.slice(0, 7), ["AccountNumber", "EmployeeName", "Division", "Department", "Designation", "PayLevel", "PayDays"], "identity columns");
assertEq(head, buildPayrollExcelHeaders([], retiredEmptyExcelColumns(rows.map((r) => r.governmentMonthly as Record<string, unknown>))), "sheet header row is the shared header list");

// 2. Nothing that is not on Run Payroll.
for (const gone of ["StdLicenceFee", "CTC", "TDS", "EmployeePF", "EmployerPF", "EmployeeESIC", "EmployerESIC", "NightHours", "NightAllowanceRate",
  "NightAllowanceCeiling", "NightAllowanceEligible", "QuarterRentDeduction", "QuarterRent", "NetPay", "ElectricityUnits"]) {
  assertEq(head.includes(gone), false, `${gone} is not exported`);
  assertEq(PAYROLL_EXCEL_HEADER.includes(gone), false, `${gone} is not in the fixed column list`);
}
assertEq(head.filter((h) => /quarter/i.test(h)).length, 1, "exactly one Quarter Rent column");
assertEq(head.filter((h) => PAYROLL_EXCEL_GROUPS[h] === "net").length, 1, "one net column");

// 3. Every row: exported earnings add up to Gross, deductions to Total Deductions, Gross - Deductions = Net.
const col = (h: string, r: number) => Number(grid[hi + 1 + r][head.indexOf(h)]);
for (let r = 0; r < rows.length; r++) {
  const sum = (group: string) => head.reduce((s, h, c) => s + (PAYROLL_EXCEL_GROUPS[h] === group && !["Incentive", "PRBonus", "Reimbursement"].includes(h) ? Number(grid[hi + 1 + r][c]) || 0 : 0), 0);
  // "Gross Arrears" is the aggregate memo of DA + TR arrears, so it is not added on top of them.
  const earnings = sum("earning") - col("Gross Arrears", r);
  assertEq(earnings, col("GrossTotal", r), `row ${r}: exported earnings = Gross`);
  assertEq(sum("deduction"), col("TotalDeductions", r), `row ${r}: exported deductions = Total Deductions`);
  assertEq(col("GrossTotal", r) - col("TotalDeductions", r), col("NetSalary", r), `row ${r}: Gross - Deductions = Net`);
}

// 4. Monthly Summary: only Run Payroll heads, same labels. CIRT / FoxPro layout: TR Arrears sit inside Transport and Gross Arrears is an
// information line, so neither is an earnings head (DA Arrears is its own row, in summary.arrears); HPL / EOL are information, not
// deduction heads (they are only kept while some row still carries a typed HPL / EOL deduction, as the fixture rows below do).
const summary = aggregatePayrollSummary(rows);
assertEq(Object.keys(summary.earnings), screenEarnings.filter((l) => !["DA Arrears", "TR Arrears", "Gross Arrears"].includes(l)), "summary earnings heads = Run Payroll labels (without the arrears rows)");
assertEq(Object.keys(summary.arrears), ["DA Arrears"], "DA Arrears is the one arrears row in the earnings block");
// These fixture rows carry typed HPL / EOL deduction amounts, so those two heads are kept (monthlySummaryRows.test.ts covers their removal when zero).
assertEq(Object.keys(summary.deductions), RUN_PAYROLL_DEDUCTION_LINES.map((l) => l.label), "summary deduction heads = Run Payroll labels");
assertEq(Object.keys(summary.deductions).includes("Std Licence Fee"), false, "no Std Licence Fee head");

console.log("runPayrollExportColumns.test.ts passed");
