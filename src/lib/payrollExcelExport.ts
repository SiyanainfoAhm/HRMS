import type { GovernmentMonthlyComputed } from "@/lib/governmentPayroll";

/** Excel column order: identity + government payslip lines + legacy bank columns. */
export const PAYROLL_EXCEL_HEADER = [
  "AccountNumber",
  "EmployeeName",
  "PayrollMode",
  "PayLevel",
  "PayDays",
  "Basic",
  "DA",
  "HRA",
  "Medical",
  "TransportTA",
  "SPPay",
  "ExtraWorkAllowance",
  "NightAllowance",
  "UniformAllowance",
  "EducationAllowance",
  "DAArrears",
  "TransportArrears",
  "Encashment",
  "EncashmentDA",
  "GrossTotal",
  "IncomeTax",
  "PT",
  "LIC",
  "CPF",
  "DACPF",
  "VPF",
  "PFLoan",
  "PostOffice",
  "CreditSociety",
  "StdLicenceFee",
  "Electricity",
  "Water",
  "Mess",
  "Horticulture",
  "Welfare",
  "VehCharge",
  "OtherDeduction",
  "TotalDeductions",
  "NetSalary",
  "CTC",
  "Incentive",
  "PRBonus",
  "Reimbursement",
  "TDS",
  "EmployeePF",
  "EmployerPF",
  "EmployeeESIC",
  "EmployerESIC",
  "NetPay",
  "ProfessionalTax",
  "TakeHome",
] as const;

export type PayrollExcelHeader = (typeof PAYROLL_EXCEL_HEADER)[number];

type PayslipExcelInput = {
  payroll_mode?: string | null;
  employee_user_id: string;
  bank_account_number?: string | null;
  ctc?: number | null;
  gross_pay?: number | null;
  net_pay?: number | null;
  pay_days?: number | null;
  basic?: number | null;
  hra?: number | null;
  medical?: number | null;
  trans?: number | null;
  lta?: number | null;
  personal?: number | null;
  deductions?: number | null;
  pf_employee?: number | null;
  pf_employer?: number | null;
  esic_employee?: number | null;
  esic_employer?: number | null;
  professional_tax?: number | null;
  incentive?: number | null;
  pr_bonus?: number | null;
  reimbursement?: number | null;
  tds?: number | null;
};

