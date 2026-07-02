import {
  validateBankDetails,
  validateBasicDetails,
  validateDeductions,
  validatePayrollDetails,
  validateStatutory,
  type MasterFormLike,
} from "@/lib/payrollMasterFormValidation";
import {
  validatePayrollMasterUniqueness,
  type PayrollMasterUniqueRow,
} from "@/lib/payrollMasterUniqueness";

export const PAYROLL_MASTER_AUTOSAVE_ENABLED_KEY = "hrms.payrollMaster.autosaveEnabled";
export const PAYROLL_MASTER_ADD_DRAFT_KEY = "hrms.payrollMaster.addDraft";

const AUTOSAVE_DEBOUNCE_MS = 2500;

export function readAutosaveEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(PAYROLL_MASTER_AUTOSAVE_ENABLED_KEY);
  if (raw === null) return true;
  return raw === "1" || raw === "true";
}

export function writeAutosaveEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PAYROLL_MASTER_AUTOSAVE_ENABLED_KEY, enabled ? "1" : "0");
}

export function autosaveDebounceMs(): number {
  return AUTOSAVE_DEBOUNCE_MS;
}

/** Minimum identity to create a server-side draft (no login user yet). */
export function meetsServerDraftThreshold(form: MasterFormLike): boolean {
  const code = form.employeeCode.trim();
  const name = form.name.trim();
  const level = parseInt(form.payLevel, 10);
  return Boolean(code && name && Number.isFinite(level) && level >= 1);
}

function filledFieldFormatErrors(form: MasterFormLike, editing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [field, message] of Object.entries(validateBasicDetails(form, editing))) {
    const value = String((form as Record<string, string>)[field] ?? "").trim();
    if (!value && field !== "phone") continue;
    if (field === "password" || field === "confirmPassword") continue;
    errors[field] = message;
  }

  for (const [field, message] of Object.entries(validatePayrollDetails(form, editing, null))) {
    const value = String((form as Record<string, string>)[field] ?? "").trim();
    if (!value) continue;
    errors[field] = message;
  }

  for (const [field, message] of Object.entries(validateStatutory(form))) {
    const value = String((form as Record<string, string>)[field] ?? "").trim();
    if (!value) continue;
    errors[field] = message;
  }

  for (const [field, message] of Object.entries(validateDeductions(form))) {
    const value = String((form as Record<string, string>)[field] ?? "").trim();
    if (!value) continue;
    errors[field] = message;
  }

  for (const [field, message] of Object.entries(validateBankDetails(form))) {
    const value = String((form as Record<string, string>)[field] ?? "").trim();
    if (!value) continue;
    errors[field] = message;
  }

  return errors;
}

export type AutosaveReadiness = {
  ok: boolean;
  reason?: string;
};

export function assessAutosaveReadiness(
  form: MasterFormLike,
  editing: boolean,
  editBaseline: MasterFormLike | null,
  existingEmployees: PayrollMasterUniqueRow[],
  editingId: string | null,
): AutosaveReadiness {
  if (!meetsServerDraftThreshold(form)) {
    return {
      ok: false,
      reason: "Enter employee code, name, and pay level to start saving.",
    };
  }

  const formatErrors = filledFieldFormatErrors(form, editing);
  if (Object.keys(formatErrors).length > 0) {
    const first = Object.values(formatErrors)[0];
    return { ok: false, reason: first ?? "Fix highlighted field formats before autosave." };
  }

  const uniqueness = validatePayrollMasterUniqueness(form, existingEmployees, editingId);
  const uniquenessKeys = Object.keys(uniqueness);
  if (uniquenessKeys.length > 0) {
    return { ok: false, reason: uniqueness[uniquenessKeys[0]] ?? "Resolve duplicate values before autosave." };
  }

  if (
    editing &&
    editBaseline &&
    form.effectiveFrom.trim() &&
    form.effectiveFrom !== editBaseline.effectiveFrom &&
    !form.reasonForChange.trim()
  ) {
    return {
      ok: false,
      reason: "Add a reason for change before autosave (effective date changed).",
    };
  }

  return { ok: true };
}

export function serializeAddDraft(form: MasterFormLike): string {
  const { password, confirmPassword, ...rest } = form as MasterFormLike & {
    password?: string;
    confirmPassword?: string;
  };
  void password;
  void confirmPassword;
  return JSON.stringify({ ...rest, password: "", confirmPassword: "" });
}

export function parseAddDraft(raw: string | null): MasterFormLike | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MasterFormLike;
  } catch {
    return null;
  }
}

export function hasMeaningfulAddDraft(form: MasterFormLike, empty: MasterFormLike): boolean {
  const keys = Object.keys(empty) as (keyof MasterFormLike)[];
  return keys.some((key) => {
    if (key === "password" || key === "confirmPassword") return false;
    return String(form[key] ?? "").trim() !== String(empty[key] ?? "").trim();
  });
}
