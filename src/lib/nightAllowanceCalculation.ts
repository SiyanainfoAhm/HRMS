/** Default monthly basic pay ceiling for night duty allowance entitlement. */
export const DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING = 43600;

/** Night allowance = night duty hours × hourly rate (rounded to nearest rupee for payroll). */
export function calculateNightAllowanceAmount(hours: number, ratePerHour: number): number {
  const h = Math.max(0, Number(hours) || 0);
  const r = Math.max(0, Number(ratePerHour) || 0);
  return Math.round(h * r);
}

export function formatNightAllowanceSlabLabel(slabNo: number, payLevel: number, ratePerHour: number): string {
  return `S.No ${slabNo} - Level ${payLevel} - ₹${ratePerHour.toFixed(2)}/hr`;
}

export function nightAllowanceCeilingMessage(ceiling: number): string {
  const cap = Math.round(Math.max(0, Number(ceiling) || 0));
  return `Not eligible for Night Allowance: Basic Pay exceeds ₹${cap.toLocaleString("en-IN")} ceiling.`;
}

export function isNightAllowanceEligibleByBasicPay(basicPay: number, ceiling: number): boolean {
  const basic = Math.max(0, Number(basicPay) || 0);
  const cap = Math.max(0, Number(ceiling) ?? DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING);
  return basic <= cap;
}

export function resolveBasicPayForNightAllowanceCeiling(
  basicPaid?: number | null,
  basicActual?: number | null,
  grossBasicFallback?: number | null,
): number {
  const paid = Number(basicPaid);
  if (Number.isFinite(paid) && paid > 0) return paid;
  const actual = Number(basicActual);
  if (Number.isFinite(actual) && actual > 0) return actual;
  const gross = Number(grossBasicFallback);
  if (Number.isFinite(gross) && gross > 0) return gross;
  return 0;
}

export function resolveNightAllowanceAmount(params: {
  hours: number;
  ratePerHour: number;
  basicPay: number;
  ceiling?: number;
  manualOverride?: boolean;
  manualAmount?: number | null;
  slabWarning?: string | null;
}): {
  amount: number;
  eligible: boolean;
  warning: string | null;
  ceiling: number;
} {
  const ceiling = Math.max(0, Number(params.ceiling) || DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING);
  const basicPay = Math.max(0, Number(params.basicPay) || 0);
  const hours = Math.max(0, Number(params.hours) || 0);
  const rate = Math.max(0, Number(params.ratePerHour) || 0);
  const eligible = isNightAllowanceEligibleByBasicPay(basicPay, ceiling);

  if (!eligible) {
    return {
      amount: 0,
      eligible: false,
      warning: nightAllowanceCeilingMessage(ceiling),
      ceiling,
    };
  }

  let amount = hours > 0 ? calculateNightAllowanceAmount(hours, rate) : 0;
  if (
    params.manualOverride &&
    params.manualAmount != null &&
    Number.isFinite(Number(params.manualAmount))
  ) {
    amount = Math.round(Math.max(0, Number(params.manualAmount)));
  }

  return {
    amount,
    eligible: true,
    warning: params.slabWarning ?? null,
    ceiling,
  };
}
