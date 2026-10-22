"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING = void 0;
exports.calculateNightAllowanceAmount = calculateNightAllowanceAmount;
exports.formatNightAllowanceSlabLabel = formatNightAllowanceSlabLabel;
exports.resolveNightAllowanceRateByPayLevel = resolveNightAllowanceRateByPayLevel;
exports.nightAllowanceCeilingMessage = nightAllowanceCeilingMessage;
exports.isNightAllowanceEligibleByBasicPay = isNightAllowanceEligibleByBasicPay;
exports.resolveBasicPayForNightAllowanceCeiling = resolveBasicPayForNightAllowanceCeiling;
exports.resolveNightAllowanceAmount = resolveNightAllowanceAmount;
/** Default monthly basic pay ceiling for night duty allowance entitlement. */
exports.DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING = 43600;
/** Night allowance = night duty hours × hourly rate (rounded to nearest rupee for payroll). */
function calculateNightAllowanceAmount(hours, ratePerHour) {
    const h = Math.max(0, Number(hours) || 0);
    const r = Math.max(0, Number(ratePerHour) || 0);
    return Math.round(h * r);
}
const payLevel_1 = require("./payLevel");
function formatNightAllowanceSlabLabel(slabNo, payLevel, ratePerHour) {
    return `S.No ${slabNo} - Level ${payLevel} - ₹${ratePerHour.toFixed(2)}/hr`;
}
/** Match backend resolveForPayLevel: effective_from DESC NULLS LAST, slab_no ASC. */
function resolveNightAllowanceRateByPayLevel(rates, payLevel, asOfDate) {
    const level = Math.floor(Number(payLevel) || 0);
    if (!(0, payLevel_1.isValidGovernmentPayLevel)(level)) {
        return { rate: 0, slabNo: null, warning: "Night allowance rate is not configured for this Pay Level." };
    }
    const asOf = asOfDate ? new Date(asOfDate) : null;
    const matches = rates
        .filter((r) => r.isActive !== false && r.payLevel === level)
        .filter((r) => {
        if (!asOf || !r.effectiveFrom)
            return true;
        const eff = new Date(r.effectiveFrom);
        return !Number.isNaN(eff.getTime()) && eff <= asOf;
    })
        .sort((a, b) => {
        const aHas = a.effectiveFrom ? 0 : 1;
        const bHas = b.effectiveFrom ? 0 : 1;
        if (aHas !== bHas)
            return aHas - bHas;
        const aEff = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : 0;
        const bEff = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : 0;
        if (aEff !== bEff)
            return bEff - aEff;
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
function nightAllowanceCeilingMessage(ceiling) {
    const cap = Math.round(Math.max(0, Number(ceiling) || 0));
    return `Not eligible for Night Allowance: Basic Pay exceeds ₹${cap.toLocaleString("en-IN")} ceiling.`;
}
function isNightAllowanceEligibleByBasicPay(basicPay, ceiling) {
    const basic = Math.max(0, Number(basicPay) || 0);
    const cap = Math.max(0, Number(ceiling) ?? exports.DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING);
    return basic <= cap;
}
function resolveBasicPayForNightAllowanceCeiling(basicPaid, basicActual, grossBasicFallback) {
    const paid = Number(basicPaid);
    if (Number.isFinite(paid) && paid > 0)
        return paid;
    const actual = Number(basicActual);
    if (Number.isFinite(actual) && actual > 0)
        return actual;
    const gross = Number(grossBasicFallback);
    if (Number.isFinite(gross) && gross > 0)
        return gross;
    return 0;
}
function resolveNightAllowanceAmount(params) {
    const ceiling = Math.max(0, Number(params.ceiling) || exports.DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING);
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
    if (params.manualOverride &&
        params.manualAmount != null &&
        Number.isFinite(Number(params.manualAmount))) {
        amount = Math.round(Math.max(0, Number(params.manualAmount)));
    }
    return {
        amount,
        eligible: true,
        warning: params.slabWarning ?? null,
        ceiling,
    };
}
