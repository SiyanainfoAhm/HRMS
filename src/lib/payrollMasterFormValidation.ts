import { validatePasswordComplexity } from "@/lib/passwordValidators";
import {
  normalizeDigits,
  normalizeIfscInput,
  validateIndianMobileOptionalInteractive,
} from "@/lib/employeeValidators";

/** Mirrors MasterFormState in PayrollMasterScreen — kept loose to avoid circular imports. */
export type MasterFormLike = {
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  dateOfJoining: string;
  designation: string;
  department: string;
  division: string;
  status: string;
  payLevel: string;
  grossBasicPay: string;
  daPercent: string;
  hraPercent: string;
  medical: string;
  uan: string;
  cpfNo: string;
  pan: string;
  aadhaar: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  professionalTax: string;
  incomeTax: string;
  lic: string;
  mess: string;
  welfare: string;
  vpf: string;
  pfLoan: string;
  postOffice: string;
  creditSociety: string;
  standardLicenceFee: string;
  electricity: string;
  water: string;
  horticulture: string;
  vehicleCharge: string;
  otherDeduction: string;
  advance: string;
  effectiveFrom: string;
  reasonForChange: string;
  userRole: string;
  password: string;
  confirmPassword: string;
};

export type FormTabId = "basic" | "payroll" | "statutory" | "deductions" | "bank";
export type TabStatus = "neutral" | "complete" | "error";

export type ValidateEmployeeFormOptions = {
  mode: "add" | "edit";
  submitAttempted: boolean;
  touched: Record<string, boolean>;
  visitedTabs: Partial<Record<FormTabId, boolean>>;
};

export type EmployeeFormValidation = {
  isValid: boolean;
  errors: Record<string, string>;
  tabStatus: Record<FormTabId, TabStatus>;
  firstErrorTab: FormTabId | null;
  firstErrorField: string | null;
};

const VARIABLE_DEDUCTION_KEYS = [
  "incomeTax",
  "lic",
  "mess",
  "welfare",
  "vpf",
  "pfLoan",
  "postOffice",
  "creditSociety",
  "standardLicenceFee",
  "electricity",
  "water",
  "horticulture",
  "vehicleCharge",
  "otherDeduction",
  "advance",
] as const;

const TAB_FIELD_ORDER: Record<FormTabId, readonly string[]> = {
  basic: [
    "name",
    "email",
    "userRole",
    "password",
    "confirmPassword",
    "payLevel",
    "designation",
    "status",
    "phone",
  ],
  payroll: ["grossBasicPay", "daPercent", "hraPercent", "medical", "effectiveFrom", "reasonForChange"],
  statutory: ["aadhaar", "uan", "cpfNo", "pan", "professionalTax"],
  deductions: VARIABLE_DEDUCTION_KEYS,
  bank: ["bankName", "bankAccountNumber", "bankIfsc"],
};

const TAB_ORDER: FormTabId[] = ["basic", "payroll", "statutory", "deductions", "bank"];
const REQUIRED_TABS = new Set<FormTabId>(["basic", "payroll", "statutory", "bank"]);

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function nonNegNumberError(value: string, label: string): string | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return `${label} must be ≥ 0.`;
  return null;
}

function tabHasTouchedFields(tab: FormTabId, opts: ValidateEmployeeFormOptions): boolean {
  return TAB_FIELD_ORDER[tab].some((f) => opts.touched[f]);
}

function tabEngagedForComplete(tab: FormTabId, opts: ValidateEmployeeFormOptions): boolean {
  return tabHasTouchedFields(tab, opts) || Boolean(opts.visitedTabs[tab]);
}

function computeTabStatus(
  tab: FormTabId,
  slice: Record<string, string>,
  opts: ValidateEmployeeFormOptions,
): TabStatus {
  const hasErrors = Object.keys(slice).length > 0;
  const isRequiredTab = REQUIRED_TABS.has(tab);

  if (opts.submitAttempted) {
    return hasErrors ? "error" : "complete";
  }

  if (hasErrors) {
    return tabHasTouchedFields(tab, opts) ? "error" : "neutral";
  }

  // No validation errors in this tab slice
  if (isRequiredTab) {
    if (opts.mode === "edit") return "complete";
    return tabEngagedForComplete(tab, opts) ? "complete" : "neutral";
  }

  // Optional tab — only show complete after user visits or interacts
  return tabEngagedForComplete(tab, opts) ? "complete" : "neutral";
}

