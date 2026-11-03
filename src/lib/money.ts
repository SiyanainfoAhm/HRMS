/**
 * The single money rule for calculated payroll amounts: every line is rounded ONCE, half up, to
 * 2 decimals (paise). Percentage and proration products are worked out in integer paise so JavaScript
 * floats cannot drift. Mirror: backend/app/Support/Money.php (same cases in both test suites).
 */

/** Integer paise nearest to `n` (half up; the tiny bias makes 1.005 count as 1.01, not 1.00). */
export function toPaise(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7));
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Any amount to 2 decimals, half up. */
export function round2(n: number): number {
  return fromPaise(toPaise(n));
}

/** Integer division rounded half up (away from zero for negatives); exact for |num| < 2^53. */
export function divRoundHalfUp(num: number, den: number): number {
  if (den <= 0) return 0;
  if (num < 0) return -divRoundHalfUp(-num, den);
  const n = 2 * num + den;
  const d = 2 * den;
  let q = Math.floor(n / d);
  const r = n - q * d;
  if (r < 0) q -= 1;
  else if (r >= d) q += 1;
  return q;
}

/** amount x percent / 100, in integer paise (percent may carry 2 decimals, e.g. 53 or 12.5). */
export function percentOf(amount: number, percent: number): number {
  const hundredths = Math.round((Number(percent) || 0) * 100);
  return fromPaise(divRoundHalfUp(toPaise(amount) * hundredths, 10000));
}

/** amount x numerator / denominator (pay days / days in month, leave days / calendar days), in integer paise. */
export function proportion(amount: number, numerator: number, denominator: number): number {
  const n = Math.round((Number(numerator) || 0) * 100);
  const d = Math.round((Number(denominator) || 0) * 100);
  return fromPaise(divRoundHalfUp(toPaise(amount) * n, d));
}

/** Sum of 2-decimal lines, exact (no float drift). */
export function sumMoney(...values: number[]): number {
  return fromPaise(values.reduce((s, v) => s + toPaise(v), 0));
}
