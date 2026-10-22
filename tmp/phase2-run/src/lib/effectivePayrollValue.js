"use strict";
/**
 * Effective payroll value resolution.
 * Treats 0 as a real value; only null/undefined are missing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstDefined = firstDefined;
exports.hasOwn = hasOwn;
exports.resolveEffectivePayrollValue = resolveEffectivePayrollValue;
exports.parseOptionalNumber = parseOptionalNumber;
exports.parseAmountOrZero = parseAmountOrZero;
function firstDefined(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null)
            return v;
    }
    return undefined;
}
function hasOwn(obj, key) {
    return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}
/**
 * Priority chain for Run Payroll / Master effective amounts.
 * Pass overrides in priority order (manual → draft → calculated → master → default).
 */
function resolveEffectivePayrollValue(...candidates) {
    const v = firstDefined(...candidates);
    if (v === undefined)
        return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/** Parse a numeric form/input value; empty → undefined (missing), not 0. */
function parseOptionalNumber(raw) {
    if (raw === null || raw === undefined || raw === "")
        return undefined;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
}
/** Parse amount for persistence; empty/invalid → 0. Explicit 0 stays 0. */
function parseAmountOrZero(raw) {
    const n = parseOptionalNumber(raw);
    return n === undefined ? 0 : Math.max(0, n);
}
