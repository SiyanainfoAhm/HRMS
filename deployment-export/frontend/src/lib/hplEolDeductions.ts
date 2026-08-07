/**
 * HPL / EOL monthly deductions (Run Payroll only).
 * EOL basis: Basic + DA + HRA + Medical (transport and other allowances excluded).
 * HPL basis: Basic + DA only (HRA and medical are not reduced).
 */

function roundRupees(n: number): number {
  return Math.round(Number(n) || 0);
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
  return roundRupees(
    Math.max(0, salary.basic) +
      Math.max(0, salary.da) +
      Math.max(0, salary.hra) +
      Math.max(0, salary.medical),
  );
}

/** HPL deduction basis: Basic + DA only. */
export function referenceSalaryHplBasisTotal(salary: EolHplReferenceSalary): number {
  return roundRupees(Math.max(0, salary.basic) + Math.max(0, salary.da));
}

export function computeEolHplDeductions(input: EolHplDeductionInput): EolHplDeductionResult {
  const eolDays = Math.max(0, Math.floor(Number(input.eolDays) || 0));
  const hplDays = Math.max(0, Math.floor(Number(input.hplDays) || 0));
  const dim = Math.max(1, Math.floor(input.daysInReferenceMonth));
  const eolBasisTotal = referenceSalaryBasisTotal(input.referenceSalary);
  const hplBasisTotal = referenceSalaryHplBasisTotal(input.referenceSalary);
  const dailyEolBasis = dim > 0 ? eolBasisTotal / dim : 0;
  const dailyHplBasis = dim > 0 ? hplBasisTotal / dim : 0;

  const eolDeduction = roundRupees(dailyEolBasis * eolDays);
  const hplDeduction = roundRupees(dailyHplBasis * hplDays * HPL_DAY_SALARY_FACTOR);

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
  const gb = Math.max(0, Math.round(Number(gr.grossBasic) || 0));
  const daPct = Number(gr.daPercent) || 0;
  const hraPct = Number(gr.hraPercent) || 0;
  const medical = Math.max(0, Math.round(Number(gr.medicalFixed) || 0));
  const da = roundRupees((gb * daPct) / 100);
  const hra = gr.hasQuarter ? 0 : roundRupees((gb * hraPct) / 100);
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
  const cut = Math.max(0, Math.round(Number(cutTotal) || 0));
  if (cut <= 0 || total <= 0) return amounts;
  const applied = Math.min(cut, total);
  return {
    basic: roundRupees(amounts.basic - (amounts.basic / total) * applied),
    da: roundRupees(amounts.da - (amounts.da / total) * applied),
    hra: roundRupees(amounts.hra - (amounts.hra / total) * applied),
    medical: roundRupees(amounts.medical - (amounts.medical / total) * applied),
  };
}

/** Reduce only basic and da paid amounts by HPL cut (proportional between basic and da). */
export function applyBasicDaEarningsCut(
  amounts: EolHplReferenceSalary,
  cutTotal: number,
): EolHplReferenceSalary {
  const basicDaTotal = Math.max(0, amounts.basic) + Math.max(0, amounts.da);
  const cut = Math.max(0, Math.round(Number(cutTotal) || 0));
  if (cut <= 0 || basicDaTotal <= 0) return amounts;
  const applied = Math.min(cut, basicDaTotal);
  return {
    basic: roundRupees(amounts.basic - (amounts.basic / basicDaTotal) * applied),
    da: roundRupees(amounts.da - (amounts.da / basicDaTotal) * applied),
    hra: amounts.hra,
    medical: amounts.medical,
  };
}
