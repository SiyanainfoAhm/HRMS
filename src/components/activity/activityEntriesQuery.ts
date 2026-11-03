/** Query string and small helpers of the Activity Log list (pure, so they are testable). */

/** A list request that has not answered by then is reported with a Retry instead of loading forever. */
export const ACTIVITY_REQUEST_TIMEOUT_MS = 30_000;

export type ActivityEntriesFilters = {
  module: string;
  actor: string;
  employee: string;
  /** "YYYY-MM" or "". */
  period: string;
  /** "YYYY-MM-DD" or "". */
  from: string;
  to: string;
  page: number;
  perPage: number;
};

/** Server-side filtering and pagination: every filter is a query parameter, nothing is filtered in the browser. */
export function activityEntriesQuery(f: ActivityEntriesFilters): string {
  const p = new URLSearchParams({ page: String(Math.max(1, f.page)), per_page: String(f.perPage) });
  if (f.module) p.set("module", f.module);
  if (f.actor.trim()) p.set("actor", f.actor.trim());
  if (f.employee.trim()) p.set("employee", f.employee.trim());
  const m = /^(\d{4})-(\d{2})$/.exec(f.period);
  if (m) {
    p.set("year", String(Number(m[1])));
    p.set("month", String(Number(m[2])));
  }
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

/** "3 typed, 2 recalculated" above the details table when both kinds exist. */
export function detailSummaryLine(details: Array<{ kind?: string | null }>): string | null {
  const recalculated = details.filter((d) => d.kind === "recalculated").length;
  if (recalculated === 0) return null;
  const typed = details.length - recalculated;
  return `${typed} typed change${typed === 1 ? "" : "s"}, ${recalculated} recalculated`;
}
