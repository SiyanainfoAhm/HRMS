/** Shared rules for employee identity fields (Add employee + API). */

export function normalizeDigits(s: string): string {
  return s.replace(/\D/g, "");
}

export function validateEmailField(v: string): string | null {
  const value = v.trim().toLowerCase();
  if (!value) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email (e.g. name@company.com)";
  return null;
}

/** 10-digit Indian mobile (starts with 6–9). */
export function validateIndianMobileDigits(digits: string): string | null {
  if (!digits) return "Phone is required";
  if (digits.length !== 10) return "Phone must be exactly 10 digits";
  if (!/^[6-9]\d{9}$/.test(digits)) return "Enter a valid Indian mobile number (starts with 6–9)";
  return null;
}

export function validateAadhaarDigits(digits: string): string | null {
  if (!digits) return "Aadhaar is required";
  if (digits.length !== 12) return "Aadhaar must be exactly 12 digits";
  if (!/^\d{12}$/.test(digits)) return "Aadhaar must contain only digits";
  return null;
}

/** Blur / progressive UX: length progress, then full rules (incl. Indian mobile prefix). */
export function validateIndianMobileInteractive(digits: string): string | null {
  if (!digits) return "Phone is required";
  if (digits.length < 10) return `Enter 10 digits (${digits.length}/10)`;
  return validateIndianMobileDigits(digits);
}

/** Live validation while typing; empty is allowed (optional phone fields). */
export function validateIndianMobileOptionalInteractive(digits: string): string | null {
  if (!digits) return null;
  if (digits.length < 10) return `Enter 10 digits (${digits.length}/10)`;
  return validateIndianMobileDigits(digits);
}

/** Live validation while typing; empty is allowed until submit with other bank fields. */
export function validateBankAccountInteractive(digits: string): string | null {
  if (!digits) return null;
  if (digits.length < 9) return `Enter 9–18 digits (${digits.length} entered)`;
  return validateBankAccountDigits(digits);
}

/** Live validation while typing; empty is allowed until submit with other bank fields. */
export function validateIfscInteractive(ifsc: string): string | null {
  const code = normalizeIfscInput(ifsc);
  if (!code) return null;
  if (code.length < 11) return `Enter 11 characters (${code.length}/11)`;
  return validateIfscCode(code);
}

export function validateAadhaarInteractive(digits: string): string | null {
  if (!digits) return "Aadhaar is required";
  if (digits.length < 12) return `Enter 12 digits (${digits.length}/12)`;
  return validateAadhaarDigits(digits);
}

/** PAN after normalizing to uppercase A–Z/0–9 only, length 10. */
export function validatePanNormalized(pan: string): string | null {
  const u = pan.trim().toUpperCase();
  if (!u) return "PAN is required";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(u)) {
    return "PAN must be like ABCDE1234F (5 letters, 4 digits, 1 letter)";
  }
  return null;
}

export function normalizePanInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export function normalizeIfscInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
}

export function validateIfscCode(ifsc: string): string | null {
  const code = normalizeIfscInput(ifsc);
  if (!code) return "IFSC is required";
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
    return "IFSC must be 11 characters (e.g. SBIN0001234)";
  }
  return null;
}

export function validateBankAccountDigits(digits: string): string | null {
  if (!digits) return "Account number is required";
  if (!/^\d{9,18}$/.test(digits)) return "Account number must be 9–18 digits";
  return null;
}

export function validateBankName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Bank name is required";
  if (n.length < 2) return "Bank name is too short";
  return null;
}

/** Account holder should match legal full name when provided (invite / profile). */
export function validateBankAccountHolderName(holder: string, legalName?: string): string | null {
  const h = holder.trim();
  if (!h) return "Account holder name is required";
  if (h.length < 2) return "Account holder name is too short";
  if (!/^[a-zA-Z\s.'-]+$/.test(h)) return "Account holder name has invalid characters";
  if (legalName?.trim()) {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    if (norm(h) !== norm(legalName)) {
      return "Account holder name should match your full name";
    }
  }
  return null;
}

export type BankDetailsInput = {
  bankName: string;
  bankAccountHolderName?: string;
  bankAccountNumber: string;
  bankIfsc: string;
  legalName?: string;
};

/** Returns first error message, or null when valid. */
export function validateBankDetails(input: BankDetailsInput): string | null {
  return (
    validateBankName(input.bankName) ??
    validateBankAccountHolderName(input.bankAccountHolderName ?? "", input.legalName) ??
    validateBankAccountDigits(normalizeDigits(input.bankAccountNumber)) ??
    validateIfscCode(input.bankIfsc)
  );
}
