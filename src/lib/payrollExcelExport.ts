import type { GovernmentMonthlyComputed } from "@/lib/governmentPayroll";

/** Run Payroll Excel export — no duplicate PT/Professional Tax or TakeHome/Net Pay columns. */
export const PAYROLL_EXCEL_HEADER = [
  "AccountNumber",
  "EmployeeName",
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
  "NightHours",
  "NightAllowanceRate",
  "UniformAllowance",
  "EducationAllowance",
  "DAArrears",
  "TransportArrears",
  "Encashment",
  "EncashmentDA",
  "GrossTotal",
  "IncomeTax",
  "LIC",
  "CPF",
  "DACPF",
  "VPF",
  "PFLoan",
  "PostOffice",
  "CreditSociety",
  "StdLicenceFee",
  "Electricity",
  "ElectricityUnits",
  "ElectricityUnitRate",
  "Water",
  "Mess",
  "BankRecovery",
  "Welfare",
  "HPL",
  "EOL",
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
  "ProfessionalTax",
  "QuarterAssigned",
  "QuarterName",
  "QuarterType",
  "QuarterRent",
  "QuarterRentDeduction",
  "NetPay",
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

/** Row from cirt_monthly_payroll table. */
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
  electricity_units_consumed?: number | null;
  electricity_unit_rate?: number | null;
  night_hours?: number | null;
  night_allowance_rate?: number | null;
  night_allowance_amount?: number | null;
  water_amount?: number | null;
  mess_amount?: number | null;
  loan_recovery_amount?: number | null;
  horticulture_amount?: number | null;
  welfare_amount?: number | null;
  hpl_amount?: number | null;
  eol_amount?: number | null;
  veh_charge_amount?: number | null;
  other_deduction_amount?: number | null;
  total_earnings?: number | null;
  total_deductions?: number | null;
  net_salary?: number | null;
  custom_earnings?: unknown;
  custom_deductions?: unknown;
  has_quarter?: boolean | null;
  quarter_name?: string | null;
  quarter_type?: string | null;
  quarter_rent_amount?: number | null;
};

/** Dynamic columns appended after fixed headers (admin-configured earning/deduction fields). */
export type DynamicPayrollExcelColumn = { key: string; label: string };

