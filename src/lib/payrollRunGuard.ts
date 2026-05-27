export type PayrollPeriodRow = {
  period_start?: string;
  periodStart?: string;
  payroll_run?: boolean;
  payrollRun?: boolean;
};

export function periodStartFromClaimDate(claimDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(claimDate)) return null;
  return `${claimDate.slice(0, 7)}-01`;
}

export function isPayrollRunForClaimDate(periods: PayrollPeriodRow[], claimDate: string): boolean {
  const periodStart = periodStartFromClaimDate(claimDate);
  if (!periodStart) return false;

  const match = periods.find((row) => {
    const start = String(row.period_start ?? row.periodStart ?? "").slice(0, 10);
    return start === periodStart;
  });

  return Boolean(match?.payroll_run ?? match?.payrollRun);
}
