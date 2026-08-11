/**
 * Effective payroll value resolution.
 * Treats 0 as a real value; only null/undefined are missing.
 */

export function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function hasOwn<T extends object>(obj: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Priority chain for Run Payroll / Master effective amounts.
 * Pass overrides in priority order (manual → draft → calculated → master → default).
 */
export function resolveEffectivePayrollValue(
  ...candidates: Array<number | null | undefined>
): number {
  const v = firstDefined(...candidates);
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a numeric form/input value; empty → undefined (missing), not 0. */
export function parseOptionalNumber(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse amount for persistence; empty/invalid → 0. Explicit 0 stays 0. */
export function parseAmountOrZero(raw: string | number | null | undefined): number {
  const n = parseOptionalNumber(raw);
  return n === undefined ? 0 : Math.max(0, n);
}
