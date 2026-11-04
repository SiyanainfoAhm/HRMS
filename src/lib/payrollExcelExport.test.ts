/**
 * Run with: npx --yes tsx src/lib/payrollExcelExport.test.ts
 * Verifies that every stored government payroll component reaches its workbook column.
 */
import { buildPayrollExcelRow, buildPayrollExcelHeaders, collectDynamicPayrollExcelColumns, PAYROLL_EXCEL_HEADER } from "./payrollExcelExport";
import { buildEmployeeDetailSheet } from "./payrollRunWorkbook";
import * as XLSX from "xlsx-js-style";

const stored = {
  pay_level: 9, basic_paid: 100, da_paid: 101, hra_paid: 102, medical_paid: 103,
  transport_paid: 104, sp_pay_paid: 105, extra_work_allowance_paid: 106,
  night_allowance_paid: 107, night_hours: 1.5, night_allowance_rate: 108,
  night_allowance_basic_ceiling: 109, night_allowance_eligible: true,
  uniform_allowance_paid: 110, education_allowance_paid: 111,
  da_arrears_paid: 112, transport_arrears_paid: 113, gross_arrear: 114,
  encashment_paid: 115, encashment_da_paid: 116, total_earnings: 117,
  income_tax_amount: 118, lic_amount: 119, cpf_amount: 120, da_cpf_amount: 121,
  vpf_amount: 122, pf_loan_amount: 123, post_office_amount: 124,
  credit_society_amount: 125, std_licence_fee_amount: 126, electricity_amount: 127,
  electricity_units_consumed: 12, water_amount: 128, mess_amount: 129,
  loan_recovery_amount: 130, welfare_amount: 131, hpl_amount: 0, eol_amount: 0,
  leave_remarks: "Payroll period leave", veh_charge_amount: 132,
  other_deduction_amount: 133, total_deductions: 134, net_salary: -17,
  days_in_month: 31, eol_days: 1, hpl_days: 2, eol_basis_amount: 100, hpl_basis_amount: 100, pt_amount: 135,
  custom_earnings: { telephone_allowance: 136 }, custom_deductions: { gpf: 137 },
  has_quarter: true, quarter_name: "Q-1", quarter_type: "Type-A", quarter_rent_amount: 138,
};

const row = buildPayrollExcelRow({
  payroll_mode: "government", employee_user_id: "employee-1", bank_account_number: "00123",
  gross_pay: 117, net_pay: -17, pay_days: 29, days_in_month: 31, deductions: 134,
}, "Employee One", { kind: "row", row: stored });

const dynamicColumns = collectDynamicPayrollExcelColumns([
  { custom_earnings: { new_allowance: 42, inactive_component: 999 } },
], new Map([["new_allowance", "New Allowance"], ["inactive_component", "Inactive"]]), new Set(["new_allowance"]));
{
  const headers = buildPayrollExcelHeaders(dynamicColumns);
  if (headers.indexOf("New Allowance") < 0 || headers.indexOf("New Allowance") + 1 !== headers.indexOf("GrossTotal") || headers.includes("Inactive")) {
    throw new Error("Configured active dynamic component must be included (right before GrossTotal) and inactive fields excluded.");
  }
}
const dynamicRow = buildPayrollExcelRow({ payroll_mode: "government", employee_user_id: "employee-2" }, "Employee Two", {
  kind: "row",
  row: { custom_earnings: { new_allowance: 42 } },
}, dynamicColumns);
if (dynamicRow["New Allowance"] !== 42) {
  throw new Error("Dynamic component values must align with the configured heading.");
}

