import { PAYROLL_LABELS } from "@/lib/payrollLabels";

/**
 * The Run Payroll field list: the ONE source of truth for the earnings / deductions / arrears lines.
 * The Run Payroll screen renders from it and the Excel export ("Employee Detail" sheet and Monthly Summary)
 * derives its columns, order and labels from it, so adding or removing a line here changes both.
 *
 * `arrearField` marks the arrears lines that are edited through the arrear path
 * (grossArrear/netArrear are not sheet earning keys, so `govEarning_<key>` would be ignored).
 * `memo` lines are derived, shown for information and never added to totals.
 */
export type RunPayrollLine = { key: string; label: string; fieldKey?: string; arrearField?: string; memo?: boolean };

export const RUN_PAYROLL_EARNING_LINES: readonly RunPayrollLine[] = [
  { key: "basicPaid", label: "Basic", fieldKey: "gross_basic" },
  { key: "daPaid", label: "DA", fieldKey: "da" },
  { key: "transportPaid", label: "Transport", fieldKey: "transport" },
  { key: "hraPaid", label: "HRA", fieldKey: "hra" },
  { key: "medicalPaid", label: "Medical", fieldKey: "medical" },
  { key: "extraWorkAllowancePaid", label: "EWA", fieldKey: "extra_work_allowance" },
  { key: "nightAllowancePaid", label: "N. All.", fieldKey: "night_allowance" },
  { key: "uniformAllowancePaid", label: "Uniform", fieldKey: "uniform_allowance" },
  { key: "educationAllowancePaid", label: "Education", fieldKey: "education_allowance" },
  { key: "daArrearsPaid", label: PAYROLL_LABELS.daArrears, fieldKey: "da_arrears" },
  { key: "transportArrearsPaid", label: PAYROLL_LABELS.transportArrears, fieldKey: "transport_arrears" },
  { key: "encashmentPaid", label: "Encash." },
  { key: "grossArrear", label: PAYROLL_LABELS.grossArrears, fieldKey: "gross_arrears", arrearField: "grossArrear" },
  { key: "netArrear", label: PAYROLL_LABELS.netArrears, fieldKey: "net_arrears", arrearField: "netArrear", memo: true },
];

/** CPF Arr is stored on the monthly row (cpfArrear), not inside `deductions`, so it is rendered after this list. */
export const RUN_PAYROLL_DEDUCTION_LINES: readonly RunPayrollLine[] = [
  { key: "incomeTax", label: "Inc. tax", fieldKey: "income_tax" },
  { key: "pt", label: "Professional Tax", fieldKey: "professional_tax" },
  { key: "lic", label: "LIC", fieldKey: "lic" },
  { key: "cpf", label: "CPF", fieldKey: "cpf" },
  { key: "daCpf", label: "DA CPF", fieldKey: "da_cpf" },
  { key: "vpf", label: "VPF", fieldKey: "vpf" },
  { key: "pfLoan", label: "PF Loan" },
  { key: "postOffice", label: "Post off.", fieldKey: "post_office" },
  { key: "creditSociety", label: "Cr. society", fieldKey: "credit_society" },
  { key: "electricity", label: "Electricity", fieldKey: "electricity" },
  { key: "water", label: "Water", fieldKey: "water" },
  { key: "mess", label: "Mess", fieldKey: "mess" },
  { key: "loanRecovery", label: "Bank Recovery", fieldKey: "loan_recovery" },
  { key: "welfare", label: "Welfare", fieldKey: "welfare" },
  { key: "hpl", label: "HPL", fieldKey: "hpl" },
  { key: "eol", label: "EOL", fieldKey: "eol" },
  { key: "vehCharge", label: "Veh. chg." },
  { key: "quarterRent", label: "Quarter Rent", fieldKey: "quarter_rent" },
  { key: "other", label: "Other", fieldKey: "other_deduction" },
];

/** CPF Arr deduction line (cpfArrear on the monthly row). */
export const RUN_PAYROLL_CPF_ARREAR_LINE = {
  key: "cpfArrear",
  label: PAYROLL_LABELS.cpfArrears,
  fieldKey: "cpf_arrears",
  arrearField: "cpfArrear",
} as const;

/** Lines that are arrears (shown in the Arrears bucket of summaries). */
export const RUN_PAYROLL_ARREAR_KEYS: ReadonlySet<string> = new Set(["daArrearsPaid", "transportArrearsPaid", "grossArrear"]);

/** gm camelCase key -> monthly-row snake_case column, e.g. extraWorkAllowancePaid -> extra_work_allowance_paid. */
export function runPayrollSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
