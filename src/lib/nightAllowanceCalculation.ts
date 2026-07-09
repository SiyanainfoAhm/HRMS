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

export type NightAllowanceRateRow = {
  slabNo: number;
  payLevel: number;
  ratePerHour: number;
  effectiveFrom?: string | null;
  isActive?: boolean;
};

/** Match backend resolveForPayLevel: effective_from DESC NULLS LAST, slab_no ASC. */
export function resolveNightAllowanceRateByPayLevel(
  rates: NightAllowanceRateRow[],
  payLevel: number,
  asOfDate?: string | null,
): { rate: number; slabNo: number | null; warning: string | null } {
  const level = Math.floor(Number(payLevel) || 0);
  if (level < 1) {
    return { rate: 0, slabNo: null, warning: null };
  }

  const asOf = asOfDate ? new Date(asOfDate) : null;
  const matches = rates
    .filter((r) => r.isActive !== false && r.payLevel === level)
    .filter((r) => {
      if (!asOf || !r.effectiveFrom) return true;
      const eff = new Date(r.effectiveFrom);
      return !Number.isNaN(eff.getTime()) && eff <= asOf;
    })
    .sort((a, b) => {
      const aHas = a.effectiveFrom ? 0 : 1;
      const bHas = b.effectiveFrom ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      const aEff = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : 0;
      const bEff = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : 0;
      if (aEff !== bEff) return bEff - aEff;
      return a.slabNo - b.slabNo;
    });

  const pick = matches[0];
  if (!pick) {
    return {
      rate: 0,
      slabNo: null,
      warning: "Night allowance rate is not configured for this Pay Level.",
    };
  }

  return { rate: pick.ratePerHour, slabNo: pick.slabNo, warning: null };
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
