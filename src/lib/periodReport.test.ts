/**
 * Run: npx --yes tsx src/lib/periodReport.test.ts
 *
 * Month picking for the multi-period TDS Data / Export Employee Payroll reports, and the preview cells.
 */
import {
  currentFiscalYearMonths,
  defaultSelection,
  filterPeriods,
  groupByYear,
  lastMonths,
  monthsQuery,
  periodReportPreviewUrl,
  previewCell,
  selectionSummary,
  type ReportPeriod,
} from "./periodReport";
import { tdsMonthsUrl } from "./postPayrollDownload";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mk = (ym: string): ReportPeriod => {
  const [y, m] = ym.split("-").map(Number);
  return { ym, year: y, month: m, label: `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`, periodId: `p-${ym}` };
};
void MONTHS;
const periods = ["2025-11", "2026-03", "2026-04", "2026-05", "2026-06", "2026-09"].map(mk);

// This FY = April to March containing today (here Nov 2026 -> Apr 2026 .. Mar 2027).
assertEq(currentFiscalYearMonths(periods, new Date(2026, 10, 3)), ["2026-04", "2026-05", "2026-06", "2026-09"], "this FY in November");
assertEq(currentFiscalYearMonths(periods, new Date(2026, 1, 10)), ["2025-11", "2026-03"], "this FY in February is the one that started the previous April");
assertEq(currentFiscalYearMonths(periods, new Date(2026, 3, 1)), ["2026-04", "2026-05", "2026-06", "2026-09"], "April starts the new FY");

// Last 3 generated months.
assertEq(lastMonths(periods, 3), ["2026-05", "2026-06", "2026-09"], "last 3 months");
assertEq(lastMonths(periods.slice(0, 2), 3), ["2025-11", "2026-03"], "fewer than 3 available");

// Search is case-insensitive over label and YYYY-MM.
assertEq(filterPeriods(periods, "sep").map((p) => p.ym), ["2026-09"], "search by name");
assertEq(filterPeriods(periods, "2025").map((p) => p.ym), ["2025-11"], "search by year");
assertEq(filterPeriods(periods, "2026-0").length, 5, "search by ym");
assertEq(filterPeriods(periods, "  ").length, 6, "blank search keeps everything");

// Grouped newest year first, months newest first.
assertEq(groupByYear(periods).map((g) => [g.year, g.periods.map((p) => p.ym)]), [[2026, ["2026-09", "2026-06", "2026-05", "2026-04", "2026-03"]], [2025, ["2025-11"]]], "grouped by year");

// Default = the current month only when it was generated; a draft-only month is never selected.
assertEq(defaultSelection(periods, "2026-09"), ["2026-09"], "default is the selected month");
assertEq(defaultSelection(periods, "2026-10"), [], "draft-only month is not selectable");

// Query value is sorted and de-duplicated; summaries and URLs.
assertEq(monthsQuery(["2026-06", "2026-05", "2026-06"]), "2026-05,2026-06", "sorted unique months");
assertEq(selectionSummary(["2026-06", "2026-05", "2026-09"], periods), "3 months: May 2026 – September 2026", "summary");
assertEq(selectionSummary([], periods), "No month selected", "empty summary");
assertEq(periodReportPreviewUrl("tds", ["2026-06", "2026-05"]), "/api/payroll/period-report/tds?months=2026-05%2C2026-06", "preview url");
assertEq(periodReportPreviewUrl("employee-payroll", ["2026-05"], "a,b"), "/api/payroll/period-report/employee-payroll?months=2026-05&employeeUserIds=a%2Cb", "preview url with scope");
assertEq(tdsMonthsUrl(["2026-09", "2026-05"]), "/api/payroll/post-downloads/tds?months=2026-05,2026-09", "TDS download url");
let threw = false;
try { tdsMonthsUrl([]); } catch { threw = true; }
assertEq(threw, true, "no month selected is rejected");

// Preview cells: money is shown in whole rupees, text is untouched, blanks stay blank.
assertEq(previewCell(1234567.5, true), "12,34,568", "Indian grouping, whole rupees (0.50 rounds up)");
assertEq(previewCell(1234567, true), "12,34,567", "no .00");
assertEq(previewCell(null, true), "", "blank");
assertEq(previewCell("May 2026", false), "May 2026", "text");
assertEq(previewCell(2026, false), "2026", "year is not money");

console.log("periodReport.test.ts passed");
