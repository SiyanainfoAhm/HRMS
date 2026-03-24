/**
 * Payroll calculation formulas (aligned with statutory rules)
 * PF: 12% of (Gross - HRA), capped at 1,800 when base > 15,000
 * ESIC Employee: 0.75% of Gross (when gross < 21,000)
 * ESIC Employer: 3.25% of Gross (when gross < 21,000)
 * Salary breakup defaults: Basic 50%, HRA 20%, Medical 5%, Trans 5%, LTA 10%, Personal 10%
 *
 * CTC = Gross + Employee PF + Employer PF + Employee ESIC + Employer ESIC
 * Take home = Gross - Employee PF - Employer PF - Employee ESIC - Employer ESIC - PT
 */

const PF_CAP = 1800;
const PF_BASE_CAP = 15000;
const PF_RATE = 0.12;
const ESIC_EMPLOYEE_RATE = 0.0075;
const ESIC_EMPLOYER_RATE = 0.0325;
const ESIC_GROSS_LIMIT = 21000;

export function computePf(gross: number, hra: number, pfEligible: boolean): number {
  if (!pfEligible) return 0;
  const base = Math.max(0, gross - hra);
  if (base > PF_BASE_CAP) return PF_CAP;
  return Math.round(base * PF_RATE);
}

export function computeEsicEmployee(gross: number, esicEligible: boolean): number {
  if (!esicEligible || gross >= ESIC_GROSS_LIMIT) return 0;
  return Math.round(gross * ESIC_EMPLOYEE_RATE);
}

export function computeEsicEmployer(gross: number, esicEligible: boolean): number {
  if (!esicEligible || gross >= ESIC_GROSS_LIMIT) return 0;
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
  const ctc = gross + pfEmp + pfEmpr + esicEmp + esicEmpr;
  const takeHome = gross - pfEmp - pfEmpr - esicEmp - esicEmpr - ptMonthly;

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
