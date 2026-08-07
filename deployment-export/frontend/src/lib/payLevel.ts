/** 7th CPC government pay levels (Pay Level 1–18 in the pay matrix). */
export const GOVERNMENT_PAY_LEVEL_MIN = 1;
export const GOVERNMENT_PAY_LEVEL_MAX = 18;
export const GOVERNMENT_PAY_LEVELS = Array.from(
  { length: GOVERNMENT_PAY_LEVEL_MAX - GOVERNMENT_PAY_LEVEL_MIN + 1 },
  (_, i) => i + GOVERNMENT_PAY_LEVEL_MIN,
) as readonly number[];

export type GovernmentPayLevel = number;

export function formatPayLevelLabel(level: number): string {
  return `Level ${level}`;
}

export function isValidGovernmentPayLevel(value: unknown): value is GovernmentPayLevel {
  const n = typeof value === "number" ? value : parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(n) && n >= GOVERNMENT_PAY_LEVEL_MIN && n <= GOVERNMENT_PAY_LEVEL_MAX;
}

/** Accepts 1–18 or "Level 1" … "Level 18". Returns null when invalid. */
export function normalizeGovernmentPayLevel(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const levelMatch = /^level\s*(\d+)$/i.exec(trimmed);
  const numStr = levelMatch ? levelMatch[1] : trimmed;
  if (!/^\d+$/.test(numStr)) return null;

  const level = parseInt(numStr, 10);
  return isValidGovernmentPayLevel(level) ? level : null;
}

export const PAY_LEVEL_REQUIRED_ERROR = "Please select a valid Pay Level.";
export const PAY_LEVEL_INVALID_ERROR = "Invalid Pay Level. Please update.";
export const PAY_LEVEL_IMPORT_ERROR = "Invalid Pay Level. Allowed values are Level 1 to Level 18.";

export function payLevelSelectOptions(): Array<{ value: string; label: string; disabled?: boolean }> {
  return GOVERNMENT_PAY_LEVELS.map((level) => ({
    value: String(level),
    label: formatPayLevelLabel(level),
  }));
}

/** Include invalid stored value so edit form can show warning without losing data. */
export function payLevelSelectOptionsForValue(
  currentValue: string,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const base = payLevelSelectOptions();
  if (currentValue.trim() && !isValidGovernmentPayLevel(currentValue)) {
    return [
      { value: currentValue, label: `${formatPayLevelLabel(Number(currentValue) || 0)} (invalid)`, disabled: true },
      ...base,
    ];
  }
  return base;
}

export function formatPayLevelDisplay(level: number | null | undefined): string {
  if (level == null || Number.isNaN(level)) return "—";
  if (!isValidGovernmentPayLevel(level)) return `Level ${level} (invalid)`;
  return formatPayLevelLabel(level);
}
