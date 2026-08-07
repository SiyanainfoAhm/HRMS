/**
 * Shared day-count input helpers (pay days, HPL/EOL days, etc.).
 * Caps entry at 2 digits so values like "030" cannot appear while typing.
 */

export function digitsOnlyMax2(raw: string): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, 2);
}

/** Parse a day field; empty → 0. Clamps to [min, max]. */
export function parseDayCount(raw: string, min = 0, max = 31): number {
  const digits = digitsOnlyMax2(raw);
  if (digits === "") return min;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function formatDayCount(value: number, min = 0, max = 31): string {
  const n = Math.min(max, Math.max(min, Math.floor(Number(value) || 0)));
  return String(n);
}