export function validateBasicDetails(form: MasterFormLike, editing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!form.name.trim()) errors.name = "Name is required.";
  if (!form.email.trim()) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email.";

  if (!form.designation.trim()) errors.designation = "Designation is required.";

  const level = parseInt(form.payLevel, 10);
  if (!form.payLevel.trim() || !Number.isFinite(level) || level < 1) {
    errors.payLevel = "Pay level is required.";
  }

  if (!form.status.trim()) errors.status = "Status is required.";
  if (!form.userRole.trim()) errors.userRole = "User role is required.";

  if (!editing) {
    if (!form.password.trim()) errors.password = "Password is required.";
    else {
      const pErr = validatePasswordComplexity(form.password);
      if (pErr) errors.password = pErr;
    }
    if (!form.confirmPassword.trim()) errors.confirmPassword = "Please confirm the password.";
    else if (form.password !== form.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  } else if (form.password.trim() || form.confirmPassword.trim()) {
    const pErr = validatePasswordComplexity(form.password);
    if (pErr) errors.password = pErr;
    if (!form.confirmPassword.trim()) errors.confirmPassword = "Please confirm the password.";
    else if (form.password !== form.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  }

  const phoneErr = validateIndianMobileOptionalInteractive(normalizeDigits(form.phone));
  if (phoneErr) errors.phone = phoneErr;

  return errors;
}

export function validatePayrollDetails(
  form: MasterFormLike,
  editing: boolean,
  editBaseline: MasterFormLike | null,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const gross = parseFloat(form.grossBasicPay);
  if (!form.grossBasicPay.trim() || !Number.isFinite(gross) || gross <= 0) {
    errors.grossBasicPay = "Gross Basic Pay is required.";
  }

  const da = parseFloat(form.daPercent);
  if (!form.daPercent.trim() || !Number.isFinite(da) || da < 0) {
    errors.daPercent = "DA % is required.";
  }

  const hra = parseFloat(form.hraPercent);
  if (!form.hraPercent.trim() || !Number.isFinite(hra) || hra < 0) {
    errors.hraPercent = "HRA % is required.";
  }

  if (!form.effectiveFrom.trim() || !isYmd(form.effectiveFrom)) {
    errors.effectiveFrom = "Effective From is required.";
  }

  if (form.medical.trim()) {
    const med = parseFloat(form.medical);
    if (!Number.isFinite(med) || med < 0) errors.medical = "Medical must be ≥ 0.";
  }

  if (editing && editBaseline && form.effectiveFrom !== editBaseline.effectiveFrom && !form.reasonForChange.trim()) {
    errors.reasonForChange = "Reason for change is required when revising effective date.";
  }

  return errors;
}

export function validateStatutory(form: MasterFormLike): Record<string, string> {
  const errors: Record<string, string> = {};

  if (form.pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(form.pan.trim())) {
    errors.pan = "Invalid PAN format.";
  }

  const aadhaarDigits = normalizeDigits(form.aadhaar);
  if (!aadhaarDigits) {
    errors.aadhaar = "Aadhaar number is required.";
  } else if (!/^\d{12}$/.test(aadhaarDigits)) {
    errors.aadhaar = "Aadhaar must be a valid 12-digit number.";
  }

  const ptErr = nonNegNumberError(form.professionalTax, "Professional Tax");
  if (ptErr) errors.professionalTax = ptErr;

  return errors;
}

export function validateDeductions(form: MasterFormLike): Record<string, string> {
  const errors: Record<string, string> = {};
  const labels: Record<string, string> = {
    incomeTax: "Income Tax",
    lic: "LIC",
    mess: "Mess",
    welfare: "Welfare",
    vpf: "VPF",
    pfLoan: "PF Loan",
    postOffice: "Post Office",
    creditSociety: "Credit Society",
    standardLicenceFee: "Std Licence Fee",
    electricity: "Electricity",
    water: "Water",
    horticulture: "Horticulture",
    vehicleCharge: "Vehicle Charge",
    otherDeduction: "Other Deduction",
    advance: "Advance",
  };

  for (const key of VARIABLE_DEDUCTION_KEYS) {
    const value = form[key];
    const err = nonNegNumberError(value, labels[key] ?? key);
    if (err) errors[key] = err;
  }

  return errors;
}

export function validateBankDetails(form: MasterFormLike): Record<string, string> {
  const errors: Record<string, string> = {};
  const accountDigits = normalizeDigits(form.bankAccountNumber);
  const ifscNorm = normalizeIfscInput(form.bankIfsc);
  const bankNameTrim = form.bankName.trim();

  if (!bankNameTrim) {
    errors.bankName = "Bank name is required.";
  }

  if (!accountDigits) {
    errors.bankAccountNumber = "Account number is required.";
  } else if (!/^\d{9,18}$/.test(accountDigits)) {
    errors.bankAccountNumber = "Account number must be 9–18 digits.";
  }

  if (!ifscNorm) {
    errors.bankIfsc = "IFSC is required.";
  } else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifscNorm)) {
    errors.bankIfsc = "Enter a valid IFSC code.";
  }

  return errors;
}

