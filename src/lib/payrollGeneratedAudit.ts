/**
 * Helpers for Admin audit of already-generated payroll.
 * Canonical source of truth is cirt_monthly_payroll (exposed as governmentMonthly).
 */

export const GENERATED_AUDIT_FIELD_LABELS: Record<string, string> = {
  paidDays: "Days",
  unpaidDays: "Unpaid Days",
  hplDays: "HPL Days",
  eolDays: "EOL Days",
  basicPaid: "Basic",
  spPayPaid: "SP",
  daPaid: "DA",
  transportPaid: "Transport",
  hraPaid: "HRA",
  medicalPaid: "Medical",
  extraWorkAllowancePaid: "EWA",
  nightAllowancePaid: "Night Allowance",
  uniformAllowancePaid: "Uniform",
  educationAllowancePaid: "Education",
  encashmentPaid: "Encashment",
  encashmentDaPaid: "Encashment DA",
  incomeTax: "Income Tax",
  pt: "Professional Tax",
  lic: "LIC",
  cpf: "CPF",
  daCpf: "DA CPF",
  vpf: "VPF",
  pfLoan: "PF Loan",
  postOffice: "Post Office",
  creditSociety: "Credit Society",
  stdLicenceFee: "Std Licence Fee",
  electricity: "Electricity",
  water: "Water",
  mess: "Mess",
  loanRecovery: "Bank Recovery",
  welfare: "Welfare",
  hpl: "HPL",
  eol: "EOL",
  vehCharge: "Vehicle Charge",
  quarterRent: "Quarter Rent",
  other: "Other",
  daArrear: "DA Arrear",
  transportArrear: "Transport Arrear",
  grossArrear: "Gross Arrear",
  cpfArrear: "CPF Arrear",
  netArrear: "Net Arrear",
  customEarnings: "Custom Earnings",
  customDeductions: "Custom Deductions",
  totalEarnings: "Total Earnings",
  totalDeductions: "Total Deductions",
  netSalary: "Net Pay",
  leaveRemarks: "Remarks",
};

export type PayrollAuditChangedField = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

export type PayrollAuditSnapshot = Record<string, unknown>;

function amount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function customMap(v: unknown): Record<string, number> {
  const rec = asRecord(v);
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(rec)) {
    out[k] = amount(val);
  }
  return out;
}

export function snapshotGeneratedPayrollRow(row: Record<string, unknown>): PayrollAuditSnapshot {
  const gm = asRecord(row.governmentMonthly);
  const ded = asRecord(gm.deductions);
  return {
    monthlyPayrollId: String(row.monthlyPayrollId ?? gm.id ?? ""),
    employeeUserId: String(row.employeeUserId ?? ""),
    employeeName: row.employeeName ?? null,
    paidDays: amount(row.payDays ?? gm.paidDays),
    unpaidDays: amount(row.unpaidLeaveDays ?? gm.unpaidDays),
    hplDays: amount(gm.hplDays ?? asRecord(row.govRecalc).hplDays),
    eolDays: amount(gm.eolDays ?? asRecord(row.govRecalc).eolDays),
    basicPaid: amount(gm.basicPaid),
    spPayPaid: amount(gm.spPayPaid),
    daPaid: amount(gm.daPaid),
    transportPaid: amount(gm.transportPaid),
    hraPaid: amount(gm.hraPaid),
    medicalPaid: amount(gm.medicalPaid),
    extraWorkAllowancePaid: amount(gm.extraWorkAllowancePaid),
    nightAllowancePaid: amount(gm.nightAllowancePaid),
    uniformAllowancePaid: amount(gm.uniformAllowancePaid),
    educationAllowancePaid: amount(gm.educationAllowancePaid),
    encashmentPaid: amount(gm.encashmentPaid),
    encashmentDaPaid: amount(gm.encashmentDaPaid),
    incomeTax: amount(ded.incomeTax),
    pt: amount(ded.pt),
    lic: amount(ded.lic),
    cpf: amount(ded.cpf),
    daCpf: amount(ded.daCpf),
    vpf: amount(ded.vpf),
    pfLoan: amount(ded.pfLoan),
    postOffice: amount(ded.postOffice),
    creditSociety: amount(ded.creditSociety),
    stdLicenceFee: amount(ded.stdLicenceFee),
    electricity: amount(ded.electricity),
    water: amount(ded.water),
    mess: amount(ded.mess),
    loanRecovery: amount(ded.loanRecovery),
    welfare: amount(ded.welfare),
    hpl: amount(ded.hpl),
    eol: amount(ded.eol),
    vehCharge: amount(ded.vehCharge),
    quarterRent: amount(ded.quarterRent ?? gm.quarterRent),
    other: amount(ded.other),
    daArrear: amount(row.daArrear ?? gm.daArrearsPaid),
    transportArrear: amount(row.transportArrear ?? gm.transportArrearsPaid),
    grossArrear: amount(row.grossArrear ?? gm.grossArrear),
    cpfArrear: amount(row.cpfArrear ?? gm.cpfArrear),
    netArrear: amount(row.netArrear ?? gm.netArrear),
    customEarnings: customMap(gm.customEarnings),
    customDeductions: customMap(gm.customDeductions),
    totalEarnings: amount(gm.totalEarnings ?? row.grossPay),
    totalDeductions: amount(gm.totalDeductions ?? row.deductions),
    netSalary: amount(gm.netSalary ?? row.netPay),
    leaveRemarks: typeof gm.leaveRemarks === "string" ? gm.leaveRemarks : null,
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a && typeof a === "object" && b && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

export function diffPayrollAuditSnapshots(
  before: PayrollAuditSnapshot,
  after: PayrollAuditSnapshot,
): PayrollAuditChangedField[] {
  const skip = new Set(["monthlyPayrollId", "employeeUserId", "employeeName"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: PayrollAuditChangedField[] = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const prev = before[key];
    const next = after[key];
    if (valuesEqual(prev, next)) continue;
    out.push({
      field: key,
      label: GENERATED_AUDIT_FIELD_LABELS[key] ?? key,
      before: prev,
      after: next,
    });
  }
  return out;
}

export function formatAuditChangeLine(change: PayrollAuditChangedField): string {
  const fmt = (v: unknown) => {
    if (typeof v === "number") return String(v);
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return `${change.label}: ${fmt(change.before)} → ${fmt(change.after)}`;
}

export function rowHasGeneratedPayrollId(row: Record<string, unknown>): boolean {
  const id = String(row.monthlyPayrollId ?? asRecord(row.governmentMonthly).id ?? "");
  return id.length > 0;
}

export function isGeneratedPayrollMonth(preview: {
  alreadyRun?: boolean;
  existingPeriodId?: string | null;
} | null | undefined): boolean {
  return Boolean(preview?.alreadyRun && preview?.existingPeriodId);
}

export function canShowAuditGeneratedAction(opts: {
  alreadyRun?: boolean;
  isAdmin?: boolean;
}): boolean {
  return Boolean(opts.alreadyRun && opts.isAdmin);
}
