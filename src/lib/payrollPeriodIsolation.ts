export function payrollPeriodKey(year: number | string, month: number | string): string {
  return `${Number(year)}-${String(Number(month)).padStart(2, "0")}`;
}

export function payrollRowCacheKey(periodKey: string, employeeUserId: string): string {
  return `${periodKey}:${employeeUserId}`;
}

export function freshPayrollLeaveDefaults(year: number, month: number) {
  return {
    eolDays: 0,
    hplDays: 0,
    leaveRemarks: "",
    eolReferenceMonth: month,
    eolReferenceYear: year,
    hplReferenceMonth: month,
    hplReferenceYear: year,
  };
}
