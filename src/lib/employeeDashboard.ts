/** Shared types and formatters for the employee dashboard. */

export type EmployeePayrollHistoryRow = {
  id: string;
  month: number;
  year: number;
  periodMonth: string;
  periodLabel: string;
  grossEarnings: number;
  deductions: number;
  netPay: number;
  payDays: number;
  workingDays: number;
  status: string;
  generatedAt?: string | null;
};

export type EmployeeLatestPayroll = EmployeePayrollHistoryRow & {
  periodFormatted?: string;
};

export type EmployeePayrollMaster = {
  employeeCode?: string;
  name?: string;
  designation?: string;
  department?: string;
  division?: string;
  payLevel?: number;
  dateOfJoining?: string;
  incrementMonth?: string;
  status?: string;
  grossBasicPay?: number;
  daPercent?: number;
  hraPercent?: number;
  daAmount?: number;
  hraAmount?: number;
  medical?: number;
  transportTotal?: number;
  totalEarnings?: number;
  cpfEffective?: number;
  professionalTax?: number;
  incomeTax?: number;
  takeHome?: number;
  hasQuarter?: boolean;
  quarterName?: string | null;
  quarterType?: string | null;
  quarterRent?: number;
  quarterAssigned?: boolean;
};

export type EmployeeProfileUser = {
  id?: string;
  name?: string;
  email?: string;
  employeeCode?: string;
  designation?: string;
  departmentId?: string;
  divisionId?: string;
  dateOfJoining?: string;
  employmentStatus?: string;
  role?: string;
};

export function fmtInr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

export function fmtNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("en-IN");
}

export function currentMonthYearLabel(): string {
  const now = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

export function monthName(month: number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[Math.max(0, Math.min(11, month - 1))] ?? String(month);
}
