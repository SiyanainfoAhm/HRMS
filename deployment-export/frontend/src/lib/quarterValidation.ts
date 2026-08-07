/** Shared quarter number/name helpers for Settings UI. */

const QUARTER_NAME_PATTERN = /^[A-Za-z0-9\s\-\/\.\(\)]+$/u;

export function normalizeQuarterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateQuarterName(raw: string): string | null {
  const name = normalizeQuarterName(raw);
  if (!name) return "Quarter Number/Name is required.";
  if (name.length > 128) return "Quarter Number/Name cannot exceed 128 characters.";
  if (!/[A-Za-z0-9]/.test(name)) {
    return "Quarter Number/Name must contain at least one letter or number.";
  }
  if (!QUARTER_NAME_PATTERN.test(name)) {
    return "Letters, numbers, spaces, /, -, periods and parentheses are allowed.";
  }
  return null;
}

export function normalizeQuarterTypeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateQuarterTypeName(raw: string): string | null {
  const name = normalizeQuarterTypeName(raw);
  if (!name) return "Quarter Type name is required.";
  if (name.length > 100) return "Quarter Type name cannot exceed 100 characters.";
  if (!/[A-Za-z0-9]/.test(name)) {
    return "Quarter Type name must contain at least one letter or number.";
  }
  if (!QUARTER_NAME_PATTERN.test(name)) {
    return "Quarter Type name contains unsupported characters.";
  }
  return null;
}
