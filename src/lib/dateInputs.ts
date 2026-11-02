/**
 * Pure logic behind DateInput / MonthInput. Value contract (unchanged from the native inputs):
 *   date  = "YYYY-MM-DD"   month = "YYYY-MM"   empty = ""
 * Display is Indian: DD/MM/YYYY and "Oct 2026". Everything here is calendar arithmetic on plain strings, so it never
 * depends on the browser's time zone.
 */

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
/** Sunday-first week, as on Indian wall calendars. */
export const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// ---------------------------------------------------------------- dates

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function makeYmd(year: number, month1: number, day: number): string {
  return `${pad(year, 4)}-${pad(month1)}-${pad(day)}`;
}

/** "2026-10-05" -> "05/10/2026"; anything that is not a real date -> "". */
export function formatDmy(ymd: string | null | undefined): string {
  if (!isValidYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export type ParseResult = { ok: true; ymd: string } | { ok: false; reason: "empty" | "incomplete" | "invalid" };

/**
 * Parses typed text. Accepts DD/MM/YYYY (also - or . as separators, and 8 digits "05102026").
 * 31/02/2026, 00/10/2026, 5/13/2026 and 2-digit years are rejected: the field keeps its previous value.
 */
export function parseDmy(text: string): ParseResult {
  const t = text.trim();
  if (t === "") return { ok: false, reason: "empty" };
  let d: number, m: number, y: number;
  const sep = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(t);
  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (sep) [d, m, y] = [Number(sep[1]), Number(sep[2]), Number(sep[3])];
  else if (compact) [d, m, y] = [Number(compact[1]), Number(compact[2]), Number(compact[3])];
  else return { ok: false, reason: /^[\d/.\-\s]*$/.test(t) ? "incomplete" : "invalid" };
  const ymd = makeYmd(y, m, d);
  return isValidYmd(ymd) ? { ok: true, ymd } : { ok: false, reason: "invalid" };
}

/** Live typing helper: keeps digits and inserts the slashes (0510 -> 05/10, 05102026 -> 05/10/2026). */
export function maskDmyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export type RangeCheck = "ok" | "before-min" | "after-max";

export function checkYmdInRange(ymd: string, min?: string | null, max?: string | null): RangeCheck {
  if (min && isValidYmd(min) && ymd < min) return "before-min";
  if (max && isValidYmd(max) && ymd > max) return "after-max";
  return "ok";
}

export function rangeMessage(check: RangeCheck, min?: string | null, max?: string | null): string {
  if (check === "before-min") return `Date must be on or after ${formatDmy(min)}`;
  if (check === "after-max") return `Date must be on or before ${formatDmy(max)}`;
  return "";
}

export function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return makeYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Moves by whole months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return makeYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Clamps a date into [min, max] (used to place the calendar and keyboard focus). */
export function clampYmd(ymd: string, min?: string | null, max?: string | null): string {
  if (min && isValidYmd(min) && ymd < min) return min;
  if (max && isValidYmd(max) && ymd > max) return max;
  return ymd;
}

/** 6 weeks x 7 days for a month, Sunday first. Days outside the month are null. */
export function calendarWeeks(year: number, month1: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  const total = daysInMonth(year, month1);
  const cells: (string | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(makeYmd(year, month1, d));
  while (cells.length < 42) cells.push(null);
  return Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

// ---------------------------------------------------------------- months

export function isValidYm(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12;
}

export function makeYm(year: number, month1: number): string {
  return `${pad(year, 4)}-${pad(month1)}`;
}

/** "2026-10" -> "Oct 2026"; invalid -> "". */
export function formatMonthLabel(ym: string | null | undefined): string {
  if (!isValidYm(ym)) return "";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

export function addMonthsToYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return makeYm(Math.floor(idx / 12), (idx % 12) + 1);
}

export type MonthRules = {
  min?: string | null;
  max?: string | null;
  /** When given, only these months can be picked (e.g. months with generated payroll). */
  available?: ReadonlySet<string> | readonly string[] | null;
  /** Tooltip for months that are not in `available`. */
  unavailableReason?: string;
};

/** Why a month cannot be picked, or null when it can. Powers the disabled state and its title. */
export function monthDisabledReason(ym: string, rules: MonthRules): string | null {
  if (rules.min && isValidYm(rules.min) && ym < rules.min) return `Before ${formatMonthLabel(rules.min)}`;
  if (rules.max && isValidYm(rules.max) && ym > rules.max) return `After ${formatMonthLabel(rules.max)}`;
  if (rules.available) {
    const set = rules.available instanceof Set ? rules.available : new Set(rules.available as readonly string[]);
    if (!set.has(ym)) return rules.unavailableReason ?? "Not available";
  }
  return null;
}

/**
 * TDS from/to rule: "to" can never be before "from". If either side moves so that to < from, "to" is cleared
 * (optional field) and the user chooses the end again; the From value is never overwritten.
 */
export function reconcileMonthRange(next: { from: string; to: string }): { from: string; to: string } {
  const { from, to } = next;
  if (!isValidYm(from) || !isValidYm(to)) return { from, to };
  if (to >= from) return next;
  return { from, to: "" };
}

// ---------------------------------------------------------------- display of timestamps (activity tables)

const IST = "Asia/Kolkata";

/** "02/11/2026" in IST, from an ISO timestamp. */
export function formatDmyFromIso(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

/** "3:22 pm" in IST (12-hour, lower-case am/pm, like the rest of the app). */
export function formatTime12FromIso(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(t).replace(/\s?(AM|PM)/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
}

/** "02/11/2026, 3:22 pm" */
export function formatDmyTimeFromIso(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "—";
  return `${formatDmyFromIso(iso)}, ${formatTime12FromIso(iso)}`;
}