const detailSheet = buildEmployeeDetailSheet([{
  employeeUserId: "employee-3",
  employeeName: "Employee Three",
  payrollMode: "government",
  grossPay: 142,
  deductions: 7,
  netPay: 135,
  governmentMonthly: {
    totalEarnings: 142,
    totalDeductions: 7,
    netSalary: 135,
    customEarnings: { new_allowance: 42, inactive_component: 999 },
    customDeductions: { union_dues: 7 },
  },
}], {
  month: 10,
  year: 2026,
  status: "Draft",
  payrollFields: [
    { fieldKey: "new_allowance", fieldLabel: "New Allowance", fieldGroup: "earnings", isActive: true, showInRunPayroll: true },
    { fieldKey: "union_dues", fieldLabel: "Union Dues", fieldGroup: "deductions", isActive: true, showInRunPayroll: true },
    { fieldKey: "configured_zero", fieldLabel: "Configured Zero", fieldGroup: "earnings", fieldType: "number", isActive: true, showInRunPayroll: true },
    { fieldKey: "text_statutory", fieldLabel: "PAN", fieldGroup: "statutory", fieldType: "text", isActive: true, showInRunPayroll: true },
    { fieldKey: "inactive_component", fieldLabel: "Inactive Component", fieldGroup: "earnings", isActive: false, showInRunPayroll: true },
  ],
});
const sheetHeaders = XLSX.utils.sheet_to_json<string[]>(detailSheet, { header: 1 })[3];
for (const [heading, expectedValue] of [["New Allowance", 42], ["Union Dues", 7]] as const) {
  const column = sheetHeaders.indexOf(heading);
  if (column < 0) throw new Error(`Detailed workbook is missing configured component heading: ${heading}`);
  const value = detailSheet[XLSX.utils.encode_cell({ r: 4, c: column })]?.v;
  if (value !== expectedValue) throw new Error(`${heading}: expected ${expectedValue}, received ${String(value)}`);
  const total = detailSheet[XLSX.utils.encode_cell({ r: 5, c: column })]?.v;
  if (total !== expectedValue) throw new Error(`${heading} total: expected ${expectedValue}, received ${String(total)}`);
}
if (!sheetHeaders.includes("Configured Zero")) throw new Error("Configured active numeric fields must appear even when no employee has a saved value.");
const zeroColumn = sheetHeaders.indexOf("Configured Zero");
if (detailSheet[XLSX.utils.encode_cell({ r: 4, c: zeroColumn })]?.v !== 0) throw new Error("An unset configured component should export as zero.");
if (sheetHeaders.includes("Inactive Component")) throw new Error("Inactive payroll fields must not appear in the detailed workbook.");
if (sheetHeaders.includes("PAN")) throw new Error("Text statutory fields must not be exported as numeric payroll components.");

// Columns are the Run Payroll lines (screen order and labels); StdLicenceFee, NetPay, QuarterRentDeduction etc. are gone.
const expected: Record<string, string | number> = {
  AccountNumber: "00123", EmployeeName: "Employee One", PayLevel: 9, PayDays: 29,
  Basic: 100, "Special Pay": 105, DA: 101, Transport: 104, HRA: 102, Medical: 103, EWA: 106, "N. All.": 107,
  Uniform: 110, Education: 111, TelephoneAllowance: 136, "DA Arrears": 112, "TR Arrears": 113,
  "Encash.": 115, EncashmentDA: 116, "Gross Arrears": 114, GrossTotal: 117,
  "Inc. tax": 118, "Professional Tax": 135, LIC: 119, CPF: 120, "DA CPF": 121, VPF: 122, "PF Loan": 123,
  "Post off.": 124, "Cr. society": 125, Electricity: 127, Water: 128, Mess: 129, "Bank Recovery": 130,
  Welfare: 131, HPL: 0, EOL: 0, "Veh. chg.": 132, "Quarter Rent": 138, Other: 133, GPF: 137,
  TotalDeductions: 134, NetSalary: -17,
};
for (const gone of ["StdLicenceFee", "NetPay", "QuarterRentDeduction", "QuarterRent", "CTC", "TDS", "EmployeePF", "EmployerPF", "EmployeeESIC", "EmployerESIC",
  "NightHours", "NightAllowanceRate", "NightAllowanceCeiling", "NightAllowanceEligible", "ElectricityUnits", "CalendarDays", "EOLDays", "HPLDays",
  "EquivalentPayableDays", "EOLSalaryAdjustment", "HPLSalaryAdjustment", "Remarks", "QuarterAssigned", "QuarterName", "QuarterType"]) {
  if (gone in row || PAYROLL_EXCEL_HEADER.includes(gone)) throw new Error(`${gone} is not on Run Payroll and must not be exported`);
}

for (const [field, value] of Object.entries(expected)) {
  if (row[field] !== value) throw new Error(`${field}: expected ${String(value)}, received ${String(row[field])}`);
}
if ("ElectricityUnitRate" in row || PAYROLL_EXCEL_HEADER.includes("ElectricityUnitRate" as never)) {
  throw new Error("The electricity rate must not be included in payroll workbook output.");
}
if (Object.keys(row).some((key) => !PAYROLL_EXCEL_HEADER.includes(key as never))) {
  throw new Error("Workbook row contains a field that is not declared in its headers.");
}
