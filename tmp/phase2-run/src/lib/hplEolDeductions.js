"use strict";
/**
 * HPL / EOL monthly deductions (Run Payroll only).
 * EOL basis: Basic + DA + HRA + Medical (transport and other allowances excluded).
 * HPL basis: Basic + DA only (HRA and medical are not reduced).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HPL_DAY_SALARY_FACTOR = void 0;
exports.referenceSalaryBasisTotal = referenceSalaryBasisTotal;
exports.referenceSalaryHplBasisTotal = referenceSalaryHplBasisTotal;
exports.computeEolHplDeductions = computeEolHplDeductions;
exports.daysInCalendarMonth = daysInCalendarMonth;
exports.referenceSalaryFromGovRecalc = referenceSalaryFromGovRecalc;
exports.isSamePayrollReferencePeriod = isSamePayrollReferencePeriod;
exports.applyProportionalEarningsCut = applyProportionalEarningsCut;
exports.applyBasicDaEarningsCut = applyBasicDaEarningsCut;
function roundRupees(n) {
    return Math.round(Number(n) || 0);
}
/** HPL factor: 2 HPL days = 1 day salary effect (0.5 per HPL day). */
exports.HPL_DAY_SALARY_FACTOR = 0.5;
function referenceSalaryBasisTotal(salary) {
    return roundRupees(Math.max(0, salary.basic) +
        Math.max(0, salary.da) +
        Math.max(0, salary.hra) +
        Math.max(0, salary.medical));
}
/** HPL deduction basis: Basic + DA only. */
function referenceSalaryHplBasisTotal(salary) {
    return roundRupees(Math.max(0, salary.basic) + Math.max(0, salary.da));
}
function computeEolHplDeductions(input) {
    const eolDays = Math.max(0, Math.floor(Number(input.eolDays) || 0));
    const hplDays = Math.max(0, Math.floor(Number(input.hplDays) || 0));
    const dim = Math.max(1, Math.floor(input.daysInReferenceMonth));
    const eolBasisTotal = referenceSalaryBasisTotal(input.referenceSalary);
    const hplBasisTotal = referenceSalaryHplBasisTotal(input.referenceSalary);
    const dailyEolBasis = dim > 0 ? eolBasisTotal / dim : 0;
    const dailyHplBasis = dim > 0 ? hplBasisTotal / dim : 0;
    const eolDeduction = roundRupees(dailyEolBasis * eolDays);
    const hplDeduction = roundRupees(dailyHplBasis * hplDays * exports.HPL_DAY_SALARY_FACTOR);
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
function daysInCalendarMonth(year, month) {
    const y = Math.max(1, Math.floor(year));
    const m = Math.min(12, Math.max(1, Math.floor(month)));
    return new Date(y, m, 0).getDate();
}
/** Full-month salary components from Run Payroll master inputs (current payroll month). */
function referenceSalaryFromGovRecalc(gr) {
    const gb = Math.max(0, Math.round(Number(gr.grossBasic) || 0));
    const daPct = Number(gr.daPercent) || 0;
    const hraPct = Number(gr.hraPercent) || 0;
    const medical = Math.max(0, Math.round(Number(gr.medicalFixed) || 0));
    const da = roundRupees((gb * daPct) / 100);
    const hra = gr.hasQuarter ? 0 : roundRupees((gb * hraPct) / 100);
    return { basic: gb, da, hra, medical };
}
function isSamePayrollReferencePeriod(refMonth, refYear, runMonth, runYear) {
    return Math.floor(refMonth) === Math.floor(runMonth) && Math.floor(refYear) === Math.floor(runYear);
}
/** Reduce basic/da/hra/medical paid amounts by a total cut (proportional). Used for EOL. */
function applyProportionalEarningsCut(amounts, cutTotal) {
    const total = Math.max(0, amounts.basic) +
        Math.max(0, amounts.da) +
        Math.max(0, amounts.hra) +
        Math.max(0, amounts.medical);
    const cut = Math.max(0, Math.round(Number(cutTotal) || 0));
    if (cut <= 0 || total <= 0)
        return amounts;
    const applied = Math.min(cut, total);
    return {
        basic: roundRupees(amounts.basic - (amounts.basic / total) * applied),
        da: roundRupees(amounts.da - (amounts.da / total) * applied),
        hra: roundRupees(amounts.hra - (amounts.hra / total) * applied),
        medical: roundRupees(amounts.medical - (amounts.medical / total) * applied),
    };
}
/** Reduce only basic and da paid amounts by HPL cut (proportional between basic and da). */
function applyBasicDaEarningsCut(amounts, cutTotal) {
    const basicDaTotal = Math.max(0, amounts.basic) + Math.max(0, amounts.da);
    const cut = Math.max(0, Math.round(Number(cutTotal) || 0));
    if (cut <= 0 || basicDaTotal <= 0)
        return amounts;
    const applied = Math.min(cut, basicDaTotal);
    return {
        basic: roundRupees(amounts.basic - (amounts.basic / basicDaTotal) * applied),
        da: roundRupees(amounts.da - (amounts.da / basicDaTotal) * applied),
        hra: amounts.hra,
        medical: amounts.medical,
    };
}
