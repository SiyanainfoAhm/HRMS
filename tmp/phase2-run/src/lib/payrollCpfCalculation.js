"use strict";
/** CPF/PF basis resolution — keep in sync with backend PayrollFieldRegistry / PayrollCalculationService */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CPF_BASIS_KEYS = exports.DEFAULT_CPF_PERCENTAGE = void 0;
exports.isCpfEmployeeCustomMode = isCpfEmployeeCustomMode;
exports.isCpfCompanyDefaultMode = isCpfCompanyDefaultMode;
exports.normalizeCpfUseCompanySettings = normalizeCpfUseCompanySettings;
exports.firstFiniteNumber = firstFiniteNumber;
exports.resolveRunCpfBasisAmount = resolveRunCpfBasisAmount;
exports.cpfFormulaPreview = cpfFormulaPreview;
exports.runPayrollBasisAmountsFromComputed = runPayrollBasisAmountsFromComputed;
exports.calculateCpfFromBasis = calculateCpfFromBasis;
exports.resolveEffectiveCpfConfigForMaster = resolveEffectiveCpfConfigForMaster;
exports.resolveEffectiveCpf = resolveEffectiveCpf;
exports.resolveMasterCpfBasisAmount = resolveMasterCpfBasisAmount;
exports.DEFAULT_CPF_PERCENTAGE = 12;
/** Legacy: all standard earning components (matches total earnings before allowances). */
exports.DEFAULT_CPF_BASIS_KEYS = ["gross_basic", "da", "hra", "medical", "transport"];
/** Employee-level CPF override (API/DB may send `0` instead of boolean `false`). */
function isCpfEmployeeCustomMode(value) {
    return value === false || value === 0 || value === "0" || value === "false";
}
function isCpfCompanyDefaultMode(value) {
    return !isCpfEmployeeCustomMode(value);
}
function normalizeCpfUseCompanySettings(value, defaultCompany = true) {
    if (value === undefined || value === null)
        return defaultCompany;
    return !isCpfEmployeeCustomMode(value);
}
/** First finite number; treats 0 as present. Skips null/undefined/"". */
function firstFiniteNumber(...values) {
    for (const v of values) {
        if (v === undefined || v === null || v === "")
            continue;
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n))
            return n;
    }
    return undefined;
}
function resolveRunCpfBasisAmount(basisKeys, amounts, customEarnings = {}) {
    let sum = 0;
    for (const key of basisKeys) {
        if (customEarnings[key] != null) {
            sum += firstFiniteNumber(customEarnings[key]) ?? 0;
        }
        else if (amounts[key] != null) {
            sum += firstFiniteNumber(amounts[key]) ?? 0;
        }
    }
    return Math.round(sum);
}
function cpfFormulaPreview(basisLabels, percentage, mode = "percentage", fixedAmount = 0) {
    if (mode === "fixed_amount") {
        const amt = Math.round(firstFiniteNumber(fixedAmount) ?? 0);
        return `CPF = Fixed Amount (₹${amt.toLocaleString("en-IN")})`;
    }
    const labels = basisLabels.length ? basisLabels.join(" + ") : "—";
    const pct = Number.isInteger(percentage) ? String(percentage) : String(percentage);
    return `CPF = (${labels}) × ${pct}%`;
}
function runPayrollBasisAmountsFromComputed(computed) {
    return {
        gross_basic: computed.basicPaid,
        da: computed.daPaid,
        hra: computed.hraPaid,
        medical: computed.medicalPaid,
        transport: computed.transportPaid,
        sp_pay: computed.spPayPaid,
        extra_work_allowance: computed.extraWorkAllowancePaid,
        night_allowance: computed.nightAllowancePaid,
        uniform_allowance: computed.uniformAllowancePaid,
        education_allowance: computed.educationAllowancePaid,
        da_arrears: computed.daArrearsPaid,
        transport_arrears: computed.transportArrearsPaid,
    };
}
/**
 * Canonical CPF amount from mode + values.
 * Fixed amount mode ALWAYS returns the fixed amount, including explicit 0.
 */
