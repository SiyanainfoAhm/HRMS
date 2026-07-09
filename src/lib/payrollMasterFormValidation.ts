import { validatePasswordComplexity } from "@/lib/passwordValidators";
import {
  normalizeDigits,
  normalizeIfscInput,
  normalizePanInput,
} from "@/lib/employeeValidators";
import {
  isValidGovernmentPayLevel,
  PAY_LEVEL_INVALID_ERROR,
  PAY_LEVEL_REQUIRED_ERROR,
} from "@/lib/payLevel";
import {
  type PayrollMasterUniqueRow,
  validatePayrollMasterUniqueness,
} from "@/lib/payrollMasterUniqueness";

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
  incrementMonth: string;
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
  loanRecovery: string;
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
  existingEmployees?: PayrollMasterUniqueRow[];
  editingId?: string | null;
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
  "postOffice",
  "creditSociety",
  "electricity",
  "water",
  "loanRecovery",
  "otherDeduction",
  "advance",
] as const;

const TAB_FIELD_ORDER: Record<FormTabId, readonly string[]> = {
  basic: [
    "employeeCode",
    "name",
    "email",
    "userRole",
    "password",
    "confirmPassword",
    "payLevel",
    "incrementMonth",
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

  if (!form.employeeCode.trim()) {
    errors.employeeCode = "Employee code is required.";
  }

  if (!form.name.trim()) errors.name = "Name is required.";
  if (!form.email.trim()) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email.";

  if (!form.designation.trim()) errors.designation = "Designation is required.";

  const level = parseInt(form.payLevel, 10);
  if (!form.payLevel.trim()) {
    errors.payLevel = PAY_LEVEL_REQUIRED_ERROR;
  } else if (!isValidGovernmentPayLevel(level)) {
    errors.payLevel = PAY_LEVEL_INVALID_ERROR;
  }

  if (!form.incrementMonth.trim()) {
    errors.incrementMonth = "Increment Month is required.";
  } else if (!["January", "July"].includes(form.incrementMonth)) {
    errors.incrementMonth = "Increment month must be January or July.";
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

  const phoneDigits = normalizeDigits(form.phone);
  if (phoneDigits) {
    if (phoneDigits.length !== 10) {
      errors.phone = "Enter a valid 10-digit phone number.";
    } else if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
      errors.phone = "Enter a valid 10-digit phone number.";
    }
  }

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

  const panNorm = normalizePanInput(form.pan);
  if (!panNorm) {
    errors.pan = "PAN is required.";
  } else if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panNorm)) {
    errors.pan = "Enter a valid PAN number.";
  }

  const aadhaarDigits = normalizeDigits(form.aadhaar);
  if (!aadhaarDigits) {
    errors.aadhaar = "Aadhaar number is required.";
  } else if (!/^\d{12}$/.test(aadhaarDigits)) {
    errors.aadhaar = "Enter a valid 12-digit Aadhaar number.";
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
    postOffice: "Post Office",
    creditSociety: "Credit Society",
    electricity: "Electricity",
    water: "Water",
    loanRecovery: "Bank Recovery",
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
    existingEmployees: options?.existingEmployees ?? [],
    editingId: options?.editingId ?? null,
  };

  const basic = validateBasicDetails(form, editing);
  const payroll = validatePayrollDetails(form, editing, editBaseline);
  const statutory = validateStatutory(form);
  const deductions = validateDeductions(form);
  const bank = validateBankDetails(form);
  const uniqueness = validatePayrollMasterUniqueness(form, opts.existingEmployees ?? [], opts.editingId);

  const slices: Record<FormTabId, Record<string, string>> = {
    basic: { ...basic, ...pickUniqueness(uniqueness, ["employeeCode", "email", "phone"]) },
    payroll,
    statutory: { ...statutory, ...pickUniqueness(uniqueness, ["aadhaar", "pan"]) },
    deductions,
    bank: { ...bank, ...pickUniqueness(uniqueness, ["bankAccountNumber"]) },
  };

  const errors = {
    ...basic,
    ...payroll,
    ...statutory,
    ...deductions,
    ...bank,
    ...uniqueness,
  };

  const tabStatus: Record<FormTabId, TabStatus> = {
    basic: computeTabStatus("basic", slices.basic, opts),
    payroll: computeTabStatus("payroll", slices.payroll, opts),
    statutory: computeTabStatus("statutory", slices.statutory, opts),
    deductions: computeTabStatus("deductions", slices.deductions, opts),
    bank: computeTabStatus("bank", slices.bank, opts),
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

function pickUniqueness(errors: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (errors[key]) out[key] = errors[key];
  }
  return out;
}

/** Map backend error messages to form field keys when possible. */
export function mapApiErrorToField(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("employee code")) return "employeeCode";
  if (m.includes("email")) return "email";
  if (m.includes("phone")) return "phone";
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
