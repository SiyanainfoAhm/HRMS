"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  fieldDomId,
  mapApiErrorToField,
  validateEmployeeForm,
  type FormTabId,
  type TabStatus,
} from "@/lib/payrollMasterFormValidation";
import {
  generateNextEmployeeCode,
  type PayrollMasterUniqueRow,
} from "@/lib/payrollMasterUniqueness";
import {
  downloadImportValidationReport,
  formatImportFieldLabel,
  type ImportValidationIssue,
} from "@/lib/payrollMasterImportReport";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ToastProvider";
import { SkeletonCard } from "@/components/Skeleton";
import { AppCard } from "@/components/ui/AppCard";
import { AppPageError } from "@/components/ui/AppPageError";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileUpload } from "@/components/ui/FileUpload";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/SelectField";
import {
  getUnresolvedOrgInput,
  OrgLookupCombobox,
  type OrgLookupOption,
} from "@/components/ui/OrgLookupCombobox";
import { PayrollMasterDataGrid } from "@/components/payroll/PayrollMasterDataGrid";
import { PasswordField } from "@/components/PasswordField";
import { dispatchHrmsChange, onHrmsChange } from "@/lib/hrmsChangeBus";
import {
  computePayrollMasterPreview,
  deriveEarningFieldValues,
  DEFAULT_DA_PERCENT,
  DEFAULT_HRA_PERCENT,
  DEFAULT_MEDICAL,
} from "@/lib/payrollMasterCalc";
import { GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS } from "@/lib/governmentPayroll";
import { resolveNightAllowanceRateByPayLevel } from "@/lib/nightAllowanceCalculation";
import {
  DEFAULT_CPF_BASIS_KEYS,
  isCpfCompanyDefaultMode,
  isCpfEmployeeCustomMode,
  normalizeCpfUseCompanySettings,
  resolveEffectiveCpfConfigForMaster,
} from "@/lib/payrollCpfCalculation";
import {
  normalizeDigits,
  normalizeIfscInput,
  normalizePanInput,
} from "@/lib/employeeValidators";
import { DynamicPayrollFields } from "@/components/payroll/DynamicPayrollFields";
import { CpfCalculationSettingsForm } from "@/components/payroll/CpfCalculationSettingsForm";
import type { PayrollFieldDefinition } from "@/lib/payrollFieldTypes";
import {
  customNumericBagForTotalFromValues,
} from "@/lib/payrollFieldTypes";
import { isAdminRole, normalizeRole, type AppRole } from "@/lib/roles";
import {
  assessAutosaveReadiness,
  autosaveDebounceMs,
  hasMeaningfulAddDraft,
  meetsServerDraftThreshold,
  parseAddDraft,
  PAYROLL_MASTER_ADD_DRAFT_KEY,
  readAutosaveEnabled,
  serializeAddDraft,
  writeAutosaveEnabled,
} from "@/lib/payrollMasterAutosave";

export type PayrollMasterRecord = {
  id: string;
  employeeCode?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  designation?: string | null;
  department?: string | null;
  division?: string | null;
  payLevel?: number | null;
  incrementMonth?: string | null;
  grossBasicPay?: number | null;
  daPercent?: number | null;
  da_percent?: number | null;
  daAmount?: number | null;
  hraPercent?: number | null;
  hra_percent?: number | null;
  hraAmount?: number | null;
  medical?: number | null;
  transportBase?: number | null;
  transportDa?: number | null;
  transportTotal?: number | null;
  totalEarnings?: number | null;
  cpfDefault?: number | null;
  cpfEffective?: number | null;
  daCpf?: number | null;
  professionalTax?: number | null;
  incomeTax?: number | null;
  lic?: number | null;
  mess?: number | null;
  welfare?: number | null;
  vpf?: number | null;
  pfLoan?: number | null;
  postOffice?: number | null;
  creditSociety?: number | null;
  standardLicenceFee?: number | null;
  electricity?: number | null;
  water?: number | null;
  loanRecovery?: number | null;
  vehicleCharge?: number | null;
  otherDeduction?: number | null;
  advance?: number | null;
  takeHome?: number | null;
  uan?: string | null;
  cpfNo?: string | null;
  pan?: string | null;
  aadhaar?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  dateOfJoining?: string | null;
  dateOfBirth?: string | null;
  status?: string | null;
  remarks?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  reasonForChange?: string | null;
  isCurrent?: boolean;
  rowType?: "CURRENT" | "HISTORY" | "SUPERSEDED" | string;
  archivedAt?: string | null;
  userRole?: AppRole | string | null;
  customFieldValues?: Record<string, string>;
  hasQuarter?: boolean;
  quarterId?: string | null;
  quarterName?: string | null;
  quarterType?: string | null;
  quarterRent?: number | null;
  hraEligible?: boolean;
  cpfUseCompanySettings?: boolean;
  cpfPercentageOverride?: number | null;
  cpfBasisFieldKeysOverride?: string[];
  cpfSettings?: {
    cpfUseCompanySettings?: boolean;
    cpfPercentageOverride?: number | null;
    cpfBasisFieldKeysOverride?: string[];
    companySettings?: { cpfFormulaPreview?: string; cpfPercentage?: number; cpfBasisFieldKeys?: string[] };
    effectiveSettings?: { cpfFormulaPreview?: string; cpfPercentage?: number; cpfBasisFieldKeys?: string[]; source?: string };
  };
};

type MasterFormState = {
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  dateOfJoining: string;
  designation: string;
  designationId: string;
  department: string;
  departmentId: string;
  division: string;
  divisionId: string;
  status: string;
  payLevel: string;
  incrementMonth: string;
  grossBasicPay: string;
  daPercent: string;
  daAmount: string;
  hraPercent: string;
  hraAmount: string;
  medical: string;
  transportBase: string;
  transportDa: string;
  transportTotal: string;
  totalEarnings: string;
  uan: string;
  cpfNo: string;
  pan: string;
  aadhaar: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  cpfDefault: string;
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
  remarks: string;
  effectiveFrom: string;
  reasonForChange: string;
  userRole: AppRole;
  password: string;
  confirmPassword: string;
  customFieldValues: Record<string, string>;
  cpfUseCompanySettings: boolean;
  cpfPercentageOverride: string;
  cpfBasisFieldKeys: string[];
  cpfCalculationMode: "percentage" | "fixed_amount";
  cpfFixedAmount: string;
  hasQuarter: boolean;
  quarterId: string;
  quarterRent: string;
};

type ImportError = { row: number; field: string; message: string };

type ImportIssue = { field: string; message: string; type?: "error" | "warning" | string };

type ImportPreviewRow = {
  row: number;
  employeeCode?: string | null;
  employeeName?: string | null;
  employeeLabel?: string | null;
  name?: string | null;
  email?: string | null;
  designation?: string | null;
  payLevel?: string | number | null;
  grossBasicPay?: string | number | null;
  status?: string | null;
  remarks?: string | null;
  action: "insert" | "update" | string;
  valid: boolean;
  errors: ImportIssue[];
  warnings?: ImportIssue[];
};

type ImportFileError = {
  field: string;
  message: string;
  missing_columns?: string[];
};

type ImportPreview = {
  summary: Record<string, number>;
  rows: ImportPreviewRow[];
  fileErrors: ImportFileError[];
  canImport?: boolean;
  requiresConfirmation?: boolean;
  blockedMessage?: string | null;
  issues?: ImportValidationIssue[];
};

const STATUS_OPTIONS = ["active", "inactive", "retired", "deceased", "resigned"] as const;

const DEFAULT_DEDUCTION_FIELDS = [["professionalTax", "Professional Tax (PT)"]] as const;

const VARIABLE_DEDUCTION_FIELDS = [
  ["incomeTax", "Income Tax"],
  ["lic", "LIC"],
  ["mess", "Mess"],
  ["welfare", "Welfare"],
  ["vpf", "VPF"],
  ["postOffice", "Post Office"],
  ["creditSociety", "Credit Society"],
  ["electricity", "Electricity"],
  ["water", "Water"],
  ["loanRecovery", "Bank Recovery"],
  ["otherDeduction", "Other Deduction"],
  ["advance", "Advance"],
] as const;

const EARNINGS_COLUMN_COUNT = 12;
const DEFAULT_DEDUCTION_COLUMN_COUNT = 3;
const VARIABLE_DEDUCTION_COLUMN_COUNT = 12;

type OrgDivision = { id: string; name: string };
type OrgDepartment = { id: string; name: string; divisionId: string | null };
type OrgDesignation = { id: string; title: string };

function syncOrgIdsFromNames(
  f: MasterFormState,
  divs: OrgDivision[],
  deps: OrgDepartment[],
  desigs: OrgDesignation[],
): MasterFormState {
  const next = { ...f };
  if (!next.divisionId.trim() && next.division.trim()) {
    const division = divs.find((d) => d.name.toLowerCase() === next.division.trim().toLowerCase());
    if (division) next.divisionId = division.id;
  }
  if (!next.designationId.trim() && next.designation.trim()) {
    const designation = desigs.find((d) => d.title.toLowerCase() === next.designation.trim().toLowerCase());
    if (designation) next.designationId = designation.id;
  }
  if (!next.departmentId.trim() && next.department.trim()) {
    const department = deps.find((d) => d.name.toLowerCase() === next.department.trim().toLowerCase());
    if (department) next.departmentId = department.id;
  }
  return next;
}

const EARNING_DRIVER_KEYS = new Set([
  "payLevel",
  "grossBasicPay",
  "daPercent",
  "hraPercent",
  "medical",
  "hasQuarter",
]);

function previewEarningDefaults(
  form: Pick<MasterFormState, "payLevel" | "grossBasicPay" | "daPercent" | "hraPercent" | "medical" | "hasQuarter">,
) {
  const derived = deriveEarningFieldValues({
    payLevel: form.payLevel,
    grossBasicPay: form.grossBasicPay,
    daPercent: form.daPercent,
    hraPercent: form.hraPercent,
    medical: form.medical,
    hasQuarter: form.hasQuarter,
  });
  return {
    daAmount: String(derived.daAmount),
    hraAmount: String(derived.hraAmount),
    transportBase: String(derived.transportBase),
    transportDa: String(derived.transportDa),
    transportTotal: String(derived.transportTotal),
    totalEarnings: String(derived.totalEarnings),
  };
}

const emptyForm = (defaultDa = DEFAULT_DA_PERCENT, defaultHra = DEFAULT_HRA_PERCENT): MasterFormState => {
  const base = {
    employeeCode: "",
    name: "",
    email: "",
    phone: "",
    gender: "",
    dateOfBirth: "",
    dateOfJoining: "",
    designation: "",
    designationId: "",
    department: "",
    departmentId: "",
    division: "",
    divisionId: "",
    status: "active",
    payLevel: "1",
    incrementMonth: "July",
    grossBasicPay: "",
    daPercent: String(defaultDa),
    hraPercent: String(defaultHra),
    medical: String(DEFAULT_MEDICAL),
    uan: "",
    cpfNo: "",
    pan: "",
    aadhaar: "",
    bankName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    cpfDefault: "0",
    professionalTax: "200",
    incomeTax: "0",
    lic: "0",
    mess: "0",
    welfare: "0",
    vpf: "0",
    pfLoan: "0",
    postOffice: "0",
    creditSociety: "0",
    standardLicenceFee: "0",
    electricity: "0",
    water: "0",
    loanRecovery: "0",
    vehicleCharge: "0",
    otherDeduction: "0",
    advance: "0",
    remarks: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reasonForChange: "",
    userRole: "employee" as AppRole,
    password: "",
    confirmPassword: "",
    customFieldValues: {},
    cpfUseCompanySettings: true,
    cpfPercentageOverride: "",
    cpfBasisFieldKeys: [] as string[],
    cpfCalculationMode: "percentage" as const,
    cpfFixedAmount: "0",
    hasQuarter: false,
    quarterId: "",
    quarterRent: "0",
  };

  return {
    ...base,
    ...previewEarningDefaults(base),
  };
};

