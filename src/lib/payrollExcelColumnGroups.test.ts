/**
 * Run: npx --yes tsx src/lib/payrollExcelColumnGroups.test.ts
 *
 * The Run Payroll workbook (Preview Excel / Extract / saved export): every column is classified, every earning
 * sits left of GrossTotal, every deduction left of TotalDeductions, NetSalary follows TotalDeductions, custom
 * fields land in the right block from their Settings group, and the generated sheet's header row is exactly the
 * shared header list.
 */
import * as XLSX from "xlsx-js-style";
import {
  PAYROLL_EXCEL_GROUPS,
  PAYROLL_EXCEL_HEADER,
  buildPayrollExcelHeaders,
  collectDynamicPayrollExcelColumns,
  payrollExcelHeaderGroups,
} from "./payrollExcelExport";
import { buildEmployeeDetailSheet, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { applyAutoArrearsToGovernmentMonthly } from "./payrollArrearCalc";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const KNOWN = ["identity", "info", "earning", "total_earnings", "deduction", "total_deductions", "net"];

function assertGroupRules(headers: string[], groups: string[], what: string) {
  assertEq(headers.length, groups.length, `${what}: one group per column`);
  groups.forEach((g, i) => assertEq(KNOWN.includes(g), true, `${what}: column ${headers[i]} is unclassified`));
  const te = groups.indexOf("total_earnings");
  const td = groups.indexOf("total_deductions");
  assertEq(te >= 0 && td >= 0, true, `${what}: both totals exist`);
  groups.forEach((g, i) => {
    if (g === "earning") assertEq(i < te, true, `${what}: earning ${headers[i]} must be left of GrossTotal`);
    if (g === "deduction") assertEq(i < td && i > te, true, `${what}: deduction ${headers[i]} must be between GrossTotal and TotalDeductions`);
  });
  assertEq(groups[td + 1], "net", `${what}: Net follows TotalDeductions`);
  assertEq(groups.filter((g) => g === "net").length, 1, `${what}: a single Net column`);
  assertEq(new Set(headers.map((h) => h.toLowerCase())).size, headers.length, `${what}: no two columns share a header`);
}

// 1. The fixed list: every header classified, rules hold with no custom fields.
for (const h of PAYROLL_EXCEL_HEADER) assertEq(h in PAYROLL_EXCEL_GROUPS, true, `fixed column ${h} has a group`);
assertGroupRules(buildPayrollExcelHeaders([]), payrollExcelHeaderGroups([]), "fixed columns");
{
  const h = [...PAYROLL_EXCEL_HEADER] as string[];
  assertEq(h.indexOf("NetSalary"), h.indexOf("TotalDeductions") + 1, "NetSalary directly follows TotalDeductions");
  assertEq(PAYROLL_EXCEL_GROUPS["Net Arrears"], "info", "Net Arrears is a memo column");
  assertEq(h.indexOf("Net Arrears") > h.indexOf("NetSalary"), true, "after Net Salary, with the other memo columns");
  assertEq(PAYROLL_EXCEL_GROUPS["CPF Arr"], "info", "CPF Arr is a memo: its amount is the DA CPF deduction");
  for (const e of ["Incentive", "PRBonus", "Reimbursement"]) assertEq(PAYROLL_EXCEL_GROUPS[e], "earning", `${e} is an earning`);
  assertEq(PAYROLL_EXCEL_GROUPS["Professional Tax"], "deduction", "Professional Tax is a deduction");
}

// 2. Custom fields land in the right block from their Settings group; duplicates get "(Custom)".
const labels = new Map([
  ["advance", "Advance"], ["cpf_arrears", "CPF Arr"], ["net_arrears", "Net Arrears"], ["arrears", "Arrears"],
  ["encashment_arrears", "Encashment Arrears"], ["over_time_allowance", "Over Time Allowance"],
  ["special_allowance", "Special Allowance"], ["past_arrears", "Past Arrears"], ["brand_new", "Brand New Pay"],
  ["brand_new_ded", "Brand New Recovery"], ["clash", "DA"],
]);
const groupsByKey = new Map<string, "earnings" | "deductions" | "statutory">([
  ["advance", "deductions"], ["cpf_arrears", "deductions"], ["net_arrears", "earnings"], ["arrears", "earnings"],
  ["encashment_arrears", "earnings"], ["over_time_allowance", "earnings"], ["special_allowance", "earnings"],
  ["past_arrears", "earnings"], ["brand_new", "earnings"], ["brand_new_ded", "deductions"], ["clash", "earnings"],
]);
const dyn = collectDynamicPayrollExcelColumns([], labels, new Set(labels.keys()), groupsByKey);
assertEq(dyn.some((c) => c.label === "CPF Arr" || c.label === "Net Arrears"), false, "CPF Arr and Net Arrears are fixed columns, not repeated as custom ones");
assertEq(dyn.find((c) => c.key === "dyn_clash")?.label, "DA (Custom)", "a custom field named like a fixed column gets (Custom)");
assertEq(dyn.find((c) => c.key === "dyn_arrears")?.label, "Arrears", "the custom Arrears field keeps its name (no duplicate header)");
const headers = buildPayrollExcelHeaders(dyn);
const groups = payrollExcelHeaderGroups(dyn);
assertGroupRules(headers, groups, "with custom fields");
const at = (h: string) => headers.indexOf(h);
assertEq(at("Brand New Pay") < at("GrossTotal") && at("Brand New Pay") > at("Reimbursement"), true, "a new earning lands before GrossTotal");
assertEq(at("Brand New Recovery") < at("TotalDeductions") && at("Brand New Recovery") > at("CPF Arr"), true, "a new deduction lands before TotalDeductions");
assertEq(at("Advance") < at("TotalDeductions") && at("Advance") > at("GrossTotal"), true, "Advance is a deduction");
assertEq(headers[at("TotalDeductions") + 1], "NetSalary", "Net follows Total Deductions with custom fields too");

// 3. A real generated sheet: header row equals the shared header list, totals row present, values in the right columns.
const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr: GovRecalcPayload = {
  grossBasic: 33333, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 1, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
};
const comp = runGovernmentPayrollCompute(gr, { daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null }).comp;
const gm = applyAutoArrearsToGovernmentMonthly(comp, { daArrear: 1000, transportArrear: 200, grossArrear: 1200, cpfArrear: 144, netArrear: 1056 });
const rows = [{
  employeeUserId: "e1", employeeName: "Employee One", payrollMode: "government", payDays: 30,
  grossPay: gm.totalEarnings, deductions: gm.totalDeductions, netPay: gm.netSalary, takeHome: gm.netSalary,
  governmentMonthly: { ...(gm as unknown as Record<string, unknown>), customEarnings: { brand_new: 25 }, customDeductions: { advance: 10 } },
}] as unknown as PayrollRunExportRow[];
const sheet = buildEmployeeDetailSheet(rows, {
  month: 9, year: 2026, status: "Draft",
  payrollFields: [...labels.entries()].map(([fieldKey, fieldLabel]) => ({
    fieldKey, fieldLabel, fieldGroup: groupsByKey.get(fieldKey), fieldType: "number", isActive: true, showInRunPayroll: true,
  })),
});
const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
const headerRow = grid[3].map(String);
assertEq(headerRow, buildPayrollExcelHeaders(collectDynamicPayrollExcelColumns([], labels, new Set(labels.keys()), groupsByKey), ["EncashmentDA"]), "the sheet's header row is the shared header list");
assertGroupRules(headerRow, payrollExcelHeaderGroups(collectDynamicPayrollExcelColumns([], labels, new Set(labels.keys()), groupsByKey), ["EncashmentDA"]), "generated sheet");
const cell = (h: string, r = 4) => sheet[XLSX.utils.encode_cell({ r, c: headerRow.indexOf(h) })]?.v;
assertEq(cell("CPF Arr"), 144, "CPF Arr carries the saved CPF arrear (it used to be 0)");
assertEq(cell("Net Arrears"), 1056, "Net Arrears carries the saved net arrear");
assertEq(cell("Gross Arrears"), 1200, "GrossArrears carries the saved gross arrear");
assertEq(cell("Brand New Pay"), 25, "custom earning value");
assertEq(cell("Advance"), 10, "Advance deduction value");
assertEq(cell("GrossTotal"), gm.totalEarnings, "GrossTotal");
assertEq(cell("TotalDeductions"), gm.totalDeductions, "TotalDeductions");
assertEq(cell("NetSalary"), gm.netSalary, "NetSalary");
assertEq(sheet[XLSX.utils.encode_cell({ r: 5, c: 0 })]?.v, "TOTALS", "bottom totals row");

console.log("payrollExcelColumnGroups.test.ts passed");
