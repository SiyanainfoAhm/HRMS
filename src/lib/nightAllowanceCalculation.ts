/** Default monthly basic pay ceiling for night duty allowance entitlement. */
export const DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING = 43600;

/**
 * Night Duty Allowance = hours x hourly rate, where hourly = per-duty rate / 8 (Settings >
 * Night Allowance stores the rate per 8-hour duty; the 7th CPC hourly rate is perDuty / 8).
 * Computed as (hours x perDuty) / 8 and rounded ONCE, to the whole rupee, at the end
 * (no rounded hourly rate or rounded duty count in between).
 * Mirror: NightAllowanceRateService::allowanceAmount (shared cases in
 * backend/tests/fixtures/night_allowance_cases.json).
 */
export const NIGHT_DUTY_BASE_HOURS = 8;
export const NIGHT_ALLOWANCE_ROUND_TO_RUPEE = true;

/**
 * 'duty' = rate is per 8-hour duty (all new rows). 'hour' = legacy rows whose stored rate is per
 * hour; they keep hours x rate so already generated payroll recomputes to the same amount.
 */
export type NightAllowanceRateBasis = "duty" | "hour";

export function calculateNightAllowanceAmount(
  hours: number,
  rate: number,
  basis: NightAllowanceRateBasis = "duty",
): number {
  const h = Math.max(0, Number(hours) || 0);
  const r = Math.max(0, Number(rate) || 0);
  if (h <= 0) return 0;
  if (basis === "hour") return Math.round(h * r);
  const amount = (h * r) / NIGHT_DUTY_BASE_HOURS;
  return NIGHT_ALLOWANCE_ROUND_TO_RUPEE ? Math.round(amount) : Math.round(amount * 100) / 100;
}

/** Display-only hourly rate: per-duty rate / 8, 2 decimals (185.60 -> 23.20). Never used in the amount. */
export function nightHourlyRateForDisplay(ratePerDuty: number): number {
  return Math.round((Math.max(0, Number(ratePerDuty) || 0) / NIGHT_DUTY_BASE_HOURS) * 100) / 100;
}

/** Label under NIGHT HRS: "₹23.20/hr (₹185.60/duty)"; legacy hourly rows show their hourly rate. */
export function nightAllowanceRateLabel(rate: number | null | undefined, basis: NightAllowanceRateBasis | undefined): string {
  const r = Math.max(0, Number(rate) || 0);
  if (basis !== "duty") return `₹${r.toFixed(2)}/hr`;
  return `₹${nightHourlyRateForDisplay(r).toFixed(2)}/hr (₹${r.toFixed(2)}/duty)`;
}

import { isValidGovernmentPayLevel } from "./payLevel";

export function formatNightAllowanceSlabLabel(slabNo: number, payLevel: number, ratePerDuty: number): string {
  return `S.No ${slabNo} - Level ${payLevel} - ₹${ratePerDuty.toFixed(2)}/duty`;
}

export type NightAllowanceRateRow = {
  slabNo: number;
  payLevel: number;
  /** Legacy per-hour rate (kept for history). */
  ratePerHour: number;
  /** Night Allowance Rate per 8-hour duty (CIRT-08). */
  ratePerDuty?: number | null;
  effectiveFrom?: string | null;
  isActive?: boolean;
};

/** Match backend resolveForPayLevel: effective_from DESC NULLS LAST, slab_no ASC. */
export function resolveNightAllowanceRateByPayLevel(
  rates: NightAllowanceRateRow[],
  payLevel: number,
  asOfDate?: string | null,
): { rate: number; slabNo: number | null; warning: string | null; basis: NightAllowanceRateBasis } {
  const level = Math.floor(Number(payLevel) || 0);
  if (!isValidGovernmentPayLevel(level)) {
    return { rate: 0, slabNo: null, warning: "Night allowance rate is not configured for this Pay Level.", basis: "duty" };
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
      basis: "duty",
    };
  }

  const perDuty = Number(pick.ratePerDuty);
  return {
    rate: Number.isFinite(perDuty) && pick.ratePerDuty != null ? perDuty : Math.round(pick.ratePerHour * NIGHT_DUTY_BASE_HOURS * 100) / 100,
    slabNo: pick.slabNo,
    warning: null,
    basis: "duty",
  };
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
  /** Rate per duty when rateBasis is "duty", per hour for legacy rows. */
  rate: number;
  rateBasis?: NightAllowanceRateBasis;
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
  const rate = Math.max(0, Number(params.rate) || 0);
  const eligible = isNightAllowanceEligibleByBasicPay(basicPay, ceiling);

  if (!eligible) {
    return {
      amount: 0,
      eligible: false,
      warning: nightAllowanceCeilingMessage(ceiling),
      ceiling,
    };
  }

  let amount = hours > 0 ? calculateNightAllowanceAmount(hours, rate, params.rateBasis ?? "duty") : 0;
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