function formFromRecord(r: PayrollMasterRecord): MasterFormState {
  const base = {
    employeeCode: r.employeeCode ?? "",
    name: r.name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    gender: r.gender ?? "",
    dateOfBirth: r.dateOfBirth?.slice(0, 10) ?? "",
    dateOfJoining: r.dateOfJoining?.slice(0, 10) ?? "",
    designation: r.designation ?? "",
    designationId: "",
    department: r.department ?? "",
    departmentId: "",
    division: r.division ?? "",
    divisionId: "",
    status: r.status ?? "active",
    payLevel: String(r.payLevel ?? 1),
    incrementMonth: r.incrementMonth ?? "July",
    grossBasicPay: String(r.grossBasicPay ?? ""),
    daPercent: String(r.daPercent ?? DEFAULT_DA_PERCENT),
    hraPercent: String(r.hraPercent ?? DEFAULT_HRA_PERCENT),
    medical: String(r.medical ?? DEFAULT_MEDICAL),
    uan: r.uan ?? "",
    cpfNo: r.cpfNo ?? "",
    pan: r.pan ?? "",
    aadhaar: r.aadhaar ?? "",
    bankName: r.bankName ?? "",
    bankAccountNumber: r.bankAccountNumber ?? "",
    bankIfsc: r.bankIfsc ?? "",
    cpfDefault: "0",
    professionalTax: String(r.professionalTax ?? 200),
    incomeTax: String(r.incomeTax ?? 0),
    lic: String(r.lic ?? 0),
    mess: String(r.mess ?? 0),
    welfare: String(r.welfare ?? 0),
    vpf: String(r.vpf ?? 0),
    pfLoan: String(r.pfLoan ?? 0),
    postOffice: String(r.postOffice ?? 0),
    creditSociety: String(r.creditSociety ?? 0),
    standardLicenceFee: String(r.standardLicenceFee ?? 0),
    electricity: String(r.electricity ?? 0),
    water: String(r.water ?? 0),
    loanRecovery: String(r.loanRecovery ?? 0),
    vehicleCharge: String(r.vehicleCharge ?? 0),
    otherDeduction: String(r.otherDeduction ?? 0),
    advance: String(r.advance ?? 0),
    remarks: r.remarks ?? "",
    effectiveFrom: r.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    reasonForChange: "",
    userRole: normalizeRole(r.userRole ?? "employee"),
    password: "",
    confirmPassword: "",
    customFieldValues: { ...(r.customFieldValues ?? {}) },
    cpfUseCompanySettings: normalizeCpfUseCompanySettings(
      r.cpfSettings?.cpfUseCompanySettings ?? (r as { cpfUseCompanySettings?: boolean }).cpfUseCompanySettings,
      true,
    ),
    cpfPercentageOverride: String(
      r.cpfSettings?.cpfPercentageOverride ??
        (r as { cpfPercentageOverride?: number | null }).cpfPercentageOverride ??
        r.cpfSettings?.effectiveSettings?.cpfPercentage ??
        "",
    ),
    cpfBasisFieldKeys: (() => {
      const useCompany = normalizeCpfUseCompanySettings(
        r.cpfSettings?.cpfUseCompanySettings ?? (r as { cpfUseCompanySettings?: boolean }).cpfUseCompanySettings,
        true,
      );
      const override =
        r.cpfSettings?.cpfBasisFieldKeysOverride ??
        (r as { cpfBasisFieldKeysOverride?: string[] }).cpfBasisFieldKeysOverride ??
        [];
      if (!useCompany) {
        if (override.length > 0) return override;
        return r.cpfSettings?.effectiveSettings?.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS;
      }
      return override;
    })(),
    cpfCalculationMode: ((): "percentage" | "fixed_amount" => {
      const useCompany = normalizeCpfUseCompanySettings(
        r.cpfSettings?.cpfUseCompanySettings ?? (r as { cpfUseCompanySettings?: boolean }).cpfUseCompanySettings,
        true,
      );
      if (useCompany) {
        const m = (r.cpfSettings?.companySettings as { cpfCalculationMode?: string } | undefined)?.cpfCalculationMode;
        return m === "fixed_amount" ? "fixed_amount" : "percentage";
      }
      const m =
        (r as { cpfCalculationMode?: string }).cpfCalculationMode ??
        (r.cpfSettings?.effectiveSettings as { cpfCalculationMode?: string } | undefined)?.cpfCalculationMode;
      return m === "fixed_amount" ? "fixed_amount" : "percentage";
    })(),
    cpfFixedAmount: String(
      (r as { cpfFixedAmount?: number | null }).cpfFixedAmount ??
        (r.cpfSettings?.effectiveSettings as { cpfFixedAmount?: number } | undefined)?.cpfFixedAmount ??
        0,
    ),
    hasQuarter: Boolean(r.hasQuarter),
    quarterId: r.quarterId ?? "",
    quarterRent: String(r.quarterRent ?? 0),
  };
  const defaults = previewEarningDefaults(base);

  return {
    ...base,
    daAmount: r.daAmount != null ? String(r.daAmount) : defaults.daAmount,
    hraAmount: r.hraAmount != null ? String(r.hraAmount) : defaults.hraAmount,
    transportBase: r.transportBase != null ? String(r.transportBase) : defaults.transportBase,
    transportDa: r.transportDa != null ? String(r.transportDa) : defaults.transportDa,
    transportTotal: r.transportTotal != null ? String(r.transportTotal) : defaults.transportTotal,
    totalEarnings: r.totalEarnings != null ? String(r.totalEarnings) : defaults.totalEarnings,
  };
}

function formToPayload(form: MasterFormState) {
  return {
    employeeCode: form.employeeCode.trim() || undefined,
    name: form.name.trim(),
    email: form.email.trim() || undefined,
    phone: normalizeDigits(form.phone) || undefined,
    gender: form.gender || undefined,
    dateOfBirth: form.dateOfBirth || undefined,
    dateOfJoining: form.dateOfJoining || undefined,
    designation: form.designation.trim(),
    department: form.department.trim() || undefined,
    division: form.division.trim() || undefined,
    status: form.status,
    payLevel: parseInt(form.payLevel, 10),
    incrementMonth: form.incrementMonth,
    grossBasicPay: parseFloat(form.grossBasicPay) || 0,
    daPercent: Number.isFinite(parseFloat(form.daPercent)) ? parseFloat(form.daPercent) : DEFAULT_DA_PERCENT,
    daAmount: parseFloat(form.daAmount) || 0,
    hraPercent: Number.isFinite(parseFloat(form.hraPercent)) ? parseFloat(form.hraPercent) : DEFAULT_HRA_PERCENT,
    hraAmount: parseFloat(form.hraAmount) || 0,
    medical: parseFloat(form.medical) || DEFAULT_MEDICAL,
    transportBase: parseFloat(form.transportBase) || 0,
    transportDa: parseFloat(form.transportDa) || 0,
    transportTotal: parseFloat(form.transportTotal) || 0,
    totalEarnings: parseFloat(form.totalEarnings) || 0,
    uan: form.uan.trim() || undefined,
    cpfNo: form.cpfNo.trim() || undefined,
    pan: form.pan.trim().toUpperCase() || undefined,
    aadhaar: form.aadhaar.replace(/\D/g, "") || undefined,
    bankName: form.bankName.trim() || undefined,
    bankAccountNumber: normalizeDigits(form.bankAccountNumber) || undefined,
    bankIfsc: normalizeIfscInput(form.bankIfsc) || undefined,
    cpfDefault: 0,
    professionalTax: parseFloat(form.professionalTax) || 0,
    incomeTax: parseFloat(form.incomeTax) || 0,
    lic: parseFloat(form.lic) || 0,
    mess: parseFloat(form.mess) || 0,
    welfare: parseFloat(form.welfare) || 0,
    vpf: parseFloat(form.vpf) || 0,
    pfLoan: parseFloat(form.pfLoan) || 0,
    postOffice: parseFloat(form.postOffice) || 0,
    creditSociety: parseFloat(form.creditSociety) || 0,
    standardLicenceFee: parseFloat(form.standardLicenceFee) || 0,
    electricity: parseFloat(form.electricity) || 0,
    water: parseFloat(form.water) || 0,
    loanRecovery: parseFloat(form.loanRecovery) || 0,
    vehicleCharge: parseFloat(form.vehicleCharge) || 0,
    otherDeduction: parseFloat(form.otherDeduction) || 0,
    advance: parseFloat(form.advance) || 0,
    remarks: form.remarks.trim() || undefined,
    effectiveFrom: form.effectiveFrom || undefined,
    reasonForChange: form.reasonForChange.trim() || undefined,
    role: form.userRole,
    customFieldValues: form.customFieldValues,
    cpfUseCompanySettings: isCpfCompanyDefaultMode(form.cpfUseCompanySettings),
    cpfPercentageOverride: isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
      ? null
      : parseFloat(form.cpfPercentageOverride) || 0,
    cpfBasisFieldKeysOverride: isCpfEmployeeCustomMode(form.cpfUseCompanySettings) ? form.cpfBasisFieldKeys : [],
    cpfCalculationMode: isCpfEmployeeCustomMode(form.cpfUseCompanySettings) ? form.cpfCalculationMode : undefined,
    cpfFixedAmount: isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
      ? undefined
      : form.cpfCalculationMode === "fixed_amount"
        ? parseFloat(form.cpfFixedAmount) || 0
        : undefined,
    hasQuarter: form.hasQuarter,
    quarterId: form.hasQuarter ? form.quarterId || null : null,
    quarterRent: form.hasQuarter ? parseFloat(form.quarterRent) || 0 : 0,
    ...(form.password.trim() ? { password: form.password } : {}),
  };
}

function formAutosaveSnapshot(f: MasterFormState): string {
  const { password, confirmPassword, ...rest } = f;
  void password;
  void confirmPassword;
  return JSON.stringify({ ...rest, password: "", confirmPassword: "" });
}

