import { formatMoney } from "./money";
/**
 * Month picking for the multi-period TDS Data and Export Employee Payroll reports.
 * Only months with a generated/finalized run are offered (the server lists them); a month is "YYYY-MM".
 */
export type ReportPeriod = { ym: string; year: number; month: number; label: string; periodId: string };

export type PeriodReportType = "tds" | "division-wise" | "employee-payroll";

/** Sorted, de-duplicated month list, as the server expects it ("2026-05,2026-06"). */
export function monthsQuery(selected: readonly string[]): string {
  return [...new Set(selected)].sort().join(",");
}

/** Generated months of the Indian financial year (April to March) that contains `today`. */
export function currentFiscalYearMonths(periods: readonly ReportPeriod[], today: Date = new Date()): string[] {
  const fyStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const from = `${fyStart}-04`;
  const to = `${fyStart + 1}-03`;
  return periods.filter((p) => p.ym >= from && p.ym <= to).map((p) => p.ym);
}

/** The latest `n` generated months. */
export function lastMonths(periods: readonly ReportPeriod[], n: number): string[] {
  return periods.slice(-Math.max(0, n)).map((p) => p.ym);
}

/** Case-insensitive search over the label ("sep 2026", "2026-09", "september"). */
export function filterPeriods(periods: readonly ReportPeriod[], query: string): ReportPeriod[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...periods];
  return periods.filter((p) => p.label.toLowerCase().includes(q) || p.ym.includes(q));
}

/** Newest year first; months newest first inside a year (a long list stays easy to scan). */
export function groupByYear(periods: readonly ReportPeriod[]): Array<{ year: number; periods: ReportPeriod[] }> {
  const byYear = new Map<number, ReportPeriod[]>();
  for (const p of periods) byYear.set(p.year, [...(byYear.get(p.year) ?? []), p]);
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, periods: list.sort((a, b) => b.ym.localeCompare(a.ym)) }));
}

/** Default selection: the currently selected month when it was generated, else nothing (never a draft-only month). */
export function defaultSelection(periods: readonly ReportPeriod[], currentYm: string): string[] {
  return periods.some((p) => p.ym === currentYm) ? [currentYm] : [];
}

/** "3 months: May 2026 – Jul 2026" */
export function selectionSummary(selected: readonly string[], periods: readonly ReportPeriod[]): string {
  const sorted = [...new Set(selected)].sort();
  if (sorted.length === 0) return "No month selected";
  const label = (ym: string) => periods.find((p) => p.ym === ym)?.label ?? ym;
  if (sorted.length === 1) return `1 month: ${label(sorted[0])}`;
  return `${sorted.length} months: ${label(sorted[0])} – ${label(sorted[sorted.length - 1])}`;
}

export function periodReportPreviewUrl(type: PeriodReportType, selected: readonly string[], employeeUserIds?: string): string {
  const p = new URLSearchParams({ months: monthsQuery(selected) });
  if (employeeUserIds) p.set("employeeUserIds", employeeUserIds);
  return `/api/payroll/period-report/${type}?${p.toString()}`;
}

export type PeriodReportPreviewData = {
  type: PeriodReportType;
  months: string[];
  rangeLabel: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  totals: Array<string | number | null>;
  moneyColumns: number[];
  rowCount: number;
};

/** Cell text for the preview: money as whole rupees (Indian grouping), everything else as is. */
export function previewCell(value: string | number | null | undefined, isMoney: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  if (isMoney && typeof value === "number") return formatMoney(value);
  return String(value);
}
