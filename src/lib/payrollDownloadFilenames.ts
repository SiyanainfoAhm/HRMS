/** Short English month labels (1–12). */
const SHORT_MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format payroll period for download filenames.
 * Accepts month as 1–12 (number or numeric string like "09").
 * Returns e.g. "Sep 2026".
 */
export function formatPayrollMonthYear(month: number | string, year: number | string): string {
  const m = typeof month === "string" ? parseInt(month, 10) : month;
  const y = typeof year === "string" ? parseInt(year, 10) : year;
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error(`Invalid payroll month/year: ${month}/${year}`);
  }
  return `${SHORT_MONTHS[m]} ${y}`;
}

/** Detailed Run Payroll workbook, e.g. "Sep 2026.xlsx" */
export function payrollDetailWorkbookFilename(month: number | string, year: number | string): string {
  return `${formatPayrollMonthYear(month, year)}.xlsx`;
}

/** Monthly summary / Extract workbook, e.g. "Extract Sep 2026.xlsx" */
export function payrollExtractWorkbookFilename(month: number | string, year: number | string): string {
  return `Extract ${formatPayrollMonthYear(month, year)}.xlsx`;
}

/** HDFC bank salary letter, e.g. "Bank Letter Sep 2026.docx" */
export function payrollBankLetterFilename(month: number | string, year: number | string): string {
  return `Bank Letter ${formatPayrollMonthYear(month, year)}.docx`;
}

/** Bank letter Excel, e.g. "Bank Letter Sep 2026.xlsx" */
export function payrollBankLetterExcelFilename(month: number | string, year: number | string): string {
  return `Bank Letter ${formatPayrollMonthYear(month, year)}.xlsx`;
}

/** Bank letter PDF, e.g. "Bank Letter Sep 2026.pdf" */
export function payrollBankLetterPdfFilename(month: number | string, year: number | string): string {
  return `Bank Letter ${formatPayrollMonthYear(month, year)}.pdf`;
}
