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

// ---------------------------------------------------------------------------
// Save conflicts (HTTP 409): keep what the user typed, merge what others changed.
// ---------------------------------------------------------------------------

export type MergeReport = {
  /** Field values to save: the user's typed values plus other sessions' changes to fields the user did not touch. */
  merged: Record<string, unknown>;
  /** Fields the user changed (kept exactly as typed). */
  keptMine: string[];
  /** Fields only another session changed (taken from the server). */
  takenFromTheirs: string[];
  /** Fields both changed to different values (the user's value is kept). */
  conflicts: string[];
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");

/**
 * Three-way merge of Payroll Master form values.
 *  base   = the values the form was loaded/last saved with
 *  mine   = what the user has now
 *  theirs = the latest values on the server
 * A field the user changed always keeps the user's value.
 */
export function mergeMasterForms(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): MergeReport {
  const merged: Record<string, unknown> = { ...theirs, ...mine };
  const keptMine: string[] = [];
  const takenFromTheirs: string[] = [];
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    if (key === "password" || key === "confirmPassword") {
      merged[key] = mine[key] ?? "";
      continue;
    }
    const mineChanged = !sameValue(base[key], mine[key]);
    const theirsChanged = !sameValue(base[key], theirs[key]);
    if (mineChanged) {
      merged[key] = mine[key];
      keptMine.push(key);
      if (theirsChanged && !sameValue(mine[key], theirs[key])) conflicts.push(key);
    } else if (theirsChanged) {
      merged[key] = theirs[key];
      takenFromTheirs.push(key);
    } else {
      merged[key] = mine[key] ?? theirs[key];
    }
  }
  return { merged, keptMine, takenFromTheirs, conflicts };
}

export type SaveAttempt = { status: number; body: Record<string, unknown> };

export type ConflictSaveResult<F> =
  | { ok: true; form: F; base: F; revision: string | undefined; body: Record<string, unknown>; report: MergeReport | null }
  | { ok: false; form: F; base: F; revision: string | undefined; error: string; status: number; body: Record<string, unknown> };

/**
 * PUT with the current revision; on a 409 fetch the latest server values, merge them
 * with the user's typed values and retry. The form handed in is never discarded:
 * on persistent failure the caller still holds the user's values.
 */
export async function saveWithConflictRetry<F extends Record<string, unknown>>(opts: {
  mine: F;
  base: F;
  revision: string | undefined;
  send: (form: F, revision: string | undefined) => Promise<SaveAttempt>;
  fetchLatest: () => Promise<{ form: F; revision: string | undefined }>;
  maxRetries?: number;
}): Promise<ConflictSaveResult<F>> {
  let mine = opts.mine;
  let base = opts.base;
  let revision = opts.revision;
  let report: MergeReport | null = null;
  const retries = opts.maxRetries ?? 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await opts.send(mine, revision);
    if (res.status >= 200 && res.status < 300) {
      const serverRevision = (res.body?.master as { revision?: string } | undefined)?.revision;
      return { ok: true, form: mine, base: mine, revision: serverRevision ?? revision, body: res.body, report };
    }
    if (res.status !== 409 || attempt === retries) {
      const error = String(res.body?.message ?? res.body?.error ?? "Save failed");
      return { ok: false, form: mine, base, revision, error, status: res.status, body: res.body };
    }
    const latest = await opts.fetchLatest();
    report = mergeMasterForms(base, mine, latest.form);
    mine = report.merged as F;
    base = latest.form;
    revision = latest.revision;
  }
  return { ok: false, form: mine, base, revision, error: "Save failed", status: 409, body: {} };
}

/** Apply only the fields taken from the server onto the form as it is NOW (keeps keystrokes typed during the request). */
export function applyServerFields<F extends Record<string, unknown>>(
  current: F,
  snapshotSent: F,
  report: MergeReport,
): F {
  const next: Record<string, unknown> = { ...current };
  for (const key of report.takenFromTheirs) {
    if (sameValue(current[key], snapshotSent[key])) next[key] = report.merged[key];
  }
  return next as F;
}