function firstFieldInTab(tab: FormTabId, tabErrors: Record<string, string>): string | null {
  for (const field of TAB_FIELD_ORDER[tab]) {
    if (tabErrors[field]) return field;
  }
  return Object.keys(tabErrors)[0] ?? null;
}

export function validateEmployeeForm(
  form: MasterFormLike,
  editing: boolean,
  editBaseline: MasterFormLike | null,
  options?: Partial<ValidateEmployeeFormOptions>,
): EmployeeFormValidation {
  const opts: ValidateEmployeeFormOptions = {
    mode: editing ? "edit" : "add",
    submitAttempted: options?.submitAttempted ?? false,
    touched: options?.touched ?? {},
    visitedTabs: options?.visitedTabs ?? {},
  };

  const basic = validateBasicDetails(form, editing);
  const payroll = validatePayrollDetails(form, editing, editBaseline);
  const statutory = validateStatutory(form);
  const deductions = validateDeductions(form);
  const bank = validateBankDetails(form);

  const slices: Record<FormTabId, Record<string, string>> = {
    basic,
    payroll,
    statutory,
    deductions,
    bank,
  };

  const errors = { ...basic, ...payroll, ...statutory, ...deductions, ...bank };

  const tabStatus: Record<FormTabId, TabStatus> = {
    basic: computeTabStatus("basic", basic, opts),
    payroll: computeTabStatus("payroll", payroll, opts),
    statutory: computeTabStatus("statutory", statutory, opts),
    deductions: computeTabStatus("deductions", deductions, opts),
    bank: computeTabStatus("bank", bank, opts),
  };

  let firstErrorTab: FormTabId | null = null;
  let firstErrorField: string | null = null;

  for (const tab of TAB_ORDER) {
    const slice = slices[tab];
    if (Object.keys(slice).length > 0) {
      firstErrorTab = tab;
      firstErrorField = firstFieldInTab(tab, slice);
      break;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    tabStatus,
    firstErrorTab,
    firstErrorField,
  };
}

/** Map backend error messages to form field keys when possible. */
export function mapApiErrorToField(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("email")) return "email";
  if (m.includes("password")) return "password";
  if (m.includes("designation")) return "designation";
  if (m.includes("gross")) return "grossBasicPay";
  if (m.includes("pay level")) return "payLevel";
  if (m.includes("ifsc")) return "bankIfsc";
  if (m.includes("account")) return "bankAccountNumber";
  if (m.includes("bank name")) return "bankName";
  if (m.includes("pan")) return "pan";
  if (m.includes("aadhaar")) return "aadhaar";
  return null;
}

export function fieldDomId(field: string): string {
  return `pm-field-${field}`;
}
