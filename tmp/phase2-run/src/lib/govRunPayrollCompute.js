"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultGovRecalcReferencePeriod = defaultGovRecalcReferencePeriod;
exports.runGovernmentPayrollCompute = runGovernmentPayrollCompute;
const governmentPayroll_1 = require("./governmentPayroll");
const nightAllowanceCalculation_1 = require("./nightAllowanceCalculation");
const govRunPayrollOptionalEarnings_1 = require("./govRunPayrollOptionalEarnings");
const effectivePayrollValue_1 = require("./effectivePayrollValue");
function mergeDeductionDefaultsForCompute(defaults, paidOverrides) {
    if (!paidOverrides)
        return defaults;
    const out = { ...defaults };
    for (const [key, raw] of Object.entries(paidOverrides)) {
        if (!(0, effectivePayrollValue_1.hasOwn)(paidOverrides, key))
            continue;
        const n = Number(raw);
        if (Number.isFinite(n))
            out[key] = Math.max(0, Math.round(n));
    }
    return out;
}
function defaultGovRecalcReferencePeriod(runYear, runMonth) {
    return {
        eolReferenceMonth: runMonth,
        eolReferenceYear: runYear,
        hplReferenceMonth: runMonth,
        hplReferenceYear: runYear,
    };
}
function runGovernmentPayrollCompute(gr, opts) {
    const dim = Math.max(1, Math.floor(opts.daysInMonth));
    const capped = Math.max(0, Math.min(dim, Math.floor(opts.payDays)));
    const unpaidDays = Math.max(0, dim - capped);
    const electricityUnitRate = Number(opts.payrollConfig?.calculationSettings?.electricityUnitRate) || 0;
    const electricityTariff = gr.electricityTariff ??
        opts.payrollConfig?.electricityTariff ??
        null;
    const nightAllowanceBasicCeiling = Number(opts.payrollConfig?.calculationSettings?.nightAllowanceBasicCeiling) ||
        nightAllowanceCalculation_1.DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING;
    const optionalEarnings = (0, govRunPayrollOptionalEarnings_1.govOptionalFromComputedMonthly)(opts.governmentMonthly ?? null);
    const comp = (0, governmentPayroll_1.computeGovernmentMonthlyPayroll)({
        grossBasic: gr.grossBasic,
        daPercent: gr.daPercent,
        hraPercent: gr.hraPercent,
        medicalFixed: gr.medicalFixed,
        payLevel: gr.payLevel,
        daysInMonth: dim,
        unpaidDays,
        hplDays: gr.hplDays ?? 0,
        eolDays: gr.eolDays ?? 0,
        eolReferenceMonth: gr.eolReferenceMonth ?? opts.runMonth,
        eolReferenceYear: gr.eolReferenceYear ?? opts.runYear,
        hplReferenceMonth: gr.hplReferenceMonth ?? opts.runMonth,
        hplReferenceYear: gr.hplReferenceYear ?? opts.runYear,
        eolReferenceSalary: gr.eolReferenceSalary,
        hplReferenceSalary: gr.hplReferenceSalary,
        eolReferenceDaysInMonth: gr.eolReferenceDaysInMonth ?? dim,
        hplReferenceDaysInMonth: gr.hplReferenceDaysInMonth ?? dim,
        eolReferenceWarning: gr.eolReferenceWarning,
        hplReferenceWarning: gr.hplReferenceWarning,
        eolDeductionManualOverride: gr.eolDeductionManualOverride,
        hplDeductionManualOverride: gr.hplDeductionManualOverride,
        electricityUnitsConsumed: gr.electricityUnitsConsumed ?? 0,
        electricityUnitRate,
        electricityManualOverride: gr.electricityManualOverride,
        electricityTariff,
        electricityApplicable: gr.electricityApplicable,
        electricityMode: gr.electricityMode,
        nightHours: gr.nightHours ?? 0,
        nightAllowanceRate: gr.nightAllowanceRate ?? 0,
        nightAllowanceBasicCeiling,
        nightAllowanceManualOverride: gr.nightAllowanceManualOverride,
        nightAllowanceSlabNo: gr.nightAllowanceSlabNo ?? null,
        nightAllowanceWarning: gr.nightAllowanceWarning,
        quarterRentManualOverride: gr.quarterRentManualOverride,
        cpfManualOverride: gr.cpfManualOverride,
        runMonth: opts.runMonth,
        runYear: opts.runYear,
        deductionDefaults: mergeDeductionDefaultsForCompute(gr.deductionDefaults, gr.deductionPaidOverrides),
        optionalEarnings,
        earningPaidOverrides: gr.earningPaidOverrides,
        hasQuarter: gr.hasQuarter,
        quarterRent: gr.quarterRent,
        ...(0, governmentPayroll_1.governmentMonthlyExtras)(gr, opts.payrollConfig),
        cpfConfig: gr.cpfConfig,
        transportSettings: gr.transportSettings ?? opts.transportSettings,
    });
    return { comp, capped, unpaidDays };
}
