/**
 * The single money rule for payroll amounts: every line is a WHOLE RUPEE, rounded to the nearest rupee
 * (0.50 rounds up) ONCE per line (CIRT decision). Gross, Total Earnings, Total Deductions and Net are the
 * exact sums of the rounded lines, so they are whole rupees and always add up exactly.
 *
 * Percentage and proration products are worked out in integer paise and rounded a single time, so
 * JavaScript floats cannot drift. To go back to paise, flip MONEY_WHOLE_RUPEES here AND in
 * backend/app/Support/Money.php, and the "rule" in backend/tests/fixtures/money_cases.json (the shared
 * fixture carries the expected value for both rules; both test suites fail if the three disagree).
 * Mirror: backend/app/Support/Money.php.
 */

/** THE switch. true = whole rupees (current rule). false = 2-decimal paise (the previous rule). */
export const MONEY_WHOLE_RUPEES = true;

/** Rounding step in paise: 100 = one rupee, 1 = one paisa. */
export const MONEY_STEP_PAISE = MONEY_WHOLE_RUPEES ? 100 : 1;
/** Decimals shown on screen / in exports. */
export const MONEY_DECIMALS = MONEY_WHOLE_RUPEES ? 0 : 2;
/** Excel number format for a money cell (cells stay numeric). */
export const MONEY_EXCEL_FORMAT = MONEY_WHOLE_RUPEES ? "#,##0" : "#,##0.00";

/** Integer paise nearest to `n` (half up; the tiny bias makes 1.005 count as 1.01, not 1.00). */
export function toPaise(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7));
}

export function fromPaise(paise: number): number {
  return paise / 100;
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

/**
 * Any amount to the money rule: nearest whole rupee, 0.50 up (negatives away from zero). The tiny bias
 * makes a float that is really x.5 (24.499999999999996 from 8.5 x 23.2 / 8 style products) land as x.5.
 */
export function roundMoney(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const unit = MONEY_STEP_PAISE / 100; // 1 rupee or 0.01
  const sign = v < 0 ? -1 : 1;
  const steps = Math.floor(Math.abs(v) / unit + 0.5 + 1e-7);
  const out = sign * steps * unit;
  return MONEY_WHOLE_RUPEES ? out + 0 : Math.round(out * 100) / 100 + 0; // + 0 turns -0 into 0
}

/** True when `n` is already on the money grid (whole rupee under the current rule). */
export function isMoneyRounded(n: number): boolean {
  return roundMoney(n) === Number(n);
}

/** Integer-paise result of `numPaise / denPaise-ish` rounded once to the step, as a money number. */
function stepResult(num: number, den: number): number {
  return (divRoundHalfUp(num, den * MONEY_STEP_PAISE) * MONEY_STEP_PAISE) / 100 + 0;
}

/** amount x percent / 100 rounded once (percent may carry 2 decimals, e.g. 53 or 12.5). */
export function percentOf(amount: number, percent: number): number {
  const hundredths = Math.round((Number(percent) || 0) * 100);
  return stepResult(toPaise(amount) * hundredths, 10000);
}

/**
 * amount x percent / 100 rounded UP to the next whole rupee (ceiling): the CPF rule. Exact integer arithmetic on paise,
 * so 12% of 75,698.00 is 9,083.76 -> 9,084 and an exact amount stays as it is.
 */
export function percentOfCeil(amount: number, percent: number): number {
  const hundredths = Math.round((Number(percent) || 0) * 100);
  const numerator = toPaise(amount) * hundredths; // paise x hundredths-of-a-percent
  if (numerator <= 0) return 0;
  return Math.trunc((numerator + 999999) / 1000000); // / 10,000 (percent) / 100 (paise per rupee), rounded up
}

/** amount x numerator / denominator (pay days / days in month, leave days / calendar days, hours / 8) rounded once. */
export function proportion(amount: number, numerator: number, denominator: number): number {
  const n = Math.round((Number(numerator) || 0) * 100);
  const d = Math.round((Number(denominator) || 0) * 100);
  return stepResult(toPaise(amount) * n, d);
}

/** Sum of money lines: each line is put on the money grid first, so the total is the exact sum of the lines shown. */
export function sumMoney(...values: number[]): number {
  return fromPaise(values.reduce((s, v) => s + toPaise(roundMoney(v)), 0));
}

/** Amount as the number of rounding steps (rupees under the whole-rupee rule) for exact integer allocation. */
export function toSteps(n: number): number {
  return toPaise(roundMoney(n)) / MONEY_STEP_PAISE;
}

export function fromSteps(steps: number): number {
  return (steps * MONEY_STEP_PAISE) / 100;
}

/** On-screen / export text for a money amount: Indian grouping, whole rupees (no .00) under the current rule. */
export function formatMoney(n: number | null | undefined): string {
  const v = roundMoney(Number(n) || 0);
  return v.toLocaleString("en-IN", { minimumFractionDigits: MONEY_DECIMALS, maximumFractionDigits: MONEY_DECIMALS });
}
