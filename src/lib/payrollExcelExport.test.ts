/**
 * Run with: npx --yes tsx src/lib/payrollExcelExport.test.ts
 * Verifies that every stored government payroll component reaches its workbook column.
 */
import { buildPayrollExcelRow, PAYROLL_EXCEL_HEADER } from "./payrollExcelExport";

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

const expected: Record<string, string | number> = {
  AccountNumber: "00123", EmployeeName: "Employee One", PayLevel: 9, PayDays: 29,
  Basic: 100, DA: 101, HRA: 102, Medical: 103, TransportTA: 104, SPPay: 105,
  ExtraWorkAllowance: 106, NightAllowance: 107, NightHours: 1.5,
  NightAllowanceRate: 108, NightAllowanceCeiling: 109, NightAllowanceEligible: "Yes",
  UniformAllowance: 110, EducationAllowance: 111, TelephoneAllowance: 136,
  DAArrears: 112, TransportArrears: 113, GrossArrears: 114, Encashment: 115,
  EncashmentDA: 116, GrossTotal: 117, IncomeTax: 118, LIC: 119, CPF: 120, DACPF: 121,
  GPF: 137, VPF: 122, PFLoan: 123, PostOffice: 124, CreditSociety: 125,
  StdLicenceFee: 126, Electricity: 127, ElectricityUnits: 12, Water: 128, Mess: 129,
  BankRecovery: 130, Welfare: 131, HPL: 0, EOL: 0, Remarks: "Payroll period leave",
  VehCharge: 132, OtherDeduction: 133, TotalDeductions: 134, NetSalary: -17,
  ProfessionalTax: 135, QuarterAssigned: "Yes", QuarterName: "Q-1", QuarterType: "Type-A",
  QuarterRent: 138, QuarterRentDeduction: 138, NetPay: -17,
  CalendarDays: 31, EOLDays: 1, HPLDays: 2, EquivalentPayableDays: 29,
  EOLSalaryAdjustment: 3, HPLSalaryAdjustment: 3,
};

for (const [field, value] of Object.entries(expected)) {
  if (row[field] !== value) throw new Error(`${field}: expected ${String(value)}, received ${String(row[field])}`);
}
if ("ElectricityUnitRate" in row || PAYROLL_EXCEL_HEADER.includes("ElectricityUnitRate" as never)) {
  throw new Error("The electricity rate must not be included in payroll workbook output.");
}
if (Object.keys(row).some((key) => !PAYROLL_EXCEL_HEADER.includes(key as never))) {
  throw new Error("Workbook row contains a field that is not declared in its headers.");
}
