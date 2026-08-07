import { normalizeDigits, normalizePanInput } from "@/lib/employeeValidators";

/** Snapshot of existing payroll master rows for client-side uniqueness checks. */
export type PayrollMasterUniqueRow = {
  id: string;
  employeeCode?: string | null;
  email?: string | null;
  phone?: string | null;
  aadhaar?: string | null;
  pan?: string | null;
  bankAccountNumber?: string | null;
};

export function normalizeEmployeeCode(code: string): string {
  return code.trim().toLowerCase();
}

export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhoneKey(phone: string): string {
  return normalizeDigits(phone);
}

export function normalizeAadhaarKey(aadhaar: string): string {
  return normalizeDigits(aadhaar);
}

export function normalizePanKey(pan: string): string {
  return normalizePanInput(pan);
}

export function normalizeBankAccountKey(account: string): string {
  return normalizeDigits(account);
}

/**
 * Next employee code from existing codes.
 * Preserves leading-zero width for pure numeric series (060 → 063).
 */
export function generateNextEmployeeCode(existingCodes: string[]): string {
  const trimmed = existingCodes.map((c) => c.trim()).filter(Boolean);
  const numericOnly = trimmed.filter((c) => /^\d+$/.test(c));

  if (numericOnly.length > 0) {
    let max = 0;
    let width = 3;
    for (const c of numericOnly) {
      const n = parseInt(c, 10);
      if (!Number.isNaN(n) && n > max) max = n;
      width = Math.max(width, c.length);
    }
    return String(max + 1).padStart(width, "0");
  }

  const withTrailingNum = trimmed
    .map((c) => {
      const m = c.match(/^(.*?)(\d+)$/);
      if (!m) return null;
      return { prefix: m[1], num: parseInt(m[2], 10), width: m[2].length };
    })
    .filter((x): x is { prefix: string; num: number; width: number } => x !== null);

  if (withTrailingNum.length > 0) {
    const byPrefix = new Map<string, { max: number; width: number }>();
    for (const x of withTrailingNum) {
      const cur = byPrefix.get(x.prefix) ?? { max: 0, width: x.width };
      byPrefix.set(x.prefix, {
        max: Math.max(cur.max, x.num),
        width: Math.max(cur.width, x.width),
      });
    }
    let bestPrefix = "";
    let best = { max: 0, width: 3 };
    for (const [prefix, v] of byPrefix) {
      if (v.max >= best.max) {
        bestPrefix = prefix;
        best = v;
      }
    }
    return `${bestPrefix}${String(best.max + 1).padStart(best.width, "0")}`;
  }

  return "001";
}

export function validatePayrollMasterUniqueness(
  form: {
    employeeCode: string;
    email: string;
    phone: string;
    aadhaar: string;
    pan: string;
    bankAccountNumber: string;
  },
  existing: PayrollMasterUniqueRow[],
  editingId?: string | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = editingId ? existing.filter((r) => r.id !== editingId) : existing;

  const codeKey = normalizeEmployeeCode(form.employeeCode);
  if (codeKey) {
    const dup = others.some((r) => normalizeEmployeeCode(r.employeeCode ?? "") === codeKey);
    if (dup) errors.employeeCode = "Employee Code already exists.";
  }

  const emailKey = normalizeEmailKey(form.email);
  if (emailKey) {
    const dup = others.some((r) => normalizeEmailKey(r.email ?? "") === emailKey);
    if (dup) errors.email = "Email already exists.";
  }

  const phoneKey = normalizePhoneKey(form.phone);
  if (phoneKey) {
    const dup = others.some((r) => normalizePhoneKey(r.phone ?? "") === phoneKey);
    if (dup) errors.phone = "Phone number already exists.";
  }

  const aadhaarKey = normalizeAadhaarKey(form.aadhaar);
  if (aadhaarKey) {
    const dup = others.some((r) => normalizeAadhaarKey(r.aadhaar ?? "") === aadhaarKey);
    if (dup) errors.aadhaar = "Aadhaar number already exists.";
  }

  const panKey = normalizePanKey(form.pan);
  if (panKey) {
    const dup = others.some((r) => normalizePanKey(r.pan ?? "") === panKey);
    if (dup) errors.pan = "PAN number already exists.";
  }

  const accountKey = normalizeBankAccountKey(form.bankAccountNumber);
  if (accountKey) {
    const dup = others.some((r) => normalizeBankAccountKey(r.bankAccountNumber ?? "") === accountKey);
    if (dup) errors.bankAccountNumber = "Bank account number already exists.";
  }

  return errors;
}