/** Row from HRMS_government_monthly_payroll (Supabase shape). */
export type GovernmentMonthlyRow = {
  pay_level?: number | null;
  basic_paid?: number | null;
  da_paid?: number | null;
  hra_paid?: number | null;
  medical_paid?: number | null;
  transport_paid?: number | null;
  sp_pay_paid?: number | null;
  extra_work_allowance_paid?: number | null;
  night_allowance_paid?: number | null;
  uniform_allowance_paid?: number | null;
  education_allowance_paid?: number | null;
  da_arrears_paid?: number | null;
  transport_arrears_paid?: number | null;
  encashment_paid?: number | null;
  encashment_da_paid?: number | null;
  income_tax_amount?: number | null;
  pt_amount?: number | null;
  lic_amount?: number | null;
  cpf_amount?: number | null;
  da_cpf_amount?: number | null;
  vpf_amount?: number | null;
  pf_loan_amount?: number | null;
  post_office_amount?: number | null;
  credit_society_amount?: number | null;
  std_licence_fee_amount?: number | null;
  electricity_amount?: number | null;
  water_amount?: number | null;
  mess_amount?: number | null;
  horticulture_amount?: number | null;
  welfare_amount?: number | null;
  veh_charge_amount?: number | null;
  other_deduction_amount?: number | null;
  total_earnings?: number | null;
  total_deductions?: number | null;
  net_salary?: number | null;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function govFromComputed(c: GovernmentMonthlyComputed, payLevel: number): Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> {
  const d = c.deductions;
  return {
    PayrollMode: "government",
    PayLevel: payLevel,
    PayDays: 0,
    Basic: c.basicPaid,
    DA: c.daPaid,
    HRA: c.hraPaid,
    Medical: c.medicalPaid,
    TransportTA: c.transportPaid,
    SPPay: c.spPayPaid,
    ExtraWorkAllowance: c.extraWorkAllowancePaid,
    NightAllowance: c.nightAllowancePaid,
    UniformAllowance: c.uniformAllowancePaid,
    EducationAllowance: c.educationAllowancePaid,
    DAArrears: c.daArrearsPaid,
    TransportArrears: c.transportArrearsPaid,
    Encashment: c.encashmentPaid,
    EncashmentDA: c.encashmentDaPaid,
    GrossTotal: c.totalEarnings,
    IncomeTax: d.incomeTax,
    PT: d.pt,
    LIC: d.lic,
    CPF: d.cpf,
    DACPF: d.daCpf,
    VPF: d.vpf,
    PFLoan: d.pfLoan,
    PostOffice: d.postOffice,
    CreditSociety: d.creditSociety,
    StdLicenceFee: d.stdLicenceFee,
    Electricity: d.electricity,
    Water: d.water,
    Mess: d.mess,
    Horticulture: d.horticulture,
    Welfare: d.welfare,
    VehCharge: d.vehCharge,
    OtherDeduction: d.other,
    TotalDeductions: c.totalDeductions,
    NetSalary: c.netSalary,
    CTC: 0,
    Incentive: 0,
    PRBonus: 0,
    Reimbursement: 0,
    TDS: 0,
    EmployeePF: 0,
    EmployerPF: 0,
    EmployeeESIC: 0,
    EmployerESIC: 0,
    NetPay: 0,
    ProfessionalTax: 0,
    TakeHome: 0,
  };
}

function govFromDbRow(r: GovernmentMonthlyRow): Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> {
  return {
    PayrollMode: "government",
    PayLevel: n(r.pay_level),
    PayDays: 0,
    Basic: n(r.basic_paid),
    DA: n(r.da_paid),
    HRA: n(r.hra_paid),
    Medical: n(r.medical_paid),
    TransportTA: n(r.transport_paid),
    SPPay: n(r.sp_pay_paid),
    ExtraWorkAllowance: n(r.extra_work_allowance_paid),
    NightAllowance: n(r.night_allowance_paid),
    UniformAllowance: n(r.uniform_allowance_paid),
    EducationAllowance: n(r.education_allowance_paid),
    DAArrears: n(r.da_arrears_paid),
    TransportArrears: n(r.transport_arrears_paid),
    Encashment: n(r.encashment_paid),
    EncashmentDA: n(r.encashment_da_paid),
    GrossTotal: n(r.total_earnings),
    IncomeTax: n(r.income_tax_amount),
    PT: n(r.pt_amount),
    LIC: n(r.lic_amount),
    CPF: n(r.cpf_amount),
    DACPF: n(r.da_cpf_amount),
    VPF: n(r.vpf_amount),
    PFLoan: n(r.pf_loan_amount),
    PostOffice: n(r.post_office_amount),
    CreditSociety: n(r.credit_society_amount),
    StdLicenceFee: n(r.std_licence_fee_amount),
    Electricity: n(r.electricity_amount),
    Water: n(r.water_amount),
    Mess: n(r.mess_amount),
    Horticulture: n(r.horticulture_amount),
    Welfare: n(r.welfare_amount),
    VehCharge: n(r.veh_charge_amount),
    OtherDeduction: n(r.other_deduction_amount),
    TotalDeductions: n(r.total_deductions),
    NetSalary: n(r.net_salary),
    CTC: 0,
    Incentive: 0,
    PRBonus: 0,
    Reimbursement: 0,
    TDS: 0,
    EmployeePF: 0,
    EmployerPF: 0,
    EmployeeESIC: 0,
    EmployerESIC: 0,
    NetPay: 0,
    ProfessionalTax: 0,
    TakeHome: 0,
  };
}

export type GovernmentExcelSource =
  | { kind: "computed"; payLevel: number; comp: GovernmentMonthlyComputed }
  | { kind: "row"; row: GovernmentMonthlyRow };

/**
 * One payroll Excel row: government line items when mode is government (from computed run or DB row),
 * plus legacy PF/ESIC columns. TakeHome matches stored payslip net_pay (final credit).
 */
export function buildPayrollExcelRow(
  p: PayslipExcelInput,
  userName: string,
  gov: GovernmentExcelSource | null | undefined,
): Record<PayrollExcelHeader, string | number> {
  const accountNum = p.bank_account_number != null ? String(p.bank_account_number) : "";
  const mode = p.payroll_mode === "government" ? "government" : "private";

  const basePrivate: Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> = {
    PayrollMode: mode,
    PayLevel: 0,
    PayDays: n(p.pay_days),
    Basic: n(p.basic),
    DA: 0,
    HRA: n(p.hra),
    Medical: n(p.medical),
    TransportTA: n(p.trans),
    SPPay: 0,
    ExtraWorkAllowance: 0,
    NightAllowance: 0,
    UniformAllowance: 0,
    EducationAllowance: 0,
    DAArrears: 0,
    TransportArrears: 0,
    Encashment: 0,
    EncashmentDA: 0,
    GrossTotal: n(p.gross_pay),
    IncomeTax: n(p.tds),
    PT: n(p.professional_tax),
    LIC: 0,
    CPF: 0,
    DACPF: 0,
    VPF: 0,
    PFLoan: 0,
    PostOffice: 0,
    CreditSociety: 0,
    StdLicenceFee: 0,
    Electricity: 0,
    Water: 0,
    Mess: 0,
    Horticulture: 0,
    Welfare: 0,
    VehCharge: 0,
    OtherDeduction: 0,
    TotalDeductions: n(p.deductions),
    NetSalary: Math.round(n(p.gross_pay) - n(p.deductions)),
    CTC: n(p.ctc),
    Incentive: n(p.incentive),
    PRBonus: n(p.pr_bonus),
    Reimbursement: n(p.reimbursement),
    TDS: n(p.tds),
    EmployeePF: n(p.pf_employee),
    EmployerPF: n(p.pf_employer),
    EmployeeESIC: n(p.esic_employee),
    EmployerESIC: n(p.esic_employer),
    NetPay: n(p.net_pay),
    ProfessionalTax: n(p.professional_tax),
    TakeHome: n(p.net_pay),
  };

  let body: Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName">;

  if (mode === "government" && gov) {
    const g =
      gov.kind === "computed"
        ? govFromComputed(gov.comp, gov.payLevel)
        : govFromDbRow(gov.row);
    body = {
      ...g,
      PayDays: n(p.pay_days),
      CTC: n(p.ctc),
      Incentive: n(p.incentive),
      PRBonus: n(p.pr_bonus),
      Reimbursement: n(p.reimbursement),
      TDS: n(p.tds),
      // CPF / DA CPF / VPF / PF loan columns carry statutory deductions; payslip pf_employee is the same bundle — omit from legacy PF columns.
      EmployeePF: 0,
      EmployerPF: 0,
      EmployeeESIC: n(p.esic_employee),
      EmployerESIC: n(p.esic_employer),
      NetPay: n(p.net_pay),
      ProfessionalTax: n(p.professional_tax),
      TakeHome: n(p.net_pay),
    };
  } else {
    body = basePrivate;
  }

  return {
    AccountNumber: accountNum,
    EmployeeName: userName,
    ...body,
  };
}

/** 0-based column indices to center (all numeric / mode after name). */
export function payrollExcelAmountColumnIndices(): number[] {
  const skip = 2; // AccountNumber, EmployeeName — keep default alignment
  return Array.from({ length: PAYROLL_EXCEL_HEADER.length - skip }, (_, i) => i + skip);
}
