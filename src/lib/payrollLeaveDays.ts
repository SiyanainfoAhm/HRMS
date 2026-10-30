/** Calendar-based leave day display used by previews, workbooks, and payslips. */
export function equivalentPayableDays(calendarDays: number, eolDays: number, hplDays: number): number {
  const calendar = Number.isFinite(Number(calendarDays)) ? Math.max(0, Number(calendarDays)) : 0;
  const eol = Number.isFinite(Number(eolDays)) ? Math.max(0, Number(eolDays)) : 0;
  const hpl = Number.isFinite(Number(hplDays)) ? Math.max(0, Number(hplDays)) : 0;
  return Math.max(0, Math.round((calendar - eol - hpl * 0.5) * 100) / 100);
}

export function leaveSalaryAdjustment(
  basisAmount: number,
  leaveDays: number,
  referenceCalendarDays: number,
  perDayFactor = 1,
): number {
  const basis = Number.isFinite(Number(basisAmount)) ? Math.max(0, Number(basisAmount)) : 0;
  const days = Number.isFinite(Number(leaveDays)) ? Math.max(0, Number(leaveDays)) : 0;
  const calendarDays = Number.isFinite(Number(referenceCalendarDays))
    ? Math.max(1, Number(referenceCalendarDays))
    : 1;
  return Math.round((basis / calendarDays) * days * perDayFactor);
}

export function calendarDaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  return new Date(year, month, 0).getDate();
}
