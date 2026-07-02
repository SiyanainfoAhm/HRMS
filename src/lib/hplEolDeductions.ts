/**
 * HPL (Half Pay Leave) and EOL (Extra Ordinary Leave) — reduce paid earnings, not separate deductions.
 *
 * EOL: each day reduces Basic, DA, HRA, and Transport by one day's pay.
 * HPL: each 2 HPL days = 1 day's salary effect on Basic and DA only (half pay).
 */

function roundRupees(n: number): number {
  return Math.round(Number(n) || 0);
}

function dayFraction(amount: number, daysInMonth: number, effectDays: number): number {
  const dim = Math.max(1, Math.floor(daysInMonth));
  const effect = Math.max(0, effectDays);
  if (effect <= 0 || amount <= 0) return 0;
  return roundRupees((amount / dim) * effect);
}

export type HplEolLeaveInput = {
  hplDays?: number;
  eolDays?: number;
  basicActual: number;
  daActual: number;
  hraActual: number;
  transportActual: number;
  daysInMonth: number;
};

export type HplEolEarningsReduction = {
  hplDays: number;
  eolDays: number;
  basicReduction: number;
  daReduction: number;
  hraReduction: number;
  transportReduction: number;
};

/** Per-component reductions applied to paid Basic, DA, HRA, Transport. */
export function computeHplEolEarningsReduction(input: HplEolLeaveInput): HplEolEarningsReduction {
  const hplDays = Math.max(0, Math.floor(Number(input.hplDays) || 0));
  const eolDays = Math.max(0, Math.floor(Number(input.eolDays) || 0));
  const dim = Math.max(1, Math.floor(input.daysInMonth));
  const hplEffectDays = hplDays / 2;

  return {
    hplDays,
    eolDays,
    basicReduction:
      dayFraction(input.basicActual, dim, hplEffectDays) +
      dayFraction(input.basicActual, dim, eolDays),
    daReduction:
      dayFraction(input.daActual, dim, hplEffectDays) +
      dayFraction(input.daActual, dim, eolDays),
    hraReduction: dayFraction(input.hraActual, dim, eolDays),
    transportReduction: dayFraction(input.transportActual, dim, eolDays),
  };
}

export function applyHplEolToPaidAmounts(
  paid: { basic: number; da: number; hra: number; transport: number },
  reduction: HplEolEarningsReduction,
): { basic: number; da: number; hra: number; transport: number } {
  return {
    basic: Math.max(0, paid.basic - reduction.basicReduction),
    da: Math.max(0, paid.da - reduction.daReduction),
    hra: Math.max(0, paid.hra - reduction.hraReduction),
    transport: Math.max(0, paid.transport - reduction.transportReduction),
  };
}
