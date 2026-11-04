import { roundMoney } from "./money";
import { daysInCalendarMonth, type EolHplReferenceSalary } from "./hplEolDeductions";

export type ReferenceSalaryResult = {
  basic: number;
  da: number;
  hra: number;
  medical: number;
  daysInMonth: number;
  /** Gross Basic of that month. */
  grossBasic: number;
  /** DA % in force for that month after revisions (cirt_da_revision_events), not the rate that month happened to be paid at. */
  daPercent?: number;
  source: "monthly_payroll" | "payroll_master";
  warning?: string;
};

export async function fetchReferenceSalary(
  employeeUserId: string,
  year: number,
  month: number,
): Promise<ReferenceSalaryResult> {
  const params = new URLSearchParams({
    employee_user_id: employeeUserId,
    year: String(year),
    month: String(month),
  });
  const res = await fetch(`/api/payroll/reference-salary?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Failed to load reference salary");
  }
  return {
    basic: roundMoney(Number(data.basic) || 0),
    da: roundMoney(Number(data.da) || 0),
    hra: roundMoney(Number(data.hra) || 0),
    medical: roundMoney(Number(data.medical) || 0),
    daysInMonth: Math.max(1, Math.floor(Number(data.daysInMonth) || daysInCalendarMonth(year, month))),
    grossBasic: roundMoney(Number(data.grossBasic ?? data.basic) || 0),
    daPercent: data.daPercent != null && Number.isFinite(Number(data.daPercent)) ? Number(data.daPercent) : undefined,
    source: data.source === "monthly_payroll" ? "monthly_payroll" : "payroll_master",
    warning: data.warning,
  };
}

export function referenceSalaryToEolHpl(s: ReferenceSalaryResult): EolHplReferenceSalary {
  return { basic: s.basic, da: s.da, hra: s.hra, medical: s.medical };
}
