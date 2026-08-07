/**
 * Payroll calculation formulas (aligned with common Indian statutory practice)
 *
 * PF (EPF employee / employer contribution — same formula used for both here):
 *   PF wage ≈ Gross − HRA (Basic+DA proxy from default split).
 *   If PF wage ≤ ₹15,000: 12% of PF wage (no cap).
 *   If PF wage > ₹15,000: employee contribution capped at ₹1,800/month (12% of ₹15,000).
 *
 * ESIC: Applies when gross monthly ≤ ₹21,000 (inclusive). Rates on gross:
 *   Employee 0.75%, Employer 3.25% (e.g. ₹20,000 → ₹150 + ₹650).
 *
 * Salary breakup defaults: Basic 50%, HRA 20%, Medical 5%, Trans 5%, LTA 10%, Personal 10%
 *
 * CTC = Gross + Employer PF + Employer ESIC
 * Take home (approx.) = Gross − Employee PF − Employee ESIC − PT
 */

const PF_CAP = 1800;
const PF_WAGE_CAP = 15000;
const PF_RATE = 0.12;
const ESIC_EMPLOYEE_RATE = 0.0075;
const ESIC_EMPLOYER_RATE = 0.0325;
/** ESIC applies when gross is at most this (inclusive). */
export const ESIC_GROSS_MAX_INCLUSIVE = 21000;

export function computePfWage(gross: number, hra: number): number {
  return Math.max(0, gross - hra);
}

export function computePf(gross: number, hra: number, pfEligible: boolean): number {
  if (!pfEligible) return 0;
  const base = computePfWage(gross, hra);
  if (base > PF_WAGE_CAP) return PF_CAP;
  return Math.round(base * PF_RATE);
}

/** True when EPF typically mandatory: PF wage (gross − HRA) ≤ ₹15,000. */
export function isPfStatutorilyMandatory(gross: number, hra: number): boolean {
  const g = Number(gross) || 0;
  if (g <= 0) return false;
  return computePfWage(g, hra) <= PF_WAGE_CAP;
}

/** True when gross is within ESIC ceiling (inclusive). */
export function isWithinEsicGrossCeiling(gross: number): boolean {
  const g = Number(gross) || 0;
  return g > 0 && g <= ESIC_GROSS_MAX_INCLUSIVE;
}

export function computeEsicEmployee(gross: number, esicEligible: boolean): number {
  if (!esicEligible || !isWithinEsicGrossCeiling(gross)) return 0;
  return Math.round(gross * ESIC_EMPLOYEE_RATE);
}

export function computeEsicEmployer(gross: number, esicEligible: boolean): number {
  if (!esicEligible || !isWithinEsicGrossCeiling(gross)) return 0;
  return Math.round(gross * ESIC_EMPLOYER_RATE);
}

export function defaultSalaryBreakup(gross: number): {
  basic: number;
  hra: number;
  medical: number;
  trans: number;
  lta: number;
  personal: number;
} {
  return {
    basic: Math.round(gross * 0.5),
    hra: Math.round(gross * 0.2),
    medical: Math.round(gross * 0.05),
    trans: Math.round(gross * 0.05),
    lta: Math.round(gross * 0.1),
    personal: Math.round(gross * 0.1),
  };
}

export function computePayrollFromGross(
  gross: number,
  pfEligible: boolean,
  esicEligible: boolean,
  ptMonthly: number,
  salaryBreakup?: { basic?: number; hra?: number; medical?: number; trans?: number; lta?: number; personal?: number }
) {
  const components = salaryBreakup?.hra != null
    ? {
        basic: salaryBreakup.basic ?? Math.round(gross * 0.5),
        hra: salaryBreakup.hra ?? Math.round(gross * 0.2),
        medical: salaryBreakup.medical ?? Math.round(gross * 0.05),
        trans: salaryBreakup.trans ?? Math.round(gross * 0.05),
        lta: salaryBreakup.lta ?? Math.round(gross * 0.1),
        personal: salaryBreakup.personal ?? Math.round(gross * 0.1),
      }
    : defaultSalaryBreakup(gross);

  const pfEmp = computePf(gross, components.hra, pfEligible);
  const pfEmpr = computePf(gross, components.hra, pfEligible);
  const esicEmp = computeEsicEmployee(gross, esicEligible);
  const esicEmpr = computeEsicEmployer(gross, esicEligible);
  const ctc = gross + pfEmpr + esicEmpr;
  const takeHome = gross - pfEmp - esicEmp - ptMonthly;

  return {
    ...components,
    pfEmp,
    pfEmpr,
    esicEmp,
    esicEmpr,
    ctc,
    takeHome: Math.max(0, takeHome),
  };
}
