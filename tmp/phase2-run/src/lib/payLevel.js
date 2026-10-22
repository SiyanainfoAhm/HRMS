"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAY_LEVEL_IMPORT_ERROR = exports.PAY_LEVEL_INVALID_ERROR = exports.PAY_LEVEL_REQUIRED_ERROR = exports.GOVERNMENT_PAY_LEVELS = exports.GOVERNMENT_PAY_LEVEL_MAX = exports.GOVERNMENT_PAY_LEVEL_MIN = void 0;
exports.formatPayLevelLabel = formatPayLevelLabel;
exports.isValidGovernmentPayLevel = isValidGovernmentPayLevel;
exports.normalizeGovernmentPayLevel = normalizeGovernmentPayLevel;
exports.payLevelSelectOptions = payLevelSelectOptions;
exports.payLevelSelectOptionsForValue = payLevelSelectOptionsForValue;
exports.formatPayLevelDisplay = formatPayLevelDisplay;
/** 7th CPC government pay levels (Pay Level 1–18 in the pay matrix). */
exports.GOVERNMENT_PAY_LEVEL_MIN = 1;
exports.GOVERNMENT_PAY_LEVEL_MAX = 18;
exports.GOVERNMENT_PAY_LEVELS = Array.from({ length: exports.GOVERNMENT_PAY_LEVEL_MAX - exports.GOVERNMENT_PAY_LEVEL_MIN + 1 }, (_, i) => i + exports.GOVERNMENT_PAY_LEVEL_MIN);
function formatPayLevelLabel(level) {
    return `Level ${level}`;
}
function isValidGovernmentPayLevel(value) {
    const n = typeof value === "number" ? value : parseInt(String(value ?? "").trim(), 10);
    return Number.isInteger(n) && n >= exports.GOVERNMENT_PAY_LEVEL_MIN && n <= exports.GOVERNMENT_PAY_LEVEL_MAX;
}
/** Accepts 1–18 or "Level 1" … "Level 18". Returns null when invalid. */
function normalizeGovernmentPayLevel(raw) {
    if (raw === null || raw === undefined)
        return null;
    const trimmed = String(raw).trim();
    if (!trimmed)
        return null;
    const levelMatch = /^level\s*(\d+)$/i.exec(trimmed);
    const numStr = levelMatch ? levelMatch[1] : trimmed;
    if (!/^\d+$/.test(numStr))
        return null;
    const level = parseInt(numStr, 10);
    return isValidGovernmentPayLevel(level) ? level : null;
}
exports.PAY_LEVEL_REQUIRED_ERROR = "Please select a valid Pay Level.";
exports.PAY_LEVEL_INVALID_ERROR = "Invalid Pay Level. Please update.";
exports.PAY_LEVEL_IMPORT_ERROR = "Invalid Pay Level. Allowed values are Level 1 to Level 18.";
function payLevelSelectOptions() {
    return exports.GOVERNMENT_PAY_LEVELS.map((level) => ({
        value: String(level),
        label: formatPayLevelLabel(level),
    }));
}
/** Include invalid stored value so edit form can show warning without losing data. */
function payLevelSelectOptionsForValue(currentValue) {
    const base = payLevelSelectOptions();
    if (currentValue.trim() && !isValidGovernmentPayLevel(currentValue)) {
        return [
            { value: currentValue, label: `${formatPayLevelLabel(Number(currentValue) || 0)} (invalid)`, disabled: true },
            ...base,
        ];
    }
    return base;
}
function formatPayLevelDisplay(level) {
    if (level == null || Number.isNaN(level))
        return "—";
    if (!isValidGovernmentPayLevel(level))
        return `Level ${level} (invalid)`;
    return formatPayLevelLabel(level);
}
