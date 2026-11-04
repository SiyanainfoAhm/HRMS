import { isValidYm } from "@/lib/dateInputs";

/**
 * The four post-payroll Excel reports. The export itself is built by the backend (PostPayrollDownloadService);
 * this module only asks for it and saves the file under the name the server sends.
 */
export type PostPayrollReportType = "tds" | "cpf" | "division-wise" | "paybill";

export const POST_PAYROLL_REPORTS: ReadonlyArray<{
  type: PostPayrollReportType;
  label: string;
  description: string;
}> = [
  { type: "tds", label: "TDS Data", description: "One row per employee per month" },
  { type: "cpf", label: "CPF / VPF Statement", description: "CPF and VPF for the month, with totals" },
  { type: "division-wise", label: "Division-Wise Salary", description: "Employees under each division, with subtotals" },
  { type: "paybill", label: "Paybill", description: "Earnings, deductions and net pay per employee" },
];

/** "2026-09" -> { year: "2026", month: "9" } */
function splitYm(ym: string): { year: string; month: string } {
  const [y, m] = ym.split("-");
  return { year: y, month: String(Number(m)) };
}

/** Same query the Post Payroll Downloads page always sent. `toYm` only applies to the TDS range. */
export function postPayrollReportUrl(type: PostPayrollReportType, ym: string, toYm?: string | null): string {
  if (!isValidYm(ym)) throw new Error("Choose a valid month.");
  const from = splitYm(ym);
  const p = new URLSearchParams({ year: from.year, month: from.month });
  if (type === "tds" && toYm) {
    if (!isValidYm(toYm)) throw new Error("Choose a valid To month.");
    if (toYm < ym) throw new Error("The To month cannot be before the From month.");
    const to = splitYm(toYm);
    p.set("to_year", to.year);
    p.set("to_month", to.month);
  }
  return `/api/payroll/post-downloads/${type}?${p.toString()}`;
}

/** TDS Data or Division-Wise Salary for any set of generated months ("2026-05,2026-06"): one request, one workbook. */
export function reportMonthsUrl(type: "tds" | "division-wise", months: readonly string[]): string {
  const list = [...new Set(months)].sort();
  if (list.length === 0) throw new Error("Select at least one month.");
  if (list.some((m) => !isValidYm(m))) throw new Error("Choose valid months.");
  return `/api/payroll/post-downloads/${type}?months=${list.join(",")}`;
}

export function tdsMonthsUrl(months: readonly string[]): string {
  return reportMonthsUrl("tds", months);
}

export async function downloadPostPayrollMonths(type: "tds" | "division-wise", months: readonly string[], fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(reportMonthsUrl(type, months));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || "Could not create the file.");
  }
  const blob = await res.blob();
  const name = fileNameFromDisposition(res.headers.get("content-disposition"), type === "tds" ? "TDS_DATA.xlsx" : "Division_Wise.xlsx");
  saveBlob(blob, name);
  return name;
}

/** Pulls the file name out of a Content-Disposition header. */
export function fileNameFromDisposition(header: string | null | undefined, fallback: string): string {
  const match = header ? /filename="?([^";\n]+)"?/i.exec(header) : null;
  return match?.[1] ?? fallback;
}

/**
 * Saves a blob under a file name. The link is attached to the page (Firefox needs that) and the object URL is released
 * only after the browser has started the download (revoking it in the same tick can cancel the download).
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads one report and resolves with the saved file name. Rejects with the reason shown in the error toast. */
export async function downloadPostPayrollReport(
  type: PostPayrollReportType,
  ym: string,
  toYm?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(postPayrollReportUrl(type, ym, toYm));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || "Could not create the file.");
  }
  const blob = await res.blob();
  const name = fileNameFromDisposition(res.headers.get("content-disposition"), `${type}_${ym.replace("-", "")}.xlsx`);
  saveBlob(blob, name);
  return name;
}