function parseCustomBag(raw: unknown): Record<string, number> {
  if (raw == null || raw === "") return {};
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function titleFromFieldKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Collect unique dynamic field keys from government monthly rows for export. */
export function collectDynamicPayrollExcelColumns(
  govRows: Array<Record<string, unknown>>,
  fieldLabelByKey?: Map<string, string>,
): DynamicPayrollExcelColumn[] {
  const seen = new Set<string>();
  const cols: DynamicPayrollExcelColumn[] = [];
  for (const g of govRows) {
    for (const bag of [
      parseCustomBag(g.customEarnings ?? g.custom_earnings),
      parseCustomBag(g.customDeductions ?? g.custom_deductions),
    ]) {
      for (const key of Object.keys(bag)) {
        if (seen.has(key)) continue;
        seen.add(key);
        cols.push({
          key: `dyn_${key}`,
          label: fieldLabelByKey?.get(key) ?? titleFromFieldKey(key),
        });
      }
    }
  }
  return cols;
}

export function buildPayrollExcelHeaders(dynamicCols: DynamicPayrollExcelColumn[] = []): string[] {
  return [...PAYROLL_EXCEL_HEADER, ...dynamicCols.map((c) => c.label)];
}

function dynamicValuesFromGov(
  gov: GovernmentMonthlyRow | null | undefined,
  dynamicCols: DynamicPayrollExcelColumn[],
): Record<string, number | string> {
  if (!gov || dynamicCols.length === 0) return {};
  const earnings = parseCustomBag(gov.custom_earnings);
  const deductions = parseCustomBag(gov.custom_deductions);
  const merged = { ...earnings, ...deductions };
  const out: Record<string, number | string> = {};
  for (const col of dynamicCols) {
    const fieldKey = col.key.replace(/^dyn_/, "");
    out[col.label] = merged[fieldKey] ?? 0;
  }
  return out;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

type QuarterExcelFields = Pick<
  Record<PayrollExcelHeader, string | number>,
  "QuarterAssigned" | "QuarterName" | "QuarterType" | "QuarterRent" | "QuarterRentDeduction"
>;

function quarterExcelColumns(opts: {
  hasQuarter?: boolean | null;
  quarterName?: string | null;
  quarterType?: string | null;
  quarterRent?: number | null;
}): QuarterExcelFields {
  const hasQuarter = Boolean(opts.hasQuarter);
  const rent = n(opts.quarterRent);
  return {
    QuarterAssigned: hasQuarter ? "Yes" : "No",
    QuarterName: String(opts.quarterName ?? ""),
    QuarterType: String(opts.quarterType ?? ""),
    QuarterRent: rent,
    QuarterRentDeduction: rent,
  };
}

function govFromComputed(
  c: GovernmentMonthlyComputed,
  payLevel: number,
): Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> {
  const d = c.deductions;
  return {
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
    NightHours: c.nightHours ?? 0,
    NightAllowanceRate: c.nightAllowanceRate ?? 0,
    UniformAllowance: c.uniformAllowancePaid,
    EducationAllowance: c.educationAllowancePaid,
    DAArrears: c.daArrearsPaid,
    TransportArrears: c.transportArrearsPaid,
    Encashment: c.encashmentPaid,
    EncashmentDA: c.encashmentDaPaid,
    GrossTotal: c.totalEarnings,
    IncomeTax: d.incomeTax,
    LIC: d.lic,
    CPF: d.cpf,
    DACPF: d.daCpf,
    VPF: d.vpf,
    PFLoan: d.pfLoan,
    PostOffice: d.postOffice,
    CreditSociety: d.creditSociety,
    StdLicenceFee: d.stdLicenceFee,
    Electricity: d.electricity,
    ElectricityUnits: c.electricityUnitsConsumed ?? 0,
    ElectricityUnitRate: c.electricityUnitRate ?? 0,
    Water: d.water,
    Mess: d.mess,
    BankRecovery: d.loanRecovery,
    Welfare: d.welfare,
    HPL: d.hpl,
    EOL: d.eol,
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
    ProfessionalTax: d.pt,
    ...quarterExcelColumns({
      hasQuarter: c.hasQuarter,
      quarterRent: c.quarterRent,
    }),
    NetPay: c.netSalary,
  };
}

function govFromDbRow(
  r: GovernmentMonthlyRow,
): Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> {
  return {
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
    NightHours: n(r.night_hours),
    NightAllowanceRate: n(r.night_allowance_rate),
    UniformAllowance: n(r.uniform_allowance_paid),
    EducationAllowance: n(r.education_allowance_paid),
    DAArrears: n(r.da_arrears_paid),
    TransportArrears: n(r.transport_arrears_paid),
    Encashment: n(r.encashment_paid),
    EncashmentDA: n(r.encashment_da_paid),
    GrossTotal: n(r.total_earnings),
    IncomeTax: n(r.income_tax_amount),
    LIC: n(r.lic_amount),
    CPF: n(r.cpf_amount),
    DACPF: n(r.da_cpf_amount),
    VPF: n(r.vpf_amount),
    PFLoan: n(r.pf_loan_amount),
    PostOffice: n(r.post_office_amount),
    CreditSociety: n(r.credit_society_amount),
    StdLicenceFee: n(r.std_licence_fee_amount),
    Electricity: n(r.electricity_amount),
    ElectricityUnits: n(r.electricity_units_consumed),
    ElectricityUnitRate: n(r.electricity_unit_rate),
    Water: n(r.water_amount),
    Mess: n(r.mess_amount),
    BankRecovery: n(r.loan_recovery_amount ?? r.horticulture_amount),
    Welfare: n(r.welfare_amount),
    HPL: n(r.hpl_amount),
    EOL: n(r.eol_amount),
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
    ProfessionalTax: n(r.pt_amount),
    ...quarterExcelColumns({
      hasQuarter: r.has_quarter,
      quarterName: r.quarter_name,
      quarterType: r.quarter_type,
      quarterRent: r.quarter_rent_amount,
    }),
    NetPay: n(r.net_salary),
  };
}

export type GovernmentExcelSource =
  | { kind: "computed"; payLevel: number; comp: GovernmentMonthlyComputed }
  | { kind: "row"; row: GovernmentMonthlyRow };

/**
 * One payroll Excel row: government line items when mode is government (from computed run or DB row),
 * plus legacy PF/ESIC columns. Net Pay is the final payable amount (no separate TakeHome column).
 */
export function buildPayrollExcelRow(
  p: PayslipExcelInput,
  userName: string,
  gov: GovernmentExcelSource | null | undefined,
  dynamicCols: DynamicPayrollExcelColumn[] = [],
): Record<string, string | number> {
  const accountNum = p.bank_account_number != null ? String(p.bank_account_number) : "";
  const mode = p.payroll_mode === "government" ? "government" : "private";
  const netPay = n(p.net_pay);
  const professionalTax = n(p.professional_tax);

  const basePrivate: Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName"> = {
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
    NightHours: 0,
    NightAllowanceRate: 0,
    UniformAllowance: 0,
    EducationAllowance: 0,
    DAArrears: 0,
    TransportArrears: 0,
    Encashment: 0,
    EncashmentDA: 0,
    GrossTotal: n(p.gross_pay),
    IncomeTax: n(p.tds),
    LIC: 0,
    CPF: 0,
    DACPF: 0,
    VPF: 0,
    PFLoan: 0,
    PostOffice: 0,
    CreditSociety: 0,
    StdLicenceFee: 0,
    Electricity: 0,
    ElectricityUnits: 0,
    ElectricityUnitRate: 0,
    Water: 0,
    Mess: 0,
    BankRecovery: 0,
    Welfare: 0,
    HPL: 0,
    EOL: 0,
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
    ProfessionalTax: professionalTax,
    ...quarterExcelColumns({}),
    NetPay: netPay,
  };

  let body: Omit<Record<PayrollExcelHeader, string | number>, "AccountNumber" | "EmployeeName">;

  if (mode === "government" && gov) {
    const g = gov.kind === "computed" ? govFromComputed(gov.comp, gov.payLevel) : govFromDbRow(gov.row);
    body = {
      ...g,
      PayDays: n(p.pay_days),
      CTC: n(p.ctc),
      Incentive: n(p.incentive),
      PRBonus: n(p.pr_bonus),
      Reimbursement: n(p.reimbursement),
      TDS: n(p.tds),
      EmployeePF: 0,
      EmployerPF: 0,
      EmployeeESIC: n(p.esic_employee),
      EmployerESIC: n(p.esic_employer),
      ProfessionalTax: professionalTax > 0 ? professionalTax : n(g.ProfessionalTax),
      NetPay: netPay > 0 ? netPay : n(g.NetPay),
    };
  } else {
    body = basePrivate;
  }

  const govRow = gov?.kind === "row" ? gov.row : null;
  const quarterExport = quarterExportFromGov(govRow);

  return {
    AccountNumber: accountNum,
    EmployeeName: userName,
    ...body,
    ...dynamicValuesFromGov(govRow, dynamicCols),
    ...quarterExport,
  };
}

function quarterExportFromGov(gov: GovernmentMonthlyRow | null | undefined): QuarterExcelFields {
  if (!gov) return quarterExcelColumns({});
  return quarterExcelColumns({
    hasQuarter: gov.has_quarter,
    quarterName: gov.quarter_name,
    quarterType: gov.quarter_type,
    quarterRent: gov.quarter_rent_amount,
  });
}

/** Columns that must not appear in Run Payroll export (duplicate / deprecated labels). */
export const PAYROLL_EXCEL_REMOVED_COLUMNS = ["PayrollMode", "PT", "TakeHome"] as const;

/** 0-based column indices to center (all numeric fields after name). */
export function payrollExcelAmountColumnIndices(headerCount: number): number[] {
  const skip = 2;
  return Array.from({ length: Math.max(0, headerCount - skip) }, (_, i) => i + skip);
}