function payrollStructureChanged(form: MasterFormState, baseline: MasterFormState): boolean {
  return (
    form.effectiveFrom !== baseline.effectiveFrom ||
    form.daPercent !== baseline.daPercent ||
    form.hraPercent !== baseline.hraPercent ||
    form.grossBasicPay !== baseline.grossBasicPay ||
    form.daAmount !== baseline.daAmount ||
    form.hraAmount !== baseline.hraAmount ||
    form.transportBase !== baseline.transportBase ||
    form.transportDa !== baseline.transportDa ||
    form.transportTotal !== baseline.transportTotal ||
    form.totalEarnings !== baseline.totalEarnings ||
    form.medical !== baseline.medical ||
    form.professionalTax !== baseline.professionalTax ||
    form.incomeTax !== baseline.incomeTax ||
    form.lic !== baseline.lic ||
    form.mess !== baseline.mess ||
    form.welfare !== baseline.welfare ||
    form.vpf !== baseline.vpf ||
    form.pfLoan !== baseline.pfLoan ||
    form.postOffice !== baseline.postOffice ||
    form.creditSociety !== baseline.creditSociety ||
    form.standardLicenceFee !== baseline.standardLicenceFee ||
    form.electricity !== baseline.electricity ||
    form.water !== baseline.water ||
    form.loanRecovery !== baseline.loanRecovery ||
    form.vehicleCharge !== baseline.vehicleCharge ||
    form.otherDeduction !== baseline.otherDeduction ||
    form.advance !== baseline.advance
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

async function downloadFromApi(path: string, fallbackName: string) {
  const res = await fetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.message || "Download failed");
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition");
  const match = cd?.match(/filename="?([^";\n]+)"?/i);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const th =
  "border border-slate-700/90 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap";
const td = "border border-slate-200 px-1 py-1.5 text-right text-xs tabular-nums text-slate-800";
const tdLeft = "border border-slate-200 px-2 py-1.5 text-left text-xs whitespace-nowrap";

type Props = { canManage?: boolean };

export function PayrollMasterScreen({ canManage = false }: Props) {
  const { role } = useAuth();
  const { showToast } = useToast();
  const canWrite = canManage && isAdminRole(role);

  const [rows, setRows] = useState<PayrollMasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formSection, setFormSection] = useState<
    "basic" | "payroll" | "statutory" | "deductions" | "bank" | "history"
  >("basic");
  const [editing, setEditing] = useState<PayrollMasterRecord | null>(null);
  const [editBaseline, setEditBaseline] = useState<MasterFormState | null>(null);
  const [form, setForm] = useState<MasterFormState>(() => emptyForm());
  const [formSaving, setFormSaving] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [masterHistory, setMasterHistory] = useState<PayrollMasterRecord[]>([]);
  const [arrearHistory, setArrearHistory] = useState<
    {
      batchId: string;
      revisionEffectiveFrom?: string;
      oldDaPercent?: number;
      newDaPercent?: number;
      arrearFrom?: string;
      arrearTo?: string;
      includedInPayrollMonth?: string | null;
      daArrear: number;
      transportArrear: number;
      grossArrear: number;
      cpfArrear: number;
      netArrear: number;
      status: string;
      monthLines: Array<Record<string, unknown>>;
    }[]
  >([]);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [visitedTabs, setVisitedTabs] = useState<Partial<Record<FormTabId, boolean>>>({});
  const [apiFieldErrors, setApiFieldErrors] = useState<Record<string, string>>({});
  const [payrollFieldDefs, setPayrollFieldDefs] = useState<PayrollFieldDefinition[]>([]);
  const [companyCpfSettings, setCompanyCpfSettings] = useState<{
    cpfPercentage?: number;
    cpfBasisFieldKeys?: string[];
    cpfFormulaPreview?: string;
    cpfCalculationMode?: "percentage" | "fixed_amount";
    cpfFixedAmount?: number;
  }>({});

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importWarningsAcknowledged, setImportWarningsAcknowledged] = useState(false);
  const [importResult, setImportResult] = useState<{
    message: string;
    summary: Record<string, number>;
    errors: ImportError[];
    generatedPasswordCount?: number;
    generatedPasswordAccounts?: Array<{
      row: number;
      employeeCode?: string | null;
      employeeName?: string | null;
    }>;
  } | null>(null);
  const importPreviewRequestRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const formOpenRef = useRef(false);

  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "paused">("idle");
  const [autosaveHint, setAutosaveHint] = useState<string | null>(null);
  const [autosaveBaseline, setAutosaveBaseline] = useState("");
  const [draftOnlyMaster, setDraftOnlyMaster] = useState(false);
  const [manualSaveCompleted, setManualSaveCompleted] = useState(false);
  const [addDraftRestore, setAddDraftRestore] = useState<MasterFormState | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<PayrollMasterRecord | null>(null);
  const [companyDefaultDa, setCompanyDefaultDa] = useState(DEFAULT_DA_PERCENT);
  const [companyDefaultHra, setCompanyDefaultHra] = useState(DEFAULT_HRA_PERCENT);
  const [quarterOptions, setQuarterOptions] = useState<
    Array<{ id: string; quarterName: string; quarterType: string; monthlyRent: number }>
  >([]);
  const [nightAllowanceRates, setNightAllowanceRates] = useState<
    Array<{ slabNo: number; payLevel: number; ratePerHour: number; effectiveFrom?: string | null; isActive?: boolean }>
  >([]);
  const [divisions, setDivisions] = useState<OrgDivision[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [designations, setDesignations] = useState<OrgDesignation[]>([]);
  const [orgListsLoading, setOrgListsLoading] = useState(false);

  useEffect(() => {
    if (!formOpen || !canManage) return;
    let cancelled = false;
    setOrgListsLoading(true);
    (async () => {
      try {
        const [divRes, depRes, desRes] = await Promise.all([
          fetch("/api/settings/divisions"),
          fetch("/api/settings/departments"),
          fetch("/api/settings/designations"),
        ]);
        if (cancelled) return;
        const divData = await divRes.json();
        const depData = await depRes.json();
        const desData = await desRes.json();
        const nextDivisions: OrgDivision[] = divRes.ok
          ? (divData.divisions ?? [])
              .filter((d: { is_active?: boolean }) => d.is_active !== false)
              .map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
          : [];
        const nextDepartments: OrgDepartment[] = depRes.ok
          ? (depData.departments ?? [])
              .filter((d: { is_active?: boolean }) => d.is_active !== false)
              .map((d: { id: string; name: string; division_id?: string | null }) => ({
                id: d.id,
                name: d.name,
                divisionId: d.division_id ?? null,
              }))
          : [];
        const nextDesignations: OrgDesignation[] = desRes.ok
          ? (desData.designations ?? [])
              .filter((d: { is_active?: boolean }) => d.is_active !== false)
              .map((d: { id: string; title: string }) => ({ id: d.id, title: d.title }))
          : [];
        setDivisions(nextDivisions);
        setDepartments(nextDepartments);
        setDesignations(nextDesignations);
      } catch {
        /* optional */
      } finally {
        if (!cancelled) setOrgListsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formOpen, canManage]);

  useEffect(() => {
    if (!formOpen || orgListsLoading) return;
    setForm((f) => syncOrgIdsFromNames(f, divisions, departments, designations));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync ids when org lists load; do not reset autosave baseline
  }, [formOpen, orgListsLoading, divisions, departments, designations]);

  const divisionOptions = useMemo<OrgLookupOption[]>(
    () => divisions.map((d) => ({ id: d.id, label: d.name })),
    [divisions],
  );
  const departmentOptions = useMemo<OrgLookupOption[]>(() => {
    if (!form.divisionId) return [];
    return departments
      .filter((d) => d.divisionId === form.divisionId)
      .map((d) => ({ id: d.id, label: d.name }));
  }, [departments, form.divisionId]);
  const designationOptions = useMemo<OrgLookupOption[]>(
    () => designations.map((d) => ({ id: d.id, label: d.title })),
    [designations],
  );

  function getPendingOrgAdd():
    | { kind: "division" | "department" | "designation"; name: string }
    | null {
    const divPending = getUnresolvedOrgInput(form.division, form.divisionId, divisionOptions);
    if (divPending) return { kind: "division", name: divPending };
    const depPending = getUnresolvedOrgInput(form.department, form.departmentId, departmentOptions);
    if (depPending) return { kind: "department", name: depPending };
    const desPending = getUnresolvedOrgInput(form.designation, form.designationId, designationOptions);
    if (desPending) return { kind: "designation", name: desPending };
    return null;
  }

  async function createOrgEntity(
    kind: "division" | "department" | "designation",
    name: string,
  ): Promise<boolean> {
    try {
      if (kind === "division") {
        const res = await fetch("/api/settings/divisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to add division");
        const item = { id: data.division.id as string, name: data.division.name as string };
        setDivisions((prev) => [...prev, item]);
        setForm((f) => ({ ...f, divisionId: item.id, division: item.name }));
        showToast("success", "Division added");
        return true;
      }
      if (kind === "department") {
        if (!form.divisionId) {
          showToast("error", "Select a division before adding a department");
          return false;
        }
        const res = await fetch("/api/settings/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, division_id: form.divisionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to add department");
        const item = {
          id: data.department.id as string,
          name: data.department.name as string,
          divisionId: (data.department.division_id as string | null) ?? form.divisionId,
        };
        setDepartments((prev) => [...prev, item]);
        setForm((f) => ({ ...f, departmentId: item.id, department: item.name }));
        showToast("success", "Department added");
        return true;
      }
      const res = await fetch("/api/settings/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to add designation");
      const item = { id: data.designation.id as string, title: data.designation.title as string };
      setDesignations((prev) => [...prev, item]);
      setForm((f) => ({ ...f, designationId: item.id, designation: item.title }));
      showToast("success", "Designation added");
      return true;
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Failed to add");
      return false;
    }
  }

  function requestFormSection(next: typeof formSection) {
    if (next === formSection) return;
    setFormSection(next);
    visitTab(next);
  }

  function patchDivisionInput(text: string) {
    setForm((f) => {
      const sel = divisions.find((d) => d.id === f.divisionId);
      const keepId = sel && sel.name.toLowerCase() === text.trim().toLowerCase() ? f.divisionId : "";
      const next = { ...f, division: text, divisionId: keepId };
      if (!keepId && f.departmentId) {
        next.departmentId = "";
        next.department = "";
      }
      return next;
    });
  }

  function patchDepartmentInput(text: string) {
    setForm((f) => {
      const sel = departments.find((d) => d.id === f.departmentId);
      const keepId = sel && sel.name.toLowerCase() === text.trim().toLowerCase() ? f.departmentId : "";
      return { ...f, department: text, departmentId: keepId };
    });
  }

  function patchDesignationInput(text: string) {
    setForm((f) => {
      const sel = designations.find((d) => d.id === f.designationId);
      const keepId = sel && sel.title.toLowerCase() === text.trim().toLowerCase() ? f.designationId : "";
      return { ...f, designation: text, designationId: keepId };
    });
  }

  function selectDivision(id: string, label: string) {
    setForm((f) => {
      const dep = departments.find((d) => d.id === f.departmentId);
      const clearDepartment = Boolean(dep && dep.divisionId && dep.divisionId !== id);
      return {
        ...f,
        divisionId: id,
        division: label,
        ...(clearDepartment ? { departmentId: "", department: "" } : {}),
      };
    });
    touchField("division");
  }

  function selectDepartment(id: string, label: string) {
    patchForm({ departmentId: id, department: label });
  }

  function selectDesignation(id: string, label: string) {
    patchForm({ designationId: id, designation: label });
    touchField("designation");
  }

  useEffect(() => {
    if (!formOpen || !canManage) return;
    let cancelled = false;
    const q = form.quarterId ? `&current_quarter_id=${encodeURIComponent(form.quarterId)}` : "";
    (async () => {
      try {
        const res = await fetch(`/api/settings/quarters?for_employee_form=1${q}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setQuarterOptions(
            ((data.quarters ?? []) as Array<{ id: string; quarterName: string; quarterType: string; monthlyRent: number }>),
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formOpen, canManage, form.quarterId]);

  useEffect(() => {
    if (!formOpen || !canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/night-allowance-rates?activeOnly=true");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setNightAllowanceRates(
            ((data.rates ?? []) as Array<{
              slabNo: number;
              payLevel: number;
              ratePerHour: number;
              effectiveFrom?: string | null;
              isActive?: boolean;
            }>).map((r) => ({
              slabNo: r.slabNo,
              payLevel: r.payLevel,
              ratePerHour: r.ratePerHour,
              effectiveFrom: r.effectiveFrom ?? null,
              isActive: r.isActive !== false,
            })),
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formOpen, canManage]);

  const resolvedNightAllowance = useMemo(() => {
    const level = parseInt(form.payLevel, 10);
    if (!Number.isFinite(level) || level < 1) {
      return { rate: 0, slabNo: null as number | null, warning: null as string | null };
    }
    return resolveNightAllowanceRateByPayLevel(nightAllowanceRates, level);
  }, [form.payLevel, nightAllowanceRates]);

  function patchCustomField(key: string, value: string) {
    setForm((f) => {
      const next = {
        ...f,
        customFieldValues: { ...f.customFieldValues, [key]: value },
      };
      const def = payrollFieldDefs.find((field) => field.fieldKey === key);
      if (def?.fieldGroup === "earnings") {
        return { ...next, totalEarnings: earningStringsFromForm(next).totalEarnings };
      }
      return next;
    });
  }

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/payroll-config");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setPayrollFieldDefs((data.fields ?? []) as PayrollFieldDefinition[]);
          const cs = data.calculationSettings ?? {};
          setCompanyCpfSettings({
            cpfPercentage: cs.cpfPercentage ?? 12,
            cpfBasisFieldKeys: cs.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS,
            cpfFormulaPreview: cs.cpfFormulaPreview,
            cpfCalculationMode: cs.cpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage",
            cpfFixedAmount: cs.cpfFixedAmount ?? 0,
          });
        }
      } catch {
        /* optional config */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/payroll/master?_=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Failed to load payroll master (${res.status})`);
      }
      const list = (data.masters ?? data.employees ?? []) as PayrollMasterRecord[];
      if (process.env.NODE_ENV === "development") {
        console.info("[PayrollMaster] loaded", {
          count: list.length,
          companyId: data.companyId ?? null,
          daValues: list.slice(0, 8).map((r) => ({ name: r.name, daPercent: r.daPercent ?? r.da_percent })),
        });
      }
      setRows(list);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load payroll master";
      setRows([]);
      setLoadError(message);
      showToast("error", message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (canManage) loadRows();
  }, [canManage, loadRows]);

  useEffect(() => {
    formOpenRef.current = formOpen;
  }, [formOpen]);

  useEffect(() => {
    if (!canManage) return;
    return onHrmsChange((kind) => {
      // Avoid grid flicker while the add/edit modal is open (autosave updates in place).
      if (kind === "payroll_master" && !formOpenRef.current) void loadRows();
    }, { kinds: ["payroll_master"] });
  }, [canManage, loadRows]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company/me");
        const data = await res.json();
        if (cancelled) return;
        const da = data?.company?.default_da_percent;
        const hra = data?.company?.default_hra_percent;
        if (da != null && Number.isFinite(Number(da))) {
          setCompanyDefaultDa(Number(da));
        }
        if (hra != null && Number.isFinite(Number(hra))) {
          setCompanyDefaultHra(Number(hra));
        }
      } catch {
        if (!cancelled) {
          setCompanyDefaultDa(DEFAULT_DA_PERCENT);
          setCompanyDefaultHra(DEFAULT_HRA_PERCENT);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const existingForUniqueness = useMemo<PayrollMasterUniqueRow[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        employeeCode: r.employeeCode,
        email: r.email,
        phone: r.phone,
        aadhaar: r.aadhaar,
        pan: r.pan,
        bankAccountNumber: r.bankAccountNumber,
      })),
    [rows],
  );

  const formValidation = useMemo(
    () =>
      validateEmployeeForm(form, Boolean(editing), editBaseline, {
        mode: editing ? "edit" : "add",
        submitAttempted,
        touched,
        visitedTabs,
        existingEmployees: existingForUniqueness,
        editingId: editing?.id ?? null,
      }),
    [form, editing, editBaseline, submitAttempted, touched, visitedTabs, existingForUniqueness],
  );

  const touchField = useCallback((field: string) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const visitTab = useCallback((tab: FormTabId | "history") => {
    if (tab === "history") return;
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
  }, []);

  const showError = useCallback(
    (field: string): string | null => {
      const err = apiFieldErrors[field] ?? formValidation.errors[field];
      if (!err) return null;
      if (submitAttempted) return err;
      if (field === "password" && passwordTouched) return err;
      if (field === "confirmPassword" && confirmPasswordTouched) return err;
      if (touched[field]) return err;
      return null;
    },
    [apiFieldErrors, formValidation.errors, submitAttempted, touched, passwordTouched, confirmPasswordTouched],
  );

  function renderTabStatusIcon(status: TabStatus) {
    if (status === "error") {
      return <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />;
    }
    if (status === "complete") {
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
    }
    return <span className="h-4 w-4 shrink-0" aria-hidden />;
  }

  function resetFormValidationState() {
    setSubmitAttempted(false);
    setTouched({});
    setVisitedTabs({});
    setApiFieldErrors({});
    setPasswordTouched(false);
    setConfirmPasswordTouched(false);
  }

  useEffect(() => {
    setAutosaveEnabled(readAutosaveEnabled());
  }, []);

  const persistLocalAddDraft = useCallback(
    (f: MasterFormState) => {
      if (typeof window === "undefined" || editing) return;
      const empty = emptyForm(companyDefaultDa, companyDefaultHra);
      if (!hasMeaningfulAddDraft(f, empty)) {
        window.localStorage.removeItem(PAYROLL_MASTER_ADD_DRAFT_KEY);
        return;
      }
      window.localStorage.setItem(PAYROLL_MASTER_ADD_DRAFT_KEY, serializeAddDraft(f));
    },
    [editing, companyDefaultDa, companyDefaultHra],
  );

  const discardDraftMaster = useCallback(async () => {
    if (!draftOnlyMaster || !editing?.id || manualSaveCompleted) return;
    try {
      await fetch(`/api/payroll/master/${editing.id}/deactivate`, { method: "POST" });
      dispatchHrmsChange("payroll_master");
    } catch {
      /* best effort */
    }
  }, [draftOnlyMaster, editing?.id, manualSaveCompleted]);

  const closeFormModal = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    await discardDraftMaster();
    if (typeof window !== "undefined" && !editing) {
      window.localStorage.removeItem(PAYROLL_MASTER_ADD_DRAFT_KEY);
    }
    resetFormValidationState();
    setAutosaveStatus("idle");
    setAutosaveHint(null);
    setAutosaveBaseline("");
    setDraftOnlyMaster(false);
    setManualSaveCompleted(false);
    setFormOpen(false);
  }, [discardDraftMaster, editing]);

  const performAutosave = useCallback(async () => {
    if (!formOpen || formSaving || formLoading || autosaveInFlightRef.current || !autosaveEnabled) {
      return;
    }
    if (getPendingOrgAdd()) {
      setAutosaveStatus("paused");
      setAutosaveHint("Use Add new in Basic Details to save a new division, department, or designation.");
      return;
    }
    if (form.hasQuarter && !form.quarterId) {
      setAutosaveStatus("paused");
      setAutosaveHint("Select assigned quarter before autosave.");
      return;
    }

    const snapshot = formAutosaveSnapshot(form);
    if (snapshot === autosaveBaseline) return;

    // Add employee: keep draft on this device only — do not POST partial rows to the database.
    if (!editing?.id) {
      persistLocalAddDraft(form);
      setAutosaveBaseline(snapshot);
      if (meetsServerDraftThreshold(form)) {
        setAutosaveStatus("saved");
        setAutosaveHint("Draft saved on this device. Click Add Employee to save to the database.");
      } else {
        setAutosaveStatus("paused");
        setAutosaveHint("Enter employee code, name, and pay level to keep a local draft.");
      }
      return;
    }

    const readiness = assessAutosaveReadiness(
      form,
      true,
      editBaseline,
      existingForUniqueness,
      editing.id,
    );
    if (!readiness.ok) {
      setAutosaveStatus("paused");
      setAutosaveHint(readiness.reason ?? "Complete required fields to autosave.");
      return;
    }

    autosaveInFlightRef.current = true;
    setAutosaveStatus("saving");
    setAutosaveHint(null);
    try {
      const payload = { ...formToPayload(form), autosave: true };
      const res = await fetch(`/api/payroll/master/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Autosave failed");
      }
      setAutosaveBaseline(snapshot);
      setAutosaveStatus("saved");
    } catch (e: unknown) {
      setAutosaveStatus("paused");
      setAutosaveHint(e instanceof Error ? e.message : "Autosave failed");
    } finally {
      autosaveInFlightRef.current = false;
    }
  }, [
    formOpen,
    formSaving,
    formLoading,
    autosaveEnabled,
    form,
    autosaveBaseline,
    editing,
    editBaseline,
    existingForUniqueness,
    persistLocalAddDraft,
  ]);

  useEffect(() => {
    if (!formOpen || !autosaveEnabled || formSaving || formLoading) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void performAutosave();
    }, autosaveDebounceMs());
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [form, formOpen, autosaveEnabled, formSaving, formLoading, performAutosave]);

  function focusFirstInvalidField(field: string | null, tab: FormTabId | null) {
    if (tab) setFormSection(tab);
    if (!field) return;
    window.setTimeout(() => {
      const el = document.getElementById(fieldDomId(field));
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80);
  }

  const preview = useMemo(
    () =>
      computePayrollMasterPreview({
        payLevel: form.payLevel,
        grossBasicPay: form.grossBasicPay,
        daPercent: form.daPercent,
        hraPercent: form.hraPercent,
        medical: form.medical,
        daAmount: form.daAmount,
        hraAmount: form.hraAmount,
        transportBase: form.transportBase,
        transportDa: form.transportDa,
        transportTotal: form.transportTotal,
        totalEarnings: form.totalEarnings,
        cpfDefault: 0,
        professionalTax: form.professionalTax,
        incomeTax: form.incomeTax,
        lic: form.lic,
        mess: form.mess,
        welfare: form.welfare,
        vpf: form.vpf,
        pfLoan: form.pfLoan,
        postOffice: form.postOffice,
        creditSociety: form.creditSociety,
        standardLicenceFee: form.standardLicenceFee,
        electricity: form.electricity,
        water: form.water,
        loanRecovery: form.loanRecovery,
        vehicleCharge: form.vehicleCharge,
        otherDeduction: form.otherDeduction,
        advance: form.advance,
        cpfUseCompanySettings: form.cpfUseCompanySettings,
        cpfPercentageOverride: form.cpfPercentageOverride,
        cpfBasisFieldKeysOverride: isCpfEmployeeCustomMode(form.cpfUseCompanySettings)
          ? form.cpfBasisFieldKeys
          : undefined,
        cpfCalculationModeOverride: isCpfEmployeeCustomMode(form.cpfUseCompanySettings)
          ? form.cpfCalculationMode
          : undefined,
        cpfFixedAmountOverride:
          isCpfCompanyDefaultMode(form.cpfUseCompanySettings) || form.cpfCalculationMode !== "fixed_amount"
            ? undefined
            : form.cpfFixedAmount,
        companyCpfPercentage: companyCpfSettings.cpfPercentage,
        companyCpfBasisFieldKeys: companyCpfSettings.cpfBasisFieldKeys,
        companyCpfCalculationMode: companyCpfSettings.cpfCalculationMode,
        companyCpfFixedAmount: companyCpfSettings.cpfFixedAmount,
        customEarnings: customNumericBagForTotalFromValues(form.customFieldValues, payrollFieldDefs, "earnings"),
        customDeductions: customNumericBagForTotalFromValues(form.customFieldValues, payrollFieldDefs, "deductions"),
        payrollFieldDefs,
        hasQuarter: form.hasQuarter,
        quarterId: form.hasQuarter ? form.quarterId : null,
        quarterRent: form.hasQuarter ? parseFloat(form.quarterRent) || 0 : 0,
      }),
    [form, companyCpfSettings, payrollFieldDefs, form.cpfBasisFieldKeys, form.cpfUseCompanySettings, form.cpfPercentageOverride, form.cpfCalculationMode, form.cpfFixedAmount],
  );

  const masterGridCustomColumns = useMemo(
    () =>
      payrollFieldDefs
        .filter((f) => f.isActive && !f.isSystem && f.showInPayrollMaster)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((f) => ({ key: f.fieldKey, label: f.fieldLabel, fieldType: f.fieldType })),
    [payrollFieldDefs],
  );

  const effectiveCpfConfig = useMemo(
    () =>
      resolveEffectiveCpfConfigForMaster({
        cpfUseCompanySettings: form.cpfUseCompanySettings,
        cpfPercentageOverride: form.cpfPercentageOverride,
        cpfBasisFieldKeysOverride: form.cpfBasisFieldKeys,
        cpfCalculationModeOverride: form.cpfCalculationMode,
        cpfFixedAmountOverride: form.cpfFixedAmount,
        companyCpfPercentage: companyCpfSettings.cpfPercentage,
        companyCpfBasisFieldKeys: companyCpfSettings.cpfBasisFieldKeys,
        companyCpfCalculationMode: companyCpfSettings.cpfCalculationMode,
        companyCpfFixedAmount: companyCpfSettings.cpfFixedAmount,
      }),
    [form.cpfUseCompanySettings, form.cpfPercentageOverride, form.cpfBasisFieldKeys, form.cpfCalculationMode, form.cpfFixedAmount, companyCpfSettings],
  );

  function openAdd() {
    setEditing(null);
    setEditBaseline(null);
    setMasterHistory([]);
    setArrearHistory([]);
    const base = {
      ...emptyForm(companyDefaultDa, companyDefaultHra),
      employeeCode: generateNextEmployeeCode(rows.map((r) => r.employeeCode ?? "").filter(Boolean)),
    };
    const storedDraft =
      typeof window !== "undefined" ? parseAddDraft(window.localStorage.getItem(PAYROLL_MASTER_ADD_DRAFT_KEY)) : null;
    const empty = emptyForm(companyDefaultDa, companyDefaultHra);
    if (storedDraft && hasMeaningfulAddDraft(storedDraft, empty)) {
      const merged: MasterFormState = {
        ...base,
        ...storedDraft,
        employeeCode: storedDraft.employeeCode || base.employeeCode,
        userRole: normalizeRole(storedDraft.userRole ?? base.userRole),
      };
      setAddDraftRestore(merged);
      setForm(base);
      setAutosaveBaseline(formAutosaveSnapshot(base));
    } else {
      setAddDraftRestore(null);
      setForm(base);
      setAutosaveBaseline(formAutosaveSnapshot(base));
    }
    setDraftOnlyMaster(false);
    setManualSaveCompleted(false);
    setAutosaveStatus("idle");
    setAutosaveHint(null);
    resetFormValidationState();
    setFormSection("basic");
    setFormOpen(true);
  }

  async function openEdit(row: PayrollMasterRecord) {
    setEditing(row);
    resetFormValidationState();
    setFormSection("payroll");
    setFormOpen(true);
    setFormLoading(true);
    setMasterHistory([]);
    setArrearHistory([]);
    try {
      const [masterRes, historyRes, arrearRes] = await Promise.all([
        fetch(`/api/payroll/master/${row.id}`),
        fetch(`/api/payroll/master/${row.id}/history`),
        fetch(`/api/payroll/master/${row.id}/arrear-history`),
      ]);
      const masterData = await masterRes.json();
      const historyData = await historyRes.json();
      const arrearData = await arrearRes.json();
      if (!masterRes.ok) throw new Error(masterData?.error || "Failed to load employee");
      const loadedForm = formFromRecord(masterData.master ?? row);
      setForm(loadedForm);
      setEditBaseline(loadedForm);
      setAutosaveBaseline(formAutosaveSnapshot(loadedForm));
      setDraftOnlyMaster(false);
      setManualSaveCompleted(true);
      setAutosaveStatus("idle");
      setAutosaveHint(null);
      const companyCs = masterData.master?.cpfSettings?.companySettings;
      if (companyCs) {
        setCompanyCpfSettings({
          cpfPercentage: companyCs.cpfPercentage ?? 12,
          cpfBasisFieldKeys: companyCs.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS,
          cpfFormulaPreview: companyCs.cpfFormulaPreview,
          cpfCalculationMode:
            (companyCs as { cpfCalculationMode?: string }).cpfCalculationMode === "fixed_amount"
              ? "fixed_amount"
              : "percentage",
          cpfFixedAmount: (companyCs as { cpfFixedAmount?: number }).cpfFixedAmount ?? 0,
        });
      }
      if (historyRes.ok) {
        setMasterHistory(historyData.history ?? []);
      }
      if (arrearRes.ok) {
        setArrearHistory(arrearData.arrearHistory ?? []);
      }
    } catch (e: unknown) {
      setForm(formFromRecord(row));
      setEditBaseline(formFromRecord(row));
      showToast("error", e instanceof Error ? e.message : "Could not refresh employee; showing cached row");
    } finally {
      setFormLoading(false);
    }
  }

  function earningStringsFromForm(f: MasterFormState) {
    const derived = deriveEarningFieldValues({
      payLevel: f.payLevel,
      grossBasicPay: f.grossBasicPay,
      daPercent: f.daPercent,
      hraPercent: f.hraPercent,
      medical: f.medical,
      hasQuarter: f.hasQuarter,
      quarterId: f.hasQuarter ? f.quarterId : null,
      customEarnings: customNumericBagForTotalFromValues(f.customFieldValues, payrollFieldDefs, "earnings"),
      payrollFieldDefs,
    });
    return {
      daAmount: String(derived.daAmount),
      hraAmount: String(derived.hraAmount),
      transportBase: String(derived.transportBase),
      transportDa: String(derived.transportDa),
      transportTotal: String(derived.transportTotal),
      totalEarnings: String(derived.totalEarnings),
    };
  }

  function toggleCpfBasisKey(key: string) {
    setForm((f) => {
      const seedKeys =
        f.cpfBasisFieldKeys.length > 0
          ? f.cpfBasisFieldKeys
          : companyCpfSettings.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS;
      const nextKeys = seedKeys.includes(key)
        ? seedKeys.filter((k) => k !== key)
        : [...seedKeys, key];
      return {
        ...f,
        cpfUseCompanySettings: false,
        cpfBasisFieldKeys: nextKeys,
        cpfPercentageOverride:
          f.cpfPercentageOverride || String(companyCpfSettings.cpfPercentage ?? 12),
      };
    });
  }

  function patchCpfCustom(patch: Partial<MasterFormState>) {
    setForm((f) => ({
      ...f,
      ...patch,
      cpfUseCompanySettings: false,
    }));
  }

  function patchForm(patch: Partial<MasterFormState>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (![...EARNING_DRIVER_KEYS].some((key) => key in patch)) {
        return next;
      }
      return { ...next, ...earningStringsFromForm(next) };
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (formSaving) return;

    setSubmitAttempted(true);
    setApiFieldErrors({});
    const validation = validateEmployeeForm(form, Boolean(editing), editBaseline, {
      mode: editing ? "edit" : "add",
      submitAttempted: true,
      touched,
      visitedTabs,
      existingEmployees: existingForUniqueness,
      editingId: editing?.id ?? null,
    });

    if (!validation.isValid) {
      showToast("error", "Please complete the highlighted fields.");
      focusFirstInvalidField(validation.firstErrorField, validation.firstErrorTab);
      return;
    }

    if (form.hasQuarter && !form.quarterId) {
      showToast("error", "Please select assigned quarter.");
      return;
    }

    setFormSaving(true);
    try {
      const payload = formToPayload(form);
      if (process.env.NODE_ENV === "development") {
        console.info("[PayrollMaster] update payload", { id: editing?.id, daPercent: payload.daPercent });
      }
      const res = await fetch(editing ? `/api/payroll/master/${editing.id}` : "/api/payroll/master", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.message || data?.error || "Save failed";
        const field = mapApiErrorToField(String(msg));
        if (field) {
          setApiFieldErrors({ [field]: msg });
          const tab: FormTabId =
            field === "grossBasicPay" || field === "daPercent" || field === "hraPercent" || field === "effectiveFrom"
              ? "payroll"
              : field === "bankName" || field === "bankAccountNumber" || field === "bankIfsc"
                ? "bank"
                : field === "aadhaar" || field === "pan"
                  ? "statutory"
                  : field === "employeeCode" || field === "email" || field === "phone"
                    ? "basic"
                    : "basic";
          focusFirstInvalidField(field, tab);
        }
        throw new Error(msg);
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[PayrollMaster] update response", {
          id: data?.master?.id,
          daPercent: data?.master?.daPercent ?? data?.master?.da_percent,
        });
      }
      const saved = (data?.master ?? null) as PayrollMasterRecord | null;
      if (saved?.id) {
        setRows((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
      }
      showToast("success", editing ? "Employee updated" : "Employee added");
      setManualSaveCompleted(true);
      setDraftOnlyMaster(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(PAYROLL_MASTER_ADD_DRAFT_KEY);
      }
      setAutosaveBaseline(formAutosaveSnapshot(form));
      resetFormValidationState();
      setFormOpen(false);
      dispatchHrmsChange("payroll_master");
      await loadRows();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    setBusy(deactivateTarget.id);
    try {
      const res = await fetch(`/api/payroll/master/${deactivateTarget.id}/deactivate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Deactivate failed");
      showToast("success", "Employee deactivated");
      setDeactivateTarget(null);
      dispatchHrmsChange("payroll_master");
      await loadRows();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Deactivate failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy("sync");
    try {
      const res = await fetch("/api/payroll/master/sync-existing-employees", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Sync failed");
      showToast(
        "success",
        `Sync complete: ${data.created_master_rows ?? 0} created, ${data.skipped_existing_rows ?? 0} skipped`,
      );
      dispatchHrmsChange("payroll_master");
      await loadRows();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  function resetImportState() {
    importPreviewRequestRef.current += 1;
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportPreviewing(false);
    setImportWarningsAcknowledged(false);
  }

  function closeImportModal() {
    setImportOpen(false);
    resetImportState();
  }

  const previewImportFile = useCallback(
    async (file: File) => {
      const requestId = ++importPreviewRequestRef.current;
      setImportPreviewing(true);
      setImportPreview(null);
      setImportResult(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/payroll/master/import-preview", { method: "POST", body: fd });
        const data = await res.json();
        if (requestId !== importPreviewRequestRef.current) return;
        const preview: ImportPreview = {
          summary: data.summary ?? {},
          rows: (data.rows ?? []).map((r: ImportPreviewRow) => ({
            ...r,
            employeeName: r.employeeName ?? r.name ?? null,
            name: r.employeeName ?? r.name ?? null,
            warnings: r.warnings ?? [],
          })),
          fileErrors: (data.file_errors ?? data.fileErrors ?? []).map((e: ImportFileError) => ({
            field: e.field,
            message: e.message,
            missing_columns: e.missing_columns ?? (e as { missingColumns?: string[] }).missingColumns,
          })),
          canImport:
            data.can_import ??
            data.canImport ??
            ((data.summary?.invalid_rows ?? 0) === 0 && (data.file_errors ?? data.fileErrors ?? []).length === 0),
          requiresConfirmation: data.requires_confirmation ?? data.requiresConfirmation,
          blockedMessage: data.blocked_message ?? data.blockedMessage ?? null,
          issues: data.issues ?? [],
        };
        setImportPreview(preview);
        setImportWarningsAcknowledged(false);
      } catch (e: unknown) {
        if (requestId !== importPreviewRequestRef.current) return;
        setImportPreview(null);
        showToast("error", e instanceof Error ? e.message : "Failed to read file");
      } finally {
        if (requestId === importPreviewRequestRef.current) {
          setImportPreviewing(false);
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!importOpen || !importFile) return;
    void previewImportFile(importFile);
  }, [importOpen, importFile, previewImportFile]);

  function handleImportFileChange(file: File | null) {
    if (!file) {
      importPreviewRequestRef.current += 1;
      setImportFile(null);
      setImportPreview(null);
      setImportResult(null);
      setImportPreviewing(false);
      return;
    }
    setImportFile(file);
    setImportResult(null);
    setImportWarningsAcknowledged(false);
  }

  const importCanConfirm = useMemo(() => {
    if (!importPreview) return false;
    if (importPreview.canImport === false) return false;
    if ((importPreview.summary.invalid_rows ?? 0) > 0) return false;
    if (importPreview.fileErrors.length > 0) return false;
    if (importPreview.requiresConfirmation && !importWarningsAcknowledged) return false;
    return (importPreview.summary.valid_rows ?? 0) > 0;
  }, [importPreview, importWarningsAcknowledged]);

  const importTemplateErrors = useMemo(
    () => importPreview?.fileErrors.filter((e) => e.field === "template") ?? [],
    [importPreview],
  );

  const importIssueRows = useMemo(() => {
    if (!importPreview) return [];
    return importPreview.rows.filter((r) => !r.valid || (r.warnings?.length ?? 0) > 0);
  }, [importPreview]);

  async function handleImport() {
    if (!importFile) {
      showToast("error", "Select a file to import");
      return;
    }
    if (!importPreview) {
      showToast("error", importPreviewing ? "Wait for the file preview to load" : "Select a file and wait for preview");
      return;
    }
    if (!importCanConfirm) {
      showToast(
        "error",
        importPreview.blockedMessage ?? "Import blocked. Please fix the listed errors and upload again.",
      );
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const res = await fetch("/api/payroll/master/import", { method: "POST", body: fd });
      const data = await res.json();
      setImportResult({
        message: data.message ?? "Import finished",
        summary: data.summary ?? {},
        errors: data.errors ?? [],
        generatedPasswordCount: data.generated_password_count ?? data.generatedPasswordCount ?? 0,
        generatedPasswordAccounts:
          data.generated_password_accounts ?? data.generatedPasswordAccounts ?? [],
      });
      if (data.summary?.inserted_rows || data.summary?.updated_rows) {
        dispatchHrmsChange("payroll_master");
        await loadRows();
      }
      if (res.ok) showToast("success", data.message ?? "Import completed");
      else showToast("error", data.message ?? "Import completed with errors");
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      await downloadFromApi("/api/payroll/master/import-template", "cirt_payroll_master_template.xlsx");
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Template download failed");
    }
  }

  async function handleExport() {
    setBusy("export");
    try {
      await downloadFromApi("/api/payroll/master/export", "cirt_payroll_master.xlsx");
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy/30";
  const fieldInputCls = (invalid: boolean) =>
    invalid
      ? "w-full rounded-lg border border-red-500 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/30"
      : inputCls;
  const labelCls = "mb-1 block text-xs font-medium text-slate-700";

  const cpfBadge = `CPF auto-calculated at ${Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}% of total earnings`;

  const formSections = [
    { id: "basic" as const, label: "Basic Details" },
    { id: "payroll" as const, label: "Payroll Details" },
    { id: "statutory" as const, label: "Statutory" },
    { id: "deductions" as const, label: "Deductions" },
    { id: "bank" as const, label: "Bank Details" },
    ...(editing ? [{ id: "history" as const, label: "History" }] : []),
  ];

  if (loading) {
    return <AppPageLoader message="Loading payroll master..." />;
  }

  if (loadError) {
    return (
      <AppPageError message="Unable to load data. Please try again." onRetry={() => void loadRows()} />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll Master"
        description="Employee salary master records"
        className="!mb-2"
        badge={<Badge tone="info">{cpfBadge}</Badge>}
        actions={
          canWrite ? (
            <>
              <Button size="sm" onClick={openAdd}>
                Add Employee
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                Import Excel
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadTemplate}>
                Download Template
              </Button>
              <Button size="sm" variant="outline" onClick={handleExport} loading={busy === "export"} disabled={busy === "export"}>
                {busy === "export" ? "Exporting..." : "Export Master"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleSync} loading={busy === "sync"} disabled={busy === "sync"}>
                Sync Employees
              </Button>
            </>
          ) : undefined
        }
      />

      <AppCard padding={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No employees yet"
              description="Add an employee, import from Excel, or sync existing employees."
              action={
                canWrite ? (
                  <Button size="sm" onClick={openAdd}>
                    Add Employee
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <PayrollMasterDataGrid
            rows={rows}
            canWrite={canWrite}
            cpfRateLabel={cpfBadge}
            customColumns={masterGridCustomColumns}
            resetKey={rows.map((r) => r.id).join(",")}
            onEdit={openEdit}
            onDeactivate={setDeactivateTarget}
          />
        )}
      </AppCard>

      <Modal
        open={formOpen}
        onClose={() => {
          void closeFormModal();
        }}
        title={editing ? "Edit Employee" : "Add Employee"}
        description={editing ? `${form.employeeCode || "—"} · ${form.name || form.email}` : "Payroll master record"}
        headerExtra={
          <div className="flex flex-wrap items-center gap-2">
            {editing ? <Badge tone={form.status === "active" ? "success" : "neutral"}>{form.status}</Badge> : null}
            {draftOnlyMaster && !manualSaveCompleted ? (
              <Badge tone="warning">Draft</Badge>
            ) : null}
          </div>
        }
        size="2xl"
        asForm
        onSubmit={handleSave}
        footer={
          <>
            <div className="mr-auto flex min-w-0 flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={autosaveEnabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAutosaveEnabled(on);
                    writeAutosaveEnabled(on);
                    if (on) {
                      setAutosaveStatus("idle");
                      setAutosaveHint(null);
                    }
                  }}
                  className="rounded border-slate-300"
                />
                <span>Autosave</span>
              </label>
              {autosaveEnabled ? (
                <span className="truncate">
                  {autosaveStatus === "saving"
                    ? "Saving…"
                    : autosaveStatus === "saved"
                      ? "All changes saved"
                      : autosaveStatus === "paused" && autosaveHint
                        ? autosaveHint
                        : !editing?.id
                          ? meetsServerDraftThreshold(form)
                            ? "Draft on this device until you click Add Employee"
                            : "Local draft starts after code, name & pay level"
                          : null}
                </span>
              ) : (
                <span>Autosave off — use Update to save</span>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void closeFormModal();
              }}
              disabled={formSaving || formLoading}
            >
              Cancel
            </Button>
            <Button type="submit" loading={formSaving} disabled={formSaving || formLoading}>
              {editing ? "Update Employee" : "Add Employee"}
            </Button>
          </>
        }
      >
        {formLoading ? (
          <SkeletonCard />
        ) : (
          <div className="flex min-h-[min(50vh,460px)] flex-col">
            {submitAttempted && !formValidation.isValid ? (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                Please complete the highlighted fields.
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:-mx-2">
            <nav className="mb-4 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 pb-3 lg:mb-0 lg:w-48 lg:flex-col lg:border-b-0 lg:border-r lg:pr-3 lg:pb-0">
              {formSections.map((s) => {
                const isActive = formSection === s.id;
                const isValidTab = s.id !== "history";
                const tabId = isValidTab ? (s.id as FormTabId) : null;
                const status: TabStatus | null = tabId ? formValidation.tabStatus[tabId] : null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      requestFormSection(s.id);
                    }}
                    className={cn(
                      "segment-tab flex w-full items-center justify-between gap-2 whitespace-nowrap text-left",
                      isActive && "segment-tab-active",
                      !isActive && status === "neutral" && "segment-tab-inactive",
                      !isActive && status === "error" && "border border-red-200 bg-red-50 text-red-900",
                      !isActive && status === "complete" && "border border-emerald-200 bg-emerald-50/50 text-slate-800",
                      isActive && status === "error" && "ring-1 ring-red-300",
                    )}
                  >
                    <span className="truncate">{s.label}</span>
                    {status ? renderTabStatusIcon(status) : null}
                  </button>
                );
              })}
            </nav>
            <div className="min-h-0 flex-1 space-y-5 lg:pl-4">
                {formSection === "basic" && (
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Basic details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="Employee Code" required error={showError("employeeCode")}>
                      <Input
                        id={fieldDomId("employeeCode")}
                        invalid={Boolean(showError("employeeCode"))}
                        value={form.employeeCode}
                        onChange={(e) => patchForm({ employeeCode: e.target.value })}
                        onBlur={() => touchField("employeeCode")}
                      />
                    </FormField>
                    <FormField label="Pay Level" required error={showError("payLevel")}>
                      <Input
                        id={fieldDomId("payLevel")}
                        type="number"
                        min={1}
                        invalid={Boolean(showError("payLevel"))}
                        value={form.payLevel}
                        onChange={(e) => patchForm({ payLevel: e.target.value })}
                        onBlur={() => touchField("payLevel")}
                      />
                    </FormField>
                    <FormField label="Increment Month" required error={showError("incrementMonth")}>
                      <SelectField
                        value={form.incrementMonth}
                        onChange={(v) => {
                          patchForm({ incrementMonth: v });
                          touchField("incrementMonth");
                        }}
                        error={showError("incrementMonth")}
                        options={[
                          { value: "January", label: "January" },
                          { value: "July", label: "July" },
                        ]}
                        required
                      />
                    </FormField>
                    <FormField label="Name" required error={showError("name")}>
                      <Input
                        id={fieldDomId("name")}
                        invalid={Boolean(showError("name"))}
                        value={form.name}
                        onChange={(e) => patchForm({ name: e.target.value })}
                        onBlur={() => touchField("name")}
                      />
                    </FormField>
                    <FormField label="Email" required error={showError("email")}>
                      <Input
                        id={fieldDomId("email")}
                        type="email"
                        invalid={Boolean(showError("email"))}
                        value={form.email}
                        onChange={(e) => patchForm({ email: e.target.value })}
                        onBlur={() => touchField("email")}
                      />
                    </FormField>
                    <FormField label="User role" required error={showError("userRole")}>
                      <SelectField
                        value={form.userRole}
                        onChange={(v) => {
                          patchForm({ userRole: v as AppRole });
                          touchField("userRole");
                        }}
                        error={showError("userRole")}
                        options={[
                          { value: "employee", label: "Employee" },
                          { value: "admin", label: "Admin" },
                        ]}
                        required
                      />
                    </FormField>
                    <div>
                      <PasswordField
                        label={editing ? "New password (optional)" : "Password *"}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(v) => patchForm({ password: v })}
                        onBlur={() => {
                          setPasswordTouched(true);
                          touchField("password");
                        }}
                        error={showError("password")}
                      />
                    </div>
                    <div>
                      <PasswordField
                        label={editing ? "Confirm new password" : "Confirm password *"}
                        autoComplete="new-password"
                        value={form.confirmPassword}
                        onChange={(v) => patchForm({ confirmPassword: v })}
                        onBlur={() => {
                          setConfirmPasswordTouched(true);
                          touchField("confirmPassword");
                        }}
                        error={showError("confirmPassword")}
                      />
                    </div>
                    <FormField label="Phone" error={showError("phone")}>
                      <Input
                        id={fieldDomId("phone")}
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        autoComplete="tel"
                        invalid={Boolean(showError("phone"))}
                        value={form.phone}
                        placeholder="10-digit mobile"
                        onChange={(e) => patchForm({ phone: normalizeDigits(e.target.value).slice(0, 10) })}
                        onBlur={() => touchField("phone")}
                      />
                    </FormField>
                    <FormField label="Gender">
                      <SelectField
                        value={form.gender}
                        onChange={(v) => patchForm({ gender: v })}
                        placeholder="Select gender"
                        options={[
                          { value: "male", label: "Male" },
                          { value: "female", label: "Female" },
                          { value: "other", label: "Other" },
                        ]}
                      />
                    </FormField>
                    <FormField label="Date of Birth">
                      <DatePickerField label="" value={form.dateOfBirth} onChange={(v) => patchForm({ dateOfBirth: v })} />
                    </FormField>
                    <FormField label="Date of Joining">
                      <DatePickerField label="" value={form.dateOfJoining} onChange={(v) => patchForm({ dateOfJoining: v })} />
                    </FormField>
                    <OrgLookupCombobox
                      label="Division"
                      value={form.divisionId}
                      inputValue={form.division}
                      options={divisionOptions}
                      entityName="division"
                      loading={orgListsLoading}
                      placeholder="Select or search division"
                      onInputChange={patchDivisionInput}
                      onSelect={selectDivision}
                      onAddNew={(name) => void createOrgEntity("division", name)}
                    />
                    <OrgLookupCombobox
                      label="Department"
                      value={form.departmentId}
                      inputValue={form.department}
                      options={departmentOptions}
                      entityName="department"
                      loading={orgListsLoading}
                      disabled={!form.divisionId && !orgListsLoading}
                      placeholder={form.divisionId ? "Select or search department" : "Select division first"}
                      addDisabled={!form.divisionId}
                      addDisabledHint="Select a division before adding a department"
                      onInputChange={patchDepartmentInput}
                      onSelect={selectDepartment}
                      onAddNew={(name) => void createOrgEntity("department", name)}
                    />
                    <OrgLookupCombobox
                      label="Designation"
                      required
                      value={form.designationId}
                      inputValue={form.designation}
                      options={designationOptions}
                      entityName="designation"
                      loading={orgListsLoading}
                      error={showError("designation")}
                      placeholder="Select or search designation"
                      onInputChange={(text) => {
                        patchDesignationInput(text);
                        if (showError("designation")) touchField("designation");
                      }}
                      onSelect={selectDesignation}
                      onAddNew={(name) => void createOrgEntity("designation", name)}
                    />
                    <FormField label="Status" required error={showError("status")}>
                      <SelectField
                        value={form.status}
                        onChange={(v) => {
                          patchForm({ status: v });
                          touchField("status");
                        }}
                        error={showError("status")}
                        options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                        required
                      />
                    </FormField>
                  </div>
                  <DynamicPayrollFields
                    fields={payrollFieldDefs}
                    group="basic"
                    values={form.customFieldValues}
                    errors={apiFieldErrors}
                    onChange={patchCustomField}
                  />
                </section>
                )}

                {formSection === "payroll" && (
                <section className="space-y-5">
                  <div>
                    <h4 className="mb-1 text-sm font-semibold text-slate-800">Earnings & allowances</h4>
                    <p className="mb-3 text-xs text-slate-500">
                      All earning components can be edited directly. Percentages and amounts are saved as entered.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <FormField label="Pay Level" required error={showError("payLevel")}>
                        <Input
                          id={fieldDomId("payLevel")}
                          type="number"
                          min={1}
                          invalid={Boolean(showError("payLevel"))}
                          value={form.payLevel}
                          onChange={(e) => patchForm({ payLevel: e.target.value })}
                          onBlur={() => touchField("payLevel")}
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          Night allowance rate will be applied automatically based on Pay Level.
                        </p>
                        {editing && form.payLevel.trim() !== "" ? (
                          resolvedNightAllowance.rate > 0 ? (
                            <p className="mt-1 text-xs font-medium text-slate-700">
                              Night Allowance Rate: ₹{resolvedNightAllowance.rate.toFixed(2)}/hour
                            </p>
                          ) : resolvedNightAllowance.warning ? (
                            <p className="mt-1 text-xs text-amber-700">{resolvedNightAllowance.warning}</p>
                          ) : null
                        ) : null}
                      </FormField>
                      <FormField label="Gross Basic Pay" required error={showError("grossBasicPay")}>
                        <Input
                          id={fieldDomId("grossBasicPay")}
                          type="number"
                          min={0}
                          step={100}
                          numeric
                          invalid={Boolean(showError("grossBasicPay"))}
                          value={form.grossBasicPay}
                          onChange={(e) => patchForm({ grossBasicPay: e.target.value })}
                          onBlur={() => touchField("grossBasicPay")}
                        />
                      </FormField>
                      <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={form.hasQuarter}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              patchForm({
                                hasQuarter: checked,
                                quarterId: checked ? form.quarterId : "",
                                quarterRent: checked ? form.quarterRent : "0",
                              });
                            }}
                          />
                          Quarter Assigned
                        </label>
                        {form.hasQuarter ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <FormField label="Quarter" required>
                              <SelectField
                                value={form.quarterId}
                                onChange={(v) => {
                                  const selected = quarterOptions.find((q) => q.id === v);
                                  patchForm({
                                    quarterId: v,
                                    quarterRent: selected ? String(selected.monthlyRent) : "0",
                                  });
                                }}
                                options={[
                                  { value: "", label: "Select quarter…" },
                                  ...quarterOptions.map((q) => ({
                                    value: q.id,
                                    label: `${q.quarterName} - ${q.quarterType} - ₹${Math.round(q.monthlyRent).toLocaleString("en-IN")}/month`,
                                  })),
                                ]}
                                required
                              />
                            </FormField>
                            <FormField label="Quarter Rent">
                              <Input type="number" numeric readOnly value={form.quarterRent} />
                            </FormField>
                            <p className="sm:col-span-2 text-xs text-amber-800">
                              HRA is not applicable when official quarter is assigned.
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <FormField label="DA %" required error={showError("daPercent")}>
                        <Input
                          id={fieldDomId("daPercent")}
                          type="number"
                          step="0.01"
                          invalid={Boolean(showError("daPercent"))}
                          value={form.daPercent}
                          onChange={(e) => patchForm({ daPercent: e.target.value })}
                          onBlur={() => touchField("daPercent")}
                        />
                      </FormField>
                      <FormField label="DA Amount">
                        <Input
                          type="number"
                          numeric
                          value={form.daAmount}
                          onChange={(e) => patchForm({ daAmount: e.target.value })}
                        />
                      </FormField>
                      <FormField label="HRA %" required error={showError("hraPercent")}>
                        <Input
                          id={fieldDomId("hraPercent")}
                          type="number"
                          step="0.01"
                          invalid={Boolean(showError("hraPercent"))}
                          value={form.hraPercent}
                          onChange={(e) => patchForm({ hraPercent: e.target.value })}
                          onBlur={() => touchField("hraPercent")}
                        />
                      </FormField>
                      <FormField label="HRA Amount">
                        <Input
                          type="number"
                          numeric
                          value={form.hasQuarter ? "0" : form.hraAmount}
                          readOnly={form.hasQuarter}
                          onChange={(e) => patchForm({ hraAmount: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Medical" error={showError("medical")}>
                        <Input
                          id={fieldDomId("medical")}
                          type="number"
                          numeric
                          invalid={Boolean(showError("medical"))}
                          value={form.medical}
                          onChange={(e) => patchForm({ medical: e.target.value })}
                          onBlur={() => touchField("medical")}
                        />
                      </FormField>
                      <FormField label="Transport Base">
                        <Input
                          type="number"
                          numeric
                          value={form.transportBase}
                          onChange={(e) => patchForm({ transportBase: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Transport DA">
                        <Input
                          type="number"
                          numeric
                          value={form.transportDa}
                          onChange={(e) => patchForm({ transportDa: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Transport Total">
                        <Input
                          type="number"
                          numeric
                          value={form.transportTotal}
                          onChange={(e) => patchForm({ transportTotal: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Total Earnings">
                        <Input
                          type="number"
                          numeric
                          value={form.totalEarnings}
                          onChange={(e) => patchForm({ totalEarnings: e.target.value })}
                          className="font-semibold text-emerald-900"
                        />
                      </FormField>
                    </div>
                  </div>
                  <DynamicPayrollFields
                    fields={payrollFieldDefs}
                    group="earnings"
                    values={form.customFieldValues}
                    errors={apiFieldErrors}
                    onChange={patchCustomField}
                  />
                  <div className="rounded-xl border border-brand-border bg-slate-50/80 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">Pay summary</h4>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>PF (CPF): <strong>{fmt(preview.cpfEffective)}</strong></div>
                      <div>Total deductions: <strong>{fmt(preview.totalDeductions)}</strong></div>
                      <div className="sm:col-span-2 font-semibold text-emerald-800">
                        Take home: {fmt(preview.takeHome)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">Effective date</h4>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <FormField label="Effective From" required error={showError("effectiveFrom")}>
                        <DatePickerField
                          id={fieldDomId("effectiveFrom")}
                          value={form.effectiveFrom}
                          onChange={(v) => {
                            patchForm({ effectiveFrom: v });
                            touchField("effectiveFrom");
                          }}
                          error={showError("effectiveFrom")}
                        />
                      </FormField>
                      {editing ? (
                        <FormField label="Reason for change" error={showError("reasonForChange")} className="sm:col-span-2">
                          <Input
                            id={fieldDomId("reasonForChange")}
                            invalid={Boolean(showError("reasonForChange"))}
                            value={form.reasonForChange}
                            onChange={(e) => patchForm({ reasonForChange: e.target.value })}
                            onBlur={() => touchField("reasonForChange")}
                            placeholder="When changing effective date"
                          />
                        </FormField>
                      ) : null}
                    </div>
                  </div>
                </section>
                )}

                {formSection === "statutory" && (
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Statutory details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="UAN"><Input value={form.uan} onChange={(e) => patchForm({ uan: e.target.value })} /></FormField>
                    <FormField label="CPF No"><Input value={form.cpfNo} onChange={(e) => patchForm({ cpfNo: e.target.value })} /></FormField>
                    <FormField label="PAN" required error={showError("pan")}>
                      <Input
                        id={fieldDomId("pan")}
                        invalid={Boolean(showError("pan"))}
                        value={form.pan}
                        onChange={(e) => patchForm({ pan: normalizePanInput(e.target.value) })}
                        onBlur={() => touchField("pan")}
                        maxLength={10}
                        className="uppercase"
                      />
                    </FormField>
                    <FormField label="Aadhaar" required error={showError("aadhaar")}>
                      <Input
                        id={fieldDomId("aadhaar")}
                        type="text"
                        inputMode="numeric"
                        invalid={Boolean(showError("aadhaar"))}
                        value={form.aadhaar}
                        onChange={(e) => patchForm({ aadhaar: normalizeDigits(e.target.value).slice(0, 12) })}
                        onBlur={() => touchField("aadhaar")}
                        maxLength={12}
                      />
                    </FormField>
                  </div>
                  <h4 className="mb-3 mt-5 text-sm font-semibold text-slate-800">Default deductions</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField
                      label={
                        effectiveCpfConfig.cpfCalculationMode === "fixed_amount"
                          ? "PF (CPF) — fixed amount"
                          : `PF (CPF) — ${effectiveCpfConfig.cpfPercentage}%`
                      }
                    >
                      <Input readOnly value={fmt(preview.cpfEffective)} />
                    </FormField>
                    {DEFAULT_DEDUCTION_FIELDS.map(([key, label]) => (
                      <FormField key={key} label={label} error={showError(key)}>
                        <Input
                          id={fieldDomId(key)}
                          type="number"
                          min={0}
                          numeric
                          invalid={Boolean(showError(key))}
                          value={form[key]}
                          onChange={(e) => patchForm({ [key]: e.target.value })}
                          onBlur={() => touchField(key)}
                        />
                      </FormField>
                    ))}
                  </div>

                  <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-slate-800">Employee CPF calculation</h4>
                    <p className="mb-4 text-xs text-slate-600">
                      Override institute CPF defaults for this employee. Admins manage this in Payroll Master.
                    </p>
                    <CpfCalculationSettingsForm
                      earningFields={payrollFieldDefs.filter(
                        (f) => f.fieldGroup === "earnings" && f.isActive,
                      )}
                      cpfPercentage={
                        isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
                          ? String(companyCpfSettings.cpfPercentage ?? 12)
                          : form.cpfPercentageOverride || String(companyCpfSettings.cpfPercentage ?? 12)
                      }
                      cpfBasisKeys={
                        isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
                          ? companyCpfSettings.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS
                          : form.cpfBasisFieldKeys
                      }
                      cpfCalculationMode={
                        isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
                          ? companyCpfSettings.cpfCalculationMode ?? "percentage"
                          : form.cpfCalculationMode
                      }
                      cpfFixedAmount={
                        isCpfCompanyDefaultMode(form.cpfUseCompanySettings)
                          ? String(companyCpfSettings.cpfFixedAmount ?? 0)
                          : form.cpfFixedAmount
                      }
                      onCpfPercentageChange={(v) => patchCpfCustom({ cpfPercentageOverride: v })}
                      onCpfCalculationModeChange={(mode) => patchCpfCustom({ cpfCalculationMode: mode })}
                      onCpfFixedAmountChange={(v) => patchCpfCustom({ cpfFixedAmount: v })}
                      onToggleBasisKey={toggleCpfBasisKey}
                      cpfAmountPreview={preview.cpfEffective}
                      cpfBasisAmountPreview={preview.cpfBasisAmount}
                      useCompanyDefault={isCpfCompanyDefaultMode(form.cpfUseCompanySettings)}
                      onUseCompanyDefaultChange={(v) => {
                        if (v) {
                          patchForm({ cpfUseCompanySettings: true });
                          return;
                        }
                        patchCpfCustom({
                          cpfBasisFieldKeys:
                            form.cpfBasisFieldKeys.length > 0
                              ? form.cpfBasisFieldKeys
                              : companyCpfSettings.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS,
                          cpfPercentageOverride:
                            form.cpfPercentageOverride || String(companyCpfSettings.cpfPercentage ?? 12),
                        });
                      }}
                      companyPreview={
                        companyCpfSettings.cpfFormulaPreview ??
                        (editing as PayrollMasterRecord & { cpfSettings?: { companySettings?: { cpfFormulaPreview?: string } } })
                          ?.cpfSettings?.companySettings?.cpfFormulaPreview
                      }
                      idPrefix="master-cpf"
                    />
                  </div>
                  <DynamicPayrollFields
                    fields={payrollFieldDefs}
                    group="statutory"
                    values={form.customFieldValues}
                    errors={apiFieldErrors}
                    onChange={patchCustomField}
                  />
                </section>
                )}

                {formSection === "deductions" && (
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Variable deductions</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {VARIABLE_DEDUCTION_FIELDS.map(([key, label]) => (
                      <FormField key={key} label={label} error={showError(key)}>
                        <Input
                          id={fieldDomId(key)}
                          type="number"
                          min={0}
                          numeric
                          invalid={Boolean(showError(key))}
                          value={form[key]}
                          onChange={(e) => patchForm({ [key]: e.target.value })}
                          onBlur={() => touchField(key)}
                        />
                      </FormField>
                    ))}
                  </div>
                  <DynamicPayrollFields
                    fields={payrollFieldDefs}
                    group="deductions"
                    values={form.customFieldValues}
                    errors={apiFieldErrors}
                    onChange={patchCustomField}
                  />
                </section>
                )}

                {formSection === "bank" && (
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Bank details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="Bank Name" required error={showError("bankName")}>
                      <Input
                        id={fieldDomId("bankName")}
                        invalid={Boolean(showError("bankName"))}
                        value={form.bankName}
                        onChange={(e) => patchForm({ bankName: e.target.value })}
                        onBlur={() => touchField("bankName")}
                      />
                    </FormField>
                    <FormField label="Account Number" required error={showError("bankAccountNumber")}>
                      <Input
                        id={fieldDomId("bankAccountNumber")}
                        type="text"
                        inputMode="numeric"
                        maxLength={18}
                        invalid={Boolean(showError("bankAccountNumber"))}
                        value={form.bankAccountNumber}
                        placeholder="9–18 digits"
                        onChange={(e) => patchForm({ bankAccountNumber: normalizeDigits(e.target.value).slice(0, 18) })}
                        onBlur={() => touchField("bankAccountNumber")}
                      />
                    </FormField>
                    <FormField label="IFSC" required error={showError("bankIfsc")}>
                      <Input
                        id={fieldDomId("bankIfsc")}
                        maxLength={11}
                        className="font-mono uppercase"
                        invalid={Boolean(showError("bankIfsc"))}
                        value={form.bankIfsc}
                        placeholder="e.g. SBIN0001234"
                        onChange={(e) => patchForm({ bankIfsc: normalizeIfscInput(e.target.value) })}
                        onBlur={() => touchField("bankIfsc")}
                      />
                    </FormField>
                  </div>
                  <DynamicPayrollFields
                    fields={payrollFieldDefs}
                    group="bank"
                    values={form.customFieldValues}
                    errors={apiFieldErrors}
                    onChange={patchCustomField}
                  />
                </section>
                )}

                {formSection === "history" && editing && (
                <>
                {masterHistory.length > 0 && (
                  <section className="rounded-xl border border-brand-border bg-slate-50/50 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">Payroll master history</h4>
                    <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-600">
                            <th className="px-2 py-1.5">Type</th>
                            <th className="px-2 py-1.5">Effective from</th>
                            <th className="px-2 py-1.5">Effective to</th>
                            <th className="px-2 py-1.5">DA %</th>
                            <th className="px-2 py-1.5">HRA %</th>
                            <th className="px-2 py-1.5">Gross basic</th>
                            <th className="px-2 py-1.5">Take home</th>
                            <th className="px-2 py-1.5">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {masterHistory.map((h) => (
                            <tr
                              key={h.id}
                              className={`border-b border-slate-100 ${
                                h.rowType === "CURRENT" || h.isCurrent ? "bg-emerald-50/80 font-medium" : "bg-white"
                              }`}
                            >
                              <td className="px-2 py-1.5">{h.rowType ?? (h.isCurrent ? "CURRENT" : "HISTORY")}</td>
                              <td className="px-2 py-1.5">{h.effectiveFrom?.slice(0, 10) ?? "—"}</td>
                              <td className="px-2 py-1.5">{h.effectiveTo?.slice(0, 10) ?? "—"}</td>
                              <td className="px-2 py-1.5">{h.daPercent ?? "—"}</td>
                              <td className="px-2 py-1.5">{h.hraPercent ?? "—"}</td>
                              <td className="px-2 py-1.5">{fmt(h.grossBasicPay)}</td>
                              <td className="px-2 py-1.5">{fmt(h.takeHome)}</td>
                              <td className="px-2 py-1.5 max-w-[200px] truncate" title={h.reasonForChange ?? ""}>
                                {h.reasonForChange || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {arrearHistory.length > 0 && (
                  <section className="mt-4 rounded-xl border border-violet-200/80 bg-violet-50/30 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">DA arrears history</h4>
                    <div className="max-h-48 overflow-auto rounded-lg border border-violet-100 bg-white">
                      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-violet-200 text-slate-600">
                            <th className="px-2 py-1.5">Effective from</th>
                            <th className="px-2 py-1.5">Old DA %</th>
                            <th className="px-2 py-1.5">New DA %</th>
                            <th className="px-2 py-1.5">Arrear period</th>
                            <th className="px-2 py-1.5">Payroll month</th>
                            <th className="px-2 py-1.5 text-right">DA arr.</th>
                            <th className="px-2 py-1.5 text-right">Tr. arr.</th>
                            <th className="px-2 py-1.5 text-right">Gross arr.</th>
                            <th className="px-2 py-1.5 text-right">CPF arr.</th>
                            <th className="px-2 py-1.5 text-right">Net arr.</th>
                            <th className="px-2 py-1.5">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {arrearHistory.map((b) => (
                            <tr key={b.batchId} className="border-b border-violet-100 align-top">
                              <td className="px-2 py-1.5">{b.revisionEffectiveFrom ?? "—"}</td>
                              <td className="px-2 py-1.5">{b.oldDaPercent ?? "—"}</td>
                              <td className="px-2 py-1.5">{b.newDaPercent ?? "—"}</td>
                              <td className="px-2 py-1.5">
                                {b.arrearFrom && b.arrearTo ? `${b.arrearFrom} → ${b.arrearTo}` : "—"}
                              </td>
                              <td className="px-2 py-1.5">{b.includedInPayrollMonth ?? "—"}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.daArrear)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.transportArrear)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.grossArrear)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(b.cpfArrear).toLocaleString("en-IN")}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(b.netArrear).toLocaleString("en-IN")}</td>
                              <td className="px-2 py-1.5 capitalize">{b.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                <section className="mt-4 rounded-xl border border-brand-border bg-slate-50/80 p-4">
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Calculated preview</h4>
                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>Pay level: <strong>{form.payLevel}</strong></div>
                    <div>DA amount: <strong>{fmt(preview.daAmount)}</strong></div>
                    <div>HRA amount: <strong>{fmt(preview.hraAmount)}</strong></div>
                    <div>Transport base: <strong>{fmt(preview.transportBase)}</strong></div>
                    <div>Transport DA: <strong>{fmt(preview.transportDa)}</strong></div>
                    <div>Transport total: <strong>{fmt(preview.transportTotal)}</strong></div>
                    <div>Total earnings: <strong>{fmt(preview.totalEarnings)}</strong></div>
                    <div>PF (CPF): <strong>{fmt(preview.cpfEffective)}</strong></div>
                    <div>Total deductions: <strong>{fmt(preview.totalDeductions)}</strong></div>
                    <div className="sm:col-span-2 lg:col-span-4 text-base font-semibold text-emerald-800">
                      Take home: {fmt(preview.takeHome)}
                    </div>
                  </div>
                </section>
                </>
                )}
            </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={closeImportModal}
        title="Import Payroll Master"
        description="Upload .xlsx or .csv using the template format."
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              Download template
            </Button>
            <Button
              size="sm"
              loading={importing}
              disabled={importing || importPreviewing || !importFile || !importCanConfirm}
              onClick={handleImport}
            >
              {importing ? "Importing payroll master..." : "Confirm import"}
            </Button>
          </>
        }
      >
              <div className="space-y-4">
                <FileUpload
                  file={importFile}
                  onFileChange={handleImportFileChange}
                  disabled={importing || importPreviewing}
                />

                {importFile && (importPreviewing || importing) && (
                  <AppPageLoader
                    variant="inline"
                    message={importing ? "Importing payroll master..." : "Validating import file..."}
                    submessage=""
                  />
                )}

                {importPreview && !importPreviewing && !importing && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
                        {importPreview.summary.valid_rows ?? 0} rows valid
                      </span>
                      <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-800">
                        {importPreview.summary.invalid_rows ?? 0} rows have errors
                      </span>
                      {(importPreview.summary.warning_rows ?? 0) > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">
                          {importPreview.summary.warning_rows ?? 0} warnings
                        </span>
                      ) : null}
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                        {importPreview.summary.total_rows ?? 0} total checked
                      </span>
                      {(importPreview.summary.error_count ?? 0) > 0 ? (
                        <span className="rounded-full border border-red-300 bg-red-100 px-2.5 py-1 text-red-900">
                          {importPreview.summary.error_count ?? 0} errors
                        </span>
                      ) : null}
                    </div>

                    {!importCanConfirm && importPreview.blockedMessage ? (
                      <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                        {importPreview.blockedMessage}
                      </div>
                    ) : null}

                    {importPreview.requiresConfirmation && importCanConfirm === false && (importPreview.summary.invalid_rows ?? 0) === 0 ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Review warnings below, then confirm to proceed with import.
                      </div>
                    ) : null}

                    {importPreview.requiresConfirmation && (importPreview.summary.invalid_rows ?? 0) === 0 ? (
                      <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={importWarningsAcknowledged}
                          onChange={(e) => setImportWarningsAcknowledged(e.target.checked)}
                        />
                        <span>I have reviewed the warnings and want to proceed with import.</span>
                      </label>
                    ) : null}

                    {importTemplateErrors.length > 0 ? (
                      <div className="rounded border border-red-300 bg-red-50 px-3 py-3 text-xs text-red-900">
                        <p className="font-semibold">Template format issue</p>
                        <p className="mt-1">{importTemplateErrors[0]?.message}</p>
                        {(importTemplateErrors[0]?.missing_columns?.length ?? 0) > 0 ? (
                          <div className="mt-2">
                            <p className="font-medium">Missing columns:</p>
                            <ul className="mt-1 list-inside list-disc">
                              {importTemplateErrors[0]?.missing_columns?.map((col) => (
                                <li key={col}>{col}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <p className="mt-2 font-medium">
                          Action: Download the latest template and try again.
                        </p>
                      </div>
                    ) : null}

                    {importPreview.fileErrors.length > 0 && importTemplateErrors.length === 0 && (
                      <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                        {importPreview.fileErrors.map((e, i) => (
                          <p key={i}>
                            {e.field}: {e.message}
                          </p>
                        ))}
                      </div>
                    )}

                    {(importPreview.issues?.length ?? 0) > 0 || importIssueRows.length > 0 ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-slate-700">Validation details</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadImportValidationReport(
                              importPreview.issues ??
                                importIssueRows.flatMap((r) => [
                                  ...r.errors.map((e) => ({
                                    rowNumber: r.row,
                                    employeeCode: r.employeeCode,
                                    employeeName: r.employeeName ?? r.name,
                                    employeeLabel: r.employeeLabel,
                                    field: e.field,
                                    errorType: e.type ?? "error",
                                    message: e.message,
                                  })),
                                  ...(r.warnings ?? []).map((w) => ({
                                    rowNumber: r.row,
                                    employeeCode: r.employeeCode,
                                    employeeName: r.employeeName ?? r.name,
                                    employeeLabel: r.employeeLabel,
                                    field: w.field,
                                    errorType: w.type ?? "warning",
                                    message: w.message,
                                  })),
                                ]),
                            )
                          }
                        >
                          Download Error Report
                        </Button>
                      </div>
                    ) : null}

                    {importIssueRows.length > 0 && (
                      <div className="max-h-80 space-y-2 overflow-auto rounded border border-slate-200 bg-white p-2">
                        {importIssueRows.map((r) => {
                          const label =
                            r.employeeLabel ??
                            (r.employeeName || r.name
                              ? `${r.employeeName ?? r.name}${r.employeeCode ? ` / Employee Code ${r.employeeCode}` : ""}`
                              : r.employeeCode
                                ? `Employee Code ${r.employeeCode}`
                                : r.email
                                  ? String(r.email)
                                  : "Unknown employee");

                          return (
                            <details
                              key={r.row}
                              className={cn(
                                "rounded border px-3 py-2 text-xs",
                                !r.valid ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/30",
                              )}
                              open={!r.valid}
                            >
                              <summary className="cursor-pointer font-medium text-slate-800">
                                Row {r.row} — {label}
                              </summary>
                              <ul className="mt-2 space-y-1.5 pl-1">
                                {r.errors.map((e, i) => (
                                  <li key={`e-${i}`} className="text-red-800">
                                    <span className="font-medium">{formatImportFieldLabel(e.field)}:</span> {e.message}
                                  </li>
                                ))}
                                {(r.warnings ?? []).map((w, i) => (
                                  <li key={`w-${i}`} className="text-amber-900">
                                    <span className="font-medium">{formatImportFieldLabel(w.field)}:</span> {w.message}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          );
                        })}
                      </div>
                    )}

                    {importPreview.rows.length > 0 && importIssueRows.length === 0 && importPreview.fileErrors.length === 0 ? (
                      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        All {importPreview.summary.valid_rows ?? importPreview.rows.length} rows passed validation.
                        {importPreview.requiresConfirmation
                          ? " Review warnings checkbox above if shown, then confirm import."
                          : " You can confirm import."}
                      </div>
                    ) : null}

                    {importPreview.rows.length > 0 && (
                      <details className="rounded border border-slate-200 bg-white text-xs">
                        <summary className="cursor-pointer px-3 py-2 font-medium text-slate-700">
                          Preview all rows ({importPreview.rows.length})
                        </summary>
                        <div className="max-h-56 overflow-auto border-t border-slate-100">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-slate-100">
                              <tr>
                                <th className="px-2 py-1.5">Row</th>
                                <th className="px-2 py-1.5">Employee</th>
                                <th className="px-2 py-1.5">Email</th>
                                <th className="px-2 py-1.5">Action</th>
                                <th className="px-2 py-1.5">Result</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importPreview.rows.map((r) => (
                                <tr
                                  key={r.row}
                                  className={cn(
                                    "border-t border-slate-100",
                                    !r.valid && "bg-red-50",
                                    r.valid && (r.warnings?.length ?? 0) > 0 && "bg-amber-50/50",
                                  )}
                                >
                                  <td className="px-2 py-1">{r.row}</td>
                                  <td className="px-2 py-1">
                                    {r.employeeLabel ?? r.employeeName ?? r.name ?? r.employeeCode ?? "—"}
                                  </td>
                                  <td className="px-2 py-1">{r.email || "—"}</td>
                                  <td className="px-2 py-1 capitalize">{r.action}</td>
                                  <td className="px-2 py-1">
                                    {!r.valid ? (
                                      <span className="text-red-700">Errors</span>
                                    ) : (r.warnings?.length ?? 0) > 0 ? (
                                      <span className="text-amber-800">Warning</span>
                                    ) : (
                                      <span className="text-emerald-700">OK</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {importResult && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-medium">{importResult.message}</p>
                    <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
                      {Object.entries(importResult.summary).map(([k, v]) => (
                        <div key={k}>
                          {k.replace(/_/g, " ")}: <strong>{v}</strong>
                        </div>
                      ))}
                    </div>
                    {(importResult.generatedPasswordCount ?? 0) > 0 ? (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                        <p className="font-medium">
                          {importResult.generatedPasswordCount} account
                          {importResult.generatedPasswordCount === 1 ? "" : "s"} received auto-generated passwords.
                        </p>
                        <p className="mt-1">
                          Passwords are not shown here for security. Use the password reset workflow to share
                          credentials with affected employees.
                        </p>
                        <ul className="mt-2 space-y-1">
                          {importResult.generatedPasswordAccounts?.map((gp) => (
                            <li key={gp.row}>
                              Row {gp.row}
                              {gp.employeeName || gp.employeeCode
                                ? ` — ${gp.employeeName ?? ""}${gp.employeeCode ? ` / ${gp.employeeCode}` : ""}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {importResult.errors.length > 0 && (
                      <div className="max-h-48 overflow-auto rounded border border-red-200 bg-white">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-red-50">
                              <th className="px-2 py-1">Row</th>
                              <th className="px-2 py-1">Field</th>
                              <th className="px-2 py-1">Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.errors.map((err, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-2 py-1">{err.row}</td>
                                <td className="px-2 py-1">{err.field}</td>
                                <td className="px-2 py-1">{err.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
      </Modal>

      <ConfirmDialog
        open={!!addDraftRestore}
        title="Restore unsaved draft?"
        message="You have a locally saved add-employee draft on this device. Restore it?"
        confirmText="Restore draft"
        cancelText="Start fresh"
        onConfirm={() => {
          if (addDraftRestore) {
            setForm(addDraftRestore);
            setAutosaveBaseline(formAutosaveSnapshot(addDraftRestore));
          }
          setAddDraftRestore(null);
        }}
        onCancel={() => {
          const base = {
            ...emptyForm(companyDefaultDa, companyDefaultHra),
            employeeCode: generateNextEmployeeCode(rows.map((r) => r.employeeCode ?? "").filter(Boolean)),
          };
          setForm(base);
          setAutosaveBaseline(formAutosaveSnapshot(base));
          setAddDraftRestore(null);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(PAYROLL_MASTER_ADD_DRAFT_KEY);
          }
        }}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate employee"
        message={`Deactivate ${deactivateTarget?.name ?? "this employee"} in payroll master?`}
        confirmText="Deactivate"
        variant="danger"
        loading={!!deactivateTarget && busy === deactivateTarget.id}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