function calculateCpfFromBasis(cpfDefaultFromMaster, basisAmount, cpfPercentage, legacyTotalEarnings, mode = "percentage", fixedAmount = 0, opts) {
    if (mode === "fixed_amount") {
        return Math.round(firstFiniteNumber(fixedAmount) ?? 0);
    }
    // Legacy manual CPF default on master (only when not using fixed mode).
    const legacyDefault = firstFiniteNumber(cpfDefaultFromMaster);
    if (legacyDefault !== undefined && legacyDefault > 0) {
        return Math.round(legacyDefault);
    }
    if (basisAmount > 0) {
        const pct = firstFiniteNumber(cpfPercentage) ?? exports.DEFAULT_CPF_PERCENTAGE;
        return Math.round(basisAmount * (pct / 100));
    }
    if (opts?.strictBasis) {
        return 0;
    }
    const pct = firstFiniteNumber(cpfPercentage) ?? exports.DEFAULT_CPF_PERCENTAGE;
    return Math.round(legacyTotalEarnings * (pct / 100));
}
function resolveEffectiveCpfConfigForMaster(input) {
    const companyPct = firstFiniteNumber(input.companyCpfPercentage) ?? exports.DEFAULT_CPF_PERCENTAGE;
    const companyBasis = input.companyCpfBasisFieldKeys && input.companyCpfBasisFieldKeys.length > 0
        ? input.companyCpfBasisFieldKeys
        : exports.DEFAULT_CPF_BASIS_KEYS;
    const companyMode = input.companyCpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage";
    const companyFixed = Math.round(firstFiniteNumber(input.companyCpfFixedAmount) ?? 0);
    const customMode = isCpfEmployeeCustomMode(input.cpfUseCompanySettings);
    if (!customMode) {
        return {
            cpfPercentage: companyPct,
            cpfBasisFieldKeys: companyBasis,
            cpfCalculationMode: companyMode,
            cpfFixedAmount: companyFixed,
        };
    }
    const pct = firstFiniteNumber(input.cpfPercentageOverride) ?? companyPct;
    const basis = input.cpfBasisFieldKeysOverride ?? [];
    const mode = input.cpfCalculationModeOverride === "fixed_amount" ? "fixed_amount" : "percentage";
    const fixed = input.cpfFixedAmountOverride !== undefined &&
        input.cpfFixedAmountOverride !== null &&
        input.cpfFixedAmountOverride !== ""
        ? Math.round(firstFiniteNumber(input.cpfFixedAmountOverride) ?? 0)
        : companyFixed;
    return {
        cpfPercentage: pct,
        cpfBasisFieldKeys: basis,
        cpfCalculationMode: mode,
        cpfFixedAmount: fixed,
    };
}
/** Canonical effective CPF resolution for master preview / run payroll / exports. */
function resolveEffectiveCpf(args) {
    const config = resolveEffectiveCpfConfigForMaster(args.employeeCpfConfig);
    const source = isCpfEmployeeCustomMode(args.employeeCpfConfig.cpfUseCompanySettings)
        ? "employee"
        : "company";
    const mode = config.cpfCalculationMode ?? "percentage";
    const effectiveCpf = calculateCpfFromBasis(args.cpfDefaultFromMaster ?? 0, args.basisAmount, config.cpfPercentage, args.legacyTotalEarnings ?? 0, mode, config.cpfFixedAmount ?? 0, { strictBasis: source === "employee" });
    return {
        source,
        mode,
        basis: config.cpfBasisFieldKeys,
        percentage: config.cpfPercentage,
        fixedAmount: config.cpfFixedAmount ?? 0,
        effectiveCpf,
        config,
    };
}
function resolveMasterCpfBasisAmount(calc, basisKeys, customEarnings = {}) {
    const amounts = {
        gross_basic: calc.gross_basic_pay ?? 0,
        da: calc.da_amount ?? 0,
        hra: calc.hra_amount ?? 0,
        medical: calc.medical ?? 0,
        transport: calc.transport_total ?? 0,
        sp_pay: 0,
        extra_work_allowance: 0,
        night_allowance: 0,
        uniform_allowance: 0,
        education_allowance: 0,
        da_arrears: 0,
        transport_arrears: 0,
        gross_arrears: 0,
        net_arrears: 0,
    };
    for (const [key, value] of Object.entries(customEarnings)) {
        if (Number.isFinite(Number(value))) {
            amounts[key] = Number(value);
        }
    }
    let sum = 0;
    for (const key of basisKeys) {
        sum += firstFiniteNumber(amounts[key]) ?? 0;
    }
    return Math.round(sum);
}
