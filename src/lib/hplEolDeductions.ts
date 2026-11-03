/**
 * HPL / EOL monthly deductions (Run Payroll only).
 * EOL basis: Basic + DA + HRA + Medical (transport and other allowances excluded).
 * HPL basis: Basic + DA only (HRA and medical are not reduced).
 */

import { divRoundHalfUp, fromSteps, percentOf, proportion, roundMoney, sumMoney, toSteps } from "./money";

/**
 * Splits `cut` over the amounts in proportion to each amount, in whole money steps (rupees); the last
 * non-zero amount absorbs the remainder so the shares add up to the cut exactly.
 */
function allocateCut(amounts: number[], cut: number): number[] {
  const steps = amounts.map((a) => toSteps(a));
  const total = steps.reduce((s, a) => s + a, 0);
  const cutSteps = toSteps(cut);
  const shares = steps.map((a) => (total > 0 ? divRoundHalfUp(a * cutSteps, total) : 0));
  const last = steps.reduce((idx, p, i) => (p > 0 ? i : idx), -1);
  if (last >= 0) shares[last] += cutSteps - shares.reduce((s, v) => s + v, 0);
  return shares.map((share, i) => fromSteps(steps[i] - share));
}

export type EolHplReferenceSalary = {
  basic: number;
  da: number;
  hra: number;
  medical: number;
};

export type EolHplDeductionInput = {
  referenceSalary: EolHplReferenceSalary;
  daysInReferenceMonth: number;
  eolDays?: number;
  hplDays?: number;
};

export type EolHplDeductionResult = {
  eolDays: number;
  hplDays: number;
  basisTotal: number;
  dailyBasis: number;
  eolBasisAmount: number;
  hplBasisAmount: number;
  eolDeduction: number;
  hplDeduction: number;
};

/** HPL factor: 2 HPL days = 1 day salary effect (0.5 per HPL day). */
export const HPL_DAY_SALARY_FACTOR = 0.5;

export function referenceSalaryBasisTotal(salary: EolHplReferenceSalary): number {
  return sumMoney(Math.max(0, salary.basic), Math.max(0, salary.da), Math.max(0, salary.hra), Math.max(0, salary.medical));
}

/** HPL deduction basis: Basic + DA only. */
export function referenceSalaryHplBasisTotal(salary: EolHplReferenceSalary): number {
  return sumMoney(Math.max(0, salary.basic), Math.max(0, salary.da));
}

export function computeEolHplDeductions(input: EolHplDeductionInput): EolHplDeductionResult {
  const dim = Math.max(1, Math.floor(Number(input.daysInReferenceMonth) || 1));
  // Leave cannot exceed the days of the month it is charged against; otherwise the
  // deduction would be larger than that month's salary.
  const eolDays = Math.min(dim, Math.max(0, Math.floor(Number(input.eolDays) || 0)));
  const hplDays = Math.min(dim, Math.max(0, Math.floor(Number(input.hplDays) || 0)));
  const eolBasisTotal = referenceSalaryBasisTotal(input.referenceSalary);
  const hplBasisTotal = referenceSalaryHplBasisTotal(input.referenceSalary);
  const dailyEolBasis = dim > 0 ? roundMoney(eolBasisTotal / dim) : 0;
  const dailyHplBasis = dim > 0 ? roundMoney(hplBasisTotal / dim) : 0;

  // Exact: basis x days / days-in-month in integer paise, rounded once (not daily rate x days).
  const eolDeduction = proportion(eolBasisTotal, eolDays, dim);
  const hplDeduction = proportion(hplBasisTotal, hplDays * HPL_DAY_SALARY_FACTOR, dim);

  return {
    eolDays,
    hplDays,
    basisTotal: eolBasisTotal,
    dailyBasis: dailyEolBasis,
    eolBasisAmount: eolBasisTotal,
    hplBasisAmount: hplBasisTotal,
    eolDeduction,
    hplDeduction,
  };
}

export function daysInCalendarMonth(year: number, month: number): number {
  const y = Math.max(1, Math.floor(year));
  const m = Math.min(12, Math.max(1, Math.floor(month)));
  return new Date(y, m, 0).getDate();
}

/** Full-month salary components from Run Payroll master inputs (current payroll month). */
export function referenceSalaryFromGovRecalc(gr: {
  grossBasic: number;
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
  hasQuarter?: boolean;
}): EolHplReferenceSalary {
  const gb = Math.max(0, roundMoney(Number(gr.grossBasic) || 0));
  const daPct = Number(gr.daPercent) || 0;
  const hraPct = Number(gr.hraPercent) || 0;
  const medical = Math.max(0, roundMoney(Number(gr.medicalFixed) || 0));
  const da = percentOf(gb, daPct);
  const hra = gr.hasQuarter ? 0 : percentOf(gb, hraPct);
  return { basic: gb, da, hra, medical };
}

export function isSamePayrollReferencePeriod(
  refMonth: number,
  refYear: number,
  runMonth: number,
  runYear: number,
): boolean {
  return Math.floor(refMonth) === Math.floor(runMonth) && Math.floor(refYear) === Math.floor(runYear);
}

/** Reduce basic/da/hra/medical paid amounts by a total cut (proportional). Used for EOL. */
export function applyProportionalEarningsCut(
  amounts: EolHplReferenceSalary,
  cutTotal: number,
): EolHplReferenceSalary {
  const total =
    Math.max(0, amounts.basic) +
    Math.max(0, amounts.da) +
    Math.max(0, amounts.hra) +
    Math.max(0, amounts.medical);
  const cut = Math.max(0, roundMoney(Number(cutTotal) || 0));
  if (cut <= 0 || total <= 0) return amounts;
  const applied = Math.min(cut, roundMoney(total));
  const [basic, da, hra, medical] = allocateCut([amounts.basic, amounts.da, amounts.hra, amounts.medical].map((a) => Math.max(0, a)), applied);
  return { basic, da, hra, medical };
}

/** Reduce only basic and da paid amounts by HPL cut (proportional between basic and da). */
export function applyBasicDaEarningsCut(
  amounts: EolHplReferenceSalary,
  cutTotal: number,
): EolHplReferenceSalary {
  const basicDaTotal = Math.max(0, amounts.basic) + Math.max(0, amounts.da);
  const cut = Math.max(0, roundMoney(Number(cutTotal) || 0));
  if (cut <= 0 || basicDaTotal <= 0) return amounts;
  const applied = Math.min(cut, roundMoney(basicDaTotal));
  const [basic, da] = allocateCut([Math.max(0, amounts.basic), Math.max(0, amounts.da)], applied);
  return { basic, da, hra: amounts.hra, medical: amounts.medical };
}
