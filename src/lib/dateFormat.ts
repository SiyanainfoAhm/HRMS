function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtDmyFromDate(d: Date): string {
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Accepts YYYY-MM-DD (or longer ISO strings) and returns dd-mm-yyyy */
export function fmtDmy(isoOrYmd: string | null | undefined): string {
  const raw = String(isoOrYmd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(isoOrYmd ?? "") || "";
  const [y, m, d] = raw.split("-");
  return `${d}-${m}-${y}`;
}

/** Whole minutes → "2h 15m" (never shows fractional minutes). */
export function formatMinutesAsHours(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

