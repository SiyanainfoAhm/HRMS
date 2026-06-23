"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ToastProvider";
import { SkeletonTable } from "@/components/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { PasswordField } from "@/components/PasswordField";
import { dispatchHrmsChange, onHrmsChange } from "@/lib/hrmsChangeBus";
import { PASSWORD_COMPLEXITY_HINT, validatePasswordComplexity } from "@/lib/passwordValidators";
import {
  computePayrollMasterPreview,
  DEFAULT_DA_PERCENT,
  DEFAULT_HRA_PERCENT,
  DEFAULT_MEDICAL,
} from "@/lib/payrollMasterCalc";
import { GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS } from "@/lib/governmentPayroll";
import {
  normalizeDigits,
  normalizeIfscInput,
  validateBankAccountInteractive,
  validateIfscInteractive,
  validateIndianMobileOptionalInteractive,
} from "@/lib/employeeValidators";
import { isAdminRole, normalizeRole, type AppRole } from "@/lib/roles";

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
  grossBasicPay?: number | null;
  daPercent?: number | null;
  da_percent?: number | null;
  hraPercent?: number | null;
  hra_percent?: number | null;
  medical?: number | null;
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
  horticulture?: number | null;
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
  horticulture: string;
  vehicleCharge: string;
  otherDeduction: string;
  advance: string;
  remarks: string;
  effectiveFrom: string;
  reasonForChange: string;
  userRole: AppRole;
  password: string;
  confirmPassword: string;
};

type ImportError = { row: number; field: string; message: string };

type ImportPreviewRow = {
  row: number;
  employeeCode?: string | null;
  name?: string | null;
  email?: string | null;
  designation?: string | null;
  payLevel?: string | number | null;
  grossBasicPay?: string | number | null;
  status?: string | null;
  remarks?: string | null;
  action: "insert" | "update" | string;
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
};

type ImportPreview = {
  summary: Record<string, number>;
  rows: ImportPreviewRow[];
  fileErrors: Array<{ field: string; message: string }>;
};

const STATUS_OPTIONS = ["active", "inactive", "retired", "deceased", "resigned"] as const;

const DEFAULT_DEDUCTION_FIELDS = [["professionalTax", "Professional Tax (PT)"]] as const;

const VARIABLE_DEDUCTION_FIELDS = [
  ["incomeTax", "Income Tax"],
  ["lic", "LIC"],
  ["mess", "Mess"],
  ["welfare", "Welfare"],
  ["vpf", "VPF"],
  ["pfLoan", "PF Loan"],
  ["postOffice", "Post Office"],
  ["creditSociety", "Credit Society"],
  ["standardLicenceFee", "Std Licence Fee"],
  ["electricity", "Electricity"],
  ["water", "Water"],
  ["horticulture", "Horticulture"],
  ["vehicleCharge", "Vehicle Charge"],
  ["otherDeduction", "Other Deduction"],
  ["advance", "Advance"],
] as const;

const EARNINGS_COLUMN_COUNT = 12;
const DEFAULT_DEDUCTION_COLUMN_COUNT = 3;
const VARIABLE_DEDUCTION_COLUMN_COUNT = 15;

const emptyForm = (defaultDa = DEFAULT_DA_PERCENT, defaultHra = DEFAULT_HRA_PERCENT): MasterFormState => ({
  employeeCode: "",
  name: "",
  email: "",
  phone: "",
  gender: "",
  dateOfBirth: "",
  dateOfJoining: "",
  designation: "",
  department: "",
  division: "",
  status: "active",
  payLevel: "1",
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
  horticulture: "0",
  vehicleCharge: "0",
  otherDeduction: "0",
  advance: "0",
  remarks: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  reasonForChange: "",
  userRole: "employee",
  password: "",
  confirmPassword: "",
});

function formFromRecord(r: PayrollMasterRecord): MasterFormState {
  return {
    employeeCode: r.employeeCode ?? "",
    name: r.name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    gender: r.gender ?? "",
    dateOfBirth: r.dateOfBirth?.slice(0, 10) ?? "",
    dateOfJoining: r.dateOfJoining?.slice(0, 10) ?? "",
    designation: r.designation ?? "",
    department: r.department ?? "",
    division: r.division ?? "",
    status: r.status ?? "active",
    payLevel: String(r.payLevel ?? 1),
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
    horticulture: String(r.horticulture ?? 0),
    vehicleCharge: String(r.vehicleCharge ?? 0),
    otherDeduction: String(r.otherDeduction ?? 0),
    advance: String(r.advance ?? 0),
    remarks: r.remarks ?? "",
    effectiveFrom: r.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    reasonForChange: "",
    userRole: normalizeRole(r.userRole ?? "employee"),
    password: "",
    confirmPassword: "",
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
    grossBasicPay: parseFloat(form.grossBasicPay) || 0,
    daPercent: Number.isFinite(parseFloat(form.daPercent)) ? parseFloat(form.daPercent) : DEFAULT_DA_PERCENT,
    hraPercent: Number.isFinite(parseFloat(form.hraPercent)) ? parseFloat(form.hraPercent) : DEFAULT_HRA_PERCENT,
    medical: parseFloat(form.medical) || DEFAULT_MEDICAL,
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
    horticulture: parseFloat(form.horticulture) || 0,
    vehicleCharge: parseFloat(form.vehicleCharge) || 0,
    otherDeduction: parseFloat(form.otherDeduction) || 0,
    advance: parseFloat(form.advance) || 0,
    remarks: form.remarks.trim() || undefined,
    effectiveFrom: form.effectiveFrom || undefined,
    reasonForChange: form.reasonForChange.trim() || undefined,
    role: form.userRole,
    ...(form.password.trim() ? { password: form.password } : {}),
  };
}

function payrollStructureChanged(form: MasterFormState, baseline: MasterFormState): boolean {
  return (
    form.effectiveFrom !== baseline.effectiveFrom ||
    form.daPercent !== baseline.daPercent ||
    form.hraPercent !== baseline.hraPercent ||
    form.grossBasicPay !== baseline.grossBasicPay ||
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
    form.horticulture !== baseline.horticulture ||
    form.vehicleCharge !== baseline.vehicleCharge ||
    form.otherDeduction !== baseline.otherDeduction ||
    form.advance !== baseline.advance
  );
}

function validateForm(
  form: MasterFormState,
  editing: PayrollMasterRecord | null,
  editBaseline: MasterFormState | null,
): string | null {
  if (!form.name.trim()) return "Name is required";
  if (!form.email.trim()) return "Email is required";
  if (!form.designation.trim()) return "Designation is required";
  if (!form.payLevel || !Number.isFinite(parseInt(form.payLevel, 10))) return "Pay level must be numeric";
  const gross = parseFloat(form.grossBasicPay);
  if (!Number.isFinite(gross) || gross <= 0) return "Gross basic pay must be greater than 0";
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Invalid email";
  if (form.aadhaar && !/^\d{12}$/.test(form.aadhaar.replace(/\D/g, ""))) return "Aadhaar must be 12 digits";
  if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(form.pan)) return "Invalid PAN format";

  if (!editing) {
    const pErr = validatePasswordComplexity(form.password);
    if (pErr) return pErr;
    if (form.password !== form.confirmPassword) return "Passwords do not match";
  } else if (form.password.trim() || form.confirmPassword.trim()) {
    const pErr = validatePasswordComplexity(form.password);
    if (pErr) return pErr;
    if (form.password !== form.confirmPassword) return "Passwords do not match";
  }

  if (editing && editBaseline && form.effectiveFrom !== editBaseline.effectiveFrom && !form.reasonForChange.trim()) {
    return "Reason for change is required when revising the effective date.";
  }

  return null;
}

function contactFieldErrors(form: MasterFormState): {
  phone: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
} {
  const phoneDigits = normalizeDigits(form.phone);
  const accountDigits = normalizeDigits(form.bankAccountNumber);
  const ifscNorm = normalizeIfscInput(form.bankIfsc);
  const hasAnyBank = Boolean(form.bankName.trim() || accountDigits || ifscNorm);

  const phone = validateIndianMobileOptionalInteractive(phoneDigits);
  let bankAccount = validateBankAccountInteractive(accountDigits);
  let bankIfsc = validateIfscInteractive(form.bankIfsc);
  if (hasAnyBank) {
    if (!accountDigits) bankAccount = bankAccount ?? "Account number is required";
    if (!ifscNorm) bankIfsc = bankIfsc ?? "IFSC is required";
  }
  return { phone, bankAccount, bankIfsc };
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
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [bankAccountError, setBankAccountError] = useState<string | null>(null);
  const [bankIfscError, setBankIfscError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<{
    message: string;
    summary: Record<string, number>;
    errors: ImportError[];
  } | null>(null);
  const importPreviewRequestRef = useRef(0);

  const [deactivateTarget, setDeactivateTarget] = useState<PayrollMasterRecord | null>(null);
  const [companyDefaultDa, setCompanyDefaultDa] = useState(DEFAULT_DA_PERCENT);
  const [companyDefaultHra, setCompanyDefaultHra] = useState(DEFAULT_HRA_PERCENT);

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
    if (!canManage) return;
    return onHrmsChange((kind) => {
      if (kind === "payroll_master") void loadRows();
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

  const preview = useMemo(
    () =>
      computePayrollMasterPreview({
        payLevel: form.payLevel,
        grossBasicPay: form.grossBasicPay,
        daPercent: form.daPercent,
        hraPercent: form.hraPercent,
        medical: form.medical,
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
        horticulture: form.horticulture,
        vehicleCharge: form.vehicleCharge,
        otherDeduction: form.otherDeduction,
        advance: form.advance,
      }),
    [form],
  );

  function openAdd() {
    setEditing(null);
    setEditBaseline(null);
    setMasterHistory([]);
    setArrearHistory([]);
    setForm(emptyForm(companyDefaultDa, companyDefaultHra));
    setPasswordTouched(false);
    setConfirmPasswordTouched(false);
    setPhoneError(null);
    setBankAccountError(null);
    setBankIfscError(null);
    setFormOpen(true);
  }

  async function openEdit(row: PayrollMasterRecord) {
    setEditing(row);
    setPasswordTouched(false);
    setConfirmPasswordTouched(false);
    setPhoneError(null);
    setBankAccountError(null);
    setBankIfscError(null);
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

  function patchForm(patch: Partial<MasterFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const contactErrs = contactFieldErrors(form);
    setPhoneError(contactErrs.phone);
    setBankAccountError(contactErrs.bankAccount);
    setBankIfscError(contactErrs.bankIfsc);
    const err = validateForm(form, editing, editBaseline);
    const firstErr = err || contactErrs.phone || contactErrs.bankAccount || contactErrs.bankIfsc;
    if (firstErr) {
      showToast("error", firstErr);
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
      if (!res.ok) throw new Error(data?.message || data?.error || "Save failed");
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
          rows: data.rows ?? [],
          fileErrors: data.file_errors ?? data.fileErrors ?? [],
        };
        setImportPreview(preview);
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
  }

  async function handleImport() {
    if (!importFile) {
      showToast("error", "Select a file to import");
      return;
    }
    if (!importPreview) {
      showToast("error", importPreviewing ? "Wait for the file preview to load" : "Select a file and wait for preview");
      return;
    }
    if ((importPreview.summary.valid_rows ?? 0) === 0) {
      showToast("error", "No valid rows to import");
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

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Payroll Master</h2>
            <p className="text-sm text-brand-muted">Employee salary master — add, import, sync, and maintain payroll records.</p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary !py-1.5 !text-sm" onClick={openAdd}>
                Add Employee
              </button>
              <button type="button" className="btn btn-outline !py-1.5 !text-sm" onClick={() => setImportOpen(true)}>
                Import Excel
              </button>
              <button type="button" className="btn btn-outline !py-1.5 !text-sm" onClick={handleDownloadTemplate}>
                Download Template
              </button>
              <button
                type="button"
                className="btn btn-outline !py-1.5 !text-sm"
                onClick={handleExport}
                disabled={busy === "export"}
              >
                {busy === "export" ? "Exporting…" : "Export Master"}
              </button>
              <button
                type="button"
                className="btn btn-outline !py-1.5 !text-sm"
                onClick={handleSync}
                disabled={busy === "sync"}
              >
                {busy === "sync" ? "Syncing…" : "Sync Existing Employees"}
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <SkeletonTable rows={6} columns={12} />
        ) : loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">Could not load payroll master</p>
            <p className="mt-1">{loadError}</p>
            <button type="button" className="btn btn-outline mt-3 !py-1.5 !text-sm" onClick={() => loadRows()}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="muted">No payroll master records yet. Add an employee, import from Excel, or sync existing employees.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800/30 shadow-sm">
            <p className="border-b border-slate-200 bg-amber-50/95 px-3 py-2 text-xs leading-snug text-amber-950">
              Government payroll: <strong>PF (CPF)</strong> is always{" "}
              {Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}% of total earnings (auto-calculated).
            </p>
            <table className="w-full min-w-[3200px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-white">
                  <th colSpan={EARNINGS_COLUMN_COUNT} className={`${th} !text-center`} />
                  <th
                    colSpan={DEFAULT_DEDUCTION_COLUMN_COUNT}
                    className={`${th} !text-center border-l border-white/20`}
                  >
                    Default deductions
                  </th>
                  <th
                    colSpan={VARIABLE_DEDUCTION_COLUMN_COUNT}
                    className={`${th} !text-center border-l border-white/20`}
                  >
                    Variable deductions
                  </th>
                  <th colSpan={canWrite ? 4 : 3} className={`${th} !text-center border-l border-white/20`} />
                </tr>
                <tr className="bg-[#0a1628] text-white">
                  <th className={`${th} !text-left`}>Code</th>
                  <th className={`${th} !text-left`}>Name</th>
                  <th className={th}>Designation</th>
                  <th className={th}>Dept</th>
                  <th className={th}>Div</th>
                  <th className={th}>Level</th>
                  <th className={th}>Gross Basic</th>
                  <th className={th}>DA %</th>
                  <th className={th}>HRA %</th>
                  <th className={th}>Med</th>
                  <th className={th}>Transport</th>
                  <th className={th}>Tot. Earn.</th>
                  <th className={`${th} border-l border-white/20`}>PF (CPF)</th>
                  <th className={th}>DA CPF</th>
                  <th className={th}>PT</th>
                  <th className={`${th} border-l border-white/20`}>Inc. Tax</th>
                  <th className={th}>LIC</th>
                  <th className={th}>Mess</th>
                  <th className={th}>Welfare</th>
                  <th className={th}>VPF</th>
                  <th className={th}>PF Loan</th>
                  <th className={th}>P.O.</th>
                  <th className={th}>Credit Soc.</th>
                  <th className={th}>Std Lic.</th>
                  <th className={th}>Elec.</th>
                  <th className={th}>Water</th>
                  <th className={th}>Horti.</th>
                  <th className={th}>Vehicle</th>
                  <th className={th}>Other</th>
                  <th className={th}>Advance</th>
                  <th className={`${th} border-l border-white/20`}>Take Home</th>
                  <th className={th}>Effective</th>
                  <th className={th}>Status</th>
                  {canWrite && <th className={th}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200 bg-white hover:bg-slate-50/80">
                    <td className={tdLeft}>{row.employeeCode || "—"}</td>
                    <td className={tdLeft}>
                      <span className="font-medium text-cyan-700">{row.name || row.email || "—"}</span>
                    </td>
                    <td className={tdLeft}>{row.designation || "—"}</td>
                    <td className={tdLeft}>{row.department || "—"}</td>
                    <td className={tdLeft}>{row.division || "—"}</td>
                    <td className={td}>{row.payLevel ?? "—"}</td>
                    <td className={td}>{fmt(row.grossBasicPay)}</td>
                    <td className={td}>{row.daPercent ?? row.da_percent ?? "—"}</td>
                    <td className={td}>{row.hraPercent ?? row.hra_percent ?? "—"}</td>
                    <td className={td}>{fmt(row.medical)}</td>
                    <td className={td}>{fmt(row.transportTotal)}</td>
                    <td className={td}>{fmt(row.totalEarnings)}</td>
                    <td className={td}>{fmt(row.cpfEffective ?? row.cpfDefault)}</td>
                    <td className={td}>{fmt(row.daCpf)}</td>
                    <td className={td}>{fmt(row.professionalTax)}</td>
                    <td className={td}>{fmt(row.incomeTax)}</td>
                    <td className={td}>{fmt(row.lic)}</td>
                    <td className={td}>{fmt(row.mess)}</td>
                    <td className={td}>{fmt(row.welfare)}</td>
                    <td className={td}>{fmt(row.vpf)}</td>
                    <td className={td}>{fmt(row.pfLoan)}</td>
                    <td className={td}>{fmt(row.postOffice)}</td>
                    <td className={td}>{fmt(row.creditSociety)}</td>
                    <td className={td}>{fmt(row.standardLicenceFee)}</td>
                    <td className={td}>{fmt(row.electricity)}</td>
                    <td className={td}>{fmt(row.water)}</td>
                    <td className={td}>{fmt(row.horticulture)}</td>
                    <td className={td}>{fmt(row.vehicleCharge)}</td>
                    <td className={td}>{fmt(row.otherDeduction)}</td>
                    <td className={td}>{fmt(row.advance)}</td>
                    <td className={td}>{fmt(row.takeHome)}</td>
                    <td className={tdLeft}>{row.effectiveFrom?.slice(0, 10) ?? "—"}</td>
                    <td className={tdLeft}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          row.status === "active"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {row.status ?? "active"}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="border border-slate-200 px-1 py-1">
                        <div className="flex flex-wrap justify-center gap-1">
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-medium hover:bg-slate-100"
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </button>
                          {row.status === "active" && (
                            <button
                              type="button"
                              className="rounded border border-amber-400 px-2 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-50"
                              onClick={() => setDeactivateTarget(row)}
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button
            type="button"
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => setFormOpen(false)}
          />
          <div className="relative flex min-h-full items-center justify-center p-4">
            <form
              onSubmit={handleSave}
              className="relative z-10 flex max-h-[min(92vh,100dvh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            >
              <div className="shrink-0 border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-lg font-semibold text-slate-900">
                  {editing ? "Edit Employee" : "Add Employee"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Payroll master record — earnings, default deductions (PF &amp; PT), then variable deductions. Scroll for all sections.
                </p>
              </div>
              <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4 sm:px-6">
                {formLoading ? (
                  <p className="py-8 text-center text-sm text-slate-500">Loading payroll master record…</p>
                ) : (
                  <>
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Basic details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className={labelCls}>Employee Code</label>
                      <input className={inputCls} value={form.employeeCode} onChange={(e) => patchForm({ employeeCode: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Pay Level *</label>
                      <input type="number" min={1} className={inputCls} value={form.payLevel} onChange={(e) => patchForm({ payLevel: e.target.value })} required />
                      <p className="mt-1 text-xs text-slate-500">
                        Transport base (auto): {fmt(preview.transportBase)} — levels 1–2: ₹1,350 · 3–8: ₹3,600 · 9+: ₹7,200
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Name *</label>
                      <input className={inputCls} value={form.name} onChange={(e) => patchForm({ name: e.target.value })} required />
                    </div>
                    <div>
                      <label className={labelCls}>Email *</label>
                      <input type="email" className={inputCls} value={form.email} onChange={(e) => patchForm({ email: e.target.value })} required />
                    </div>
                    <div>
                      <label className={labelCls}>User role *</label>
                      <select
                        className={inputCls}
                        value={form.userRole}
                        onChange={(e) => patchForm({ userRole: e.target.value as AppRole })}
                        required
                      >
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                      </select>
                      <p className="mt-1 text-xs text-brand-muted">
                        Admin can manage payroll and settings. Employee can view salary slips only.
                      </p>
                    </div>
                    <div>
                      <PasswordField
                        label={editing ? "New password (optional)" : "Password *"}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(v) => patchForm({ password: v })}
                        onBlur={() => setPasswordTouched(true)}
                        error={
                          passwordTouched || formSaving
                            ? editing && !form.password.trim()
                              ? null
                              : validatePasswordComplexity(form.password)
                            : null
                        }
                      />
                      {(passwordTouched || formSaving || !editing) && !validatePasswordComplexity(form.password) && (
                        <p className="mt-1 text-xs text-brand-muted">{PASSWORD_COMPLEXITY_HINT}</p>
                      )}
                      {editing && (
                        <p className="mt-1 text-xs text-brand-muted">Leave blank to keep the current password.</p>
                      )}
                    </div>
                    <div>
                      <PasswordField
                        label={editing ? "Confirm new password" : "Confirm password *"}
                        autoComplete="new-password"
                        value={form.confirmPassword}
                        onChange={(v) => patchForm({ confirmPassword: v })}
                        onBlur={() => setConfirmPasswordTouched(true)}
                        error={
                          confirmPasswordTouched || formSaving
                            ? form.confirmPassword && form.password !== form.confirmPassword
                              ? "Passwords do not match"
                              : !editing && !form.confirmPassword.trim()
                                ? "Please confirm the password"
                                : null
                            : null
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Phone</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        autoComplete="tel"
                        className={fieldInputCls(Boolean(phoneError))}
                        value={form.phone}
                        aria-invalid={Boolean(phoneError)}
                        placeholder="10-digit mobile (starts 6–9)"
                        onChange={(e) => patchForm({ phone: normalizeDigits(e.target.value).slice(0, 10) })}
                        onKeyUp={(e) => {
                          const d = normalizeDigits(e.currentTarget.value).slice(0, 10);
                          setPhoneError(validateIndianMobileOptionalInteractive(d));
                        }}
                      />
                      {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
                      {!phoneError && form.phone.length > 0 && form.phone.length < 10 && (
                        <p className="mt-1 text-xs text-slate-500">{form.phone.length}/10 digits</p>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Gender</label>
                      <select className={inputCls} value={form.gender} onChange={(e) => patchForm({ gender: e.target.value })}>
                        <option value="">—</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Date of Birth</label>
                      <DatePickerField value={form.dateOfBirth} onChange={(v) => patchForm({ dateOfBirth: v })} className="w-full" />
                    </div>
                    <div>
                      <label className={labelCls}>Date of Joining</label>
                      <DatePickerField value={form.dateOfJoining} onChange={(v) => patchForm({ dateOfJoining: v })} className="w-full" />
                    </div>
                    <div>
                      <label className={labelCls}>Designation *</label>
                      <input className={inputCls} value={form.designation} onChange={(e) => patchForm({ designation: e.target.value })} required />
                    </div>
                    <div>
                      <label className={labelCls}>Department</label>
                      <input className={inputCls} value={form.department} onChange={(e) => patchForm({ department: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Division</label>
                      <input className={inputCls} value={form.division} onChange={(e) => patchForm({ division: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Status *</label>
                      <select className={inputCls} value={form.status} onChange={(e) => patchForm({ status: e.target.value })} required>
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Payroll details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className={labelCls}>Gross Basic Pay *</label>
                      <input type="number" min={0} step={100} className={inputCls} value={form.grossBasicPay} onChange={(e) => patchForm({ grossBasicPay: e.target.value })} required />
                    </div>
                    <div>
                      <label className={labelCls}>DA %</label>
                      <input type="number" step="0.01" className={inputCls} value={form.daPercent} onChange={(e) => patchForm({ daPercent: e.target.value })} />
                      <p className="mt-1 text-xs text-slate-500">
                        {editing
                          ? "Changing DA creates a new master version from Effective From; previous rates are kept in history below."
                          : `Pre-filled from institute default (${companyDefaultDa}%).`}
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>HRA %</label>
                      <input type="number" step="0.01" className={inputCls} value={form.hraPercent} onChange={(e) => patchForm({ hraPercent: e.target.value })} />
                      <p className="mt-1 text-xs text-slate-500">
                        {editing
                          ? "Changing HRA creates a new master version from Effective From; previous rates are kept in history below."
                          : `Pre-filled from institute default (${companyDefaultHra}%).`}
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Medical</label>
                      <input type="number" className={inputCls} value={form.medical} onChange={(e) => patchForm({ medical: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>UAN</label>
                      <input className={inputCls} value={form.uan} onChange={(e) => patchForm({ uan: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>CPF No</label>
                      <input className={inputCls} value={form.cpfNo} onChange={(e) => patchForm({ cpfNo: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>PAN</label>
                      <input className={inputCls} value={form.pan} onChange={(e) => patchForm({ pan: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Aadhaar</label>
                      <input className={inputCls} value={form.aadhaar} onChange={(e) => patchForm({ aadhaar: e.target.value })} maxLength={12} />
                    </div>
                    <div>
                      <label className={labelCls}>Effective From</label>
                      <DatePickerField value={form.effectiveFrom} onChange={(v) => patchForm({ effectiveFrom: v })} className="w-full" />
                      <p className="mt-1 text-xs text-slate-500">
                        Creating a new effective date archives the previous payroll master into history and makes this
                        the current record.
                      </p>
                    </div>
                    {editing ? (
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Reason for change</label>
                        <input
                          className={inputCls}
                          value={form.reasonForChange}
                          onChange={(e) => patchForm({ reasonForChange: e.target.value })}
                          placeholder="Required when changing the effective date"
                        />
                      </div>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Default deductions</h4>
                  <p className="mb-3 text-xs text-slate-500">
                    PF (CPF) is fixed at {Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}% of total
                    earnings and updates when you change pay components. Edit PT below.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className={labelCls}>
                        PF (CPF) — {Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}% of total earnings
                      </label>
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        className={`${inputCls} cursor-not-allowed bg-slate-100 text-slate-700`}
                        value={fmt(preview.cpfEffective)}
                        aria-readonly
                      />
                    </div>
                    {DEFAULT_DEDUCTION_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <label className={labelCls}>{label}</label>
                        <input
                          type="number"
                          min={0}
                          className={inputCls}
                          value={form[key]}
                          onChange={(e) => patchForm({ [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Variable deductions</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {VARIABLE_DEDUCTION_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <label className={labelCls}>{label}</label>
                        <input
                          type="number"
                          min={0}
                          className={inputCls}
                          value={form[key]}
                          onChange={(e) => patchForm({ [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Bank details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className={labelCls}>Bank Name</label>
                      <input className={inputCls} value={form.bankName} onChange={(e) => patchForm({ bankName: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Account Number</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={18}
                        className={fieldInputCls(Boolean(bankAccountError))}
                        value={form.bankAccountNumber}
                        aria-invalid={Boolean(bankAccountError)}
                        placeholder="9–18 digits"
                        onChange={(e) =>
                          patchForm({ bankAccountNumber: normalizeDigits(e.target.value).slice(0, 18) })
                        }
                        onKeyUp={(e) => {
                          const d = normalizeDigits(e.currentTarget.value).slice(0, 18);
                          setBankAccountError(validateBankAccountInteractive(d));
                        }}
                      />
                      {bankAccountError && <p className="mt-1 text-xs text-red-600">{bankAccountError}</p>}
                      {!bankAccountError &&
                        form.bankAccountNumber.length > 0 &&
                        form.bankAccountNumber.length < 9 && (
                          <p className="mt-1 text-xs text-slate-500">{form.bankAccountNumber.length}/9+ digits</p>
                        )}
                    </div>
                    <div>
                      <label className={labelCls}>IFSC</label>
                      <input
                        type="text"
                        maxLength={11}
                        className={`${fieldInputCls(Boolean(bankIfscError))} font-mono uppercase`}
                        value={form.bankIfsc}
                        aria-invalid={Boolean(bankIfscError)}
                        placeholder="e.g. SBIN0001234"
                        onChange={(e) => patchForm({ bankIfsc: normalizeIfscInput(e.target.value) })}
                        onKeyUp={(e) => setBankIfscError(validateIfscInteractive(e.currentTarget.value))}
                      />
                      {bankIfscError && <p className="mt-1 text-xs text-red-600">{bankIfscError}</p>}
                      {!bankIfscError && form.bankIfsc.length > 0 && form.bankIfsc.length < 11 && (
                        <p className="mt-1 text-xs text-slate-500">{form.bankIfsc.length}/11 characters</p>
                      )}
                    </div>
                  </div>
                </section>

                {editing && masterHistory.length > 0 && (
                  <section className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">Payroll master history</h4>
                    <p className="mb-3 text-xs text-slate-500">
                      Current row from payroll master; previous versions from payroll master history.
                    </p>
                    <div className="overflow-x-auto">
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

                {editing && arrearHistory.length > 0 && (
                  <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">DA Arrears History</h4>
                    <div className="overflow-x-auto">
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

                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
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
              <div className="shrink-0 border-t border-slate-100 bg-slate-50/90 px-5 py-3 sm:px-6">
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-outline" onClick={() => setFormOpen(false)} disabled={formSaving || formLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={formSaving || formLoading}>
                    {formSaving ? "Saving…" : editing ? "Update" : "Add Employee"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <button type="button" className="fixed inset-0 bg-slate-900/50" aria-label="Close" onClick={closeImportModal} />
          <div className="relative flex min-h-full items-center justify-center p-4">
            <div className="relative z-10 w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-lg font-semibold text-slate-900">Import Payroll Master</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Upload .xlsx or .csv using the template format. Records appear below as soon as you select a file.
                </p>
              </div>
              <div className="space-y-4 px-5 py-4">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleImportFileChange(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm"
                />
                {importFile && (
                  <p className="text-xs text-slate-600">
                    Selected: <span className="font-medium text-slate-800">{importFile.name}</span>
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline !py-1.5 !text-sm"
                    onClick={handleDownloadTemplate}
                  >
                    Download template
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary !py-1.5 !text-sm"
                    onClick={handleImport}
                    disabled={
                      importing ||
                      importPreviewing ||
                      !importFile ||
                      !importPreview ||
                      (importPreview.summary.valid_rows ?? 0) === 0
                    }
                  >
                    {importing ? "Importing…" : "Confirm import"}
                  </button>
                </div>

                {importFile && importPreviewing && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
                    Reading file and validating rows…
                  </div>
                )}

                {importPreview && !importPreviewing && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                      {[
                        ["total_rows", "Total"],
                        ["valid_rows", "Valid"],
                        ["invalid_rows", "Invalid"],
                        ["insert_rows", "New"],
                        ["update_rows", "Updates"],
                      ].map(([key, label]) =>
                        importPreview.summary[key] != null ? (
                          <div key={key}>
                            {label}: <strong>{importPreview.summary[key]}</strong>
                          </div>
                        ) : null,
                      )}
                    </div>
                    {importPreview.fileErrors.length > 0 && (
                      <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                        {importPreview.fileErrors.map((e, i) => (
                          <p key={i}>
                            {e.field}: {e.message}
                          </p>
                        ))}
                      </div>
                    )}
                    {importPreview.rows.length > 0 && (
                      <div className="max-h-72 overflow-auto rounded border border-slate-200 bg-white">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-100">
                            <tr>
                              <th className="px-2 py-1.5">Row</th>
                              <th className="px-2 py-1.5">Code</th>
                              <th className="px-2 py-1.5">Name</th>
                              <th className="px-2 py-1.5">Email</th>
                              <th className="px-2 py-1.5">Designation</th>
                              <th className="px-2 py-1.5">Level</th>
                              <th className="px-2 py-1.5">Gross</th>
                              <th className="px-2 py-1.5">Status</th>
                              <th className="px-2 py-1.5">Action</th>
                              <th className="px-2 py-1.5">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.rows.map((r) => (
                              <tr
                                key={r.row}
                                className={`border-t border-slate-100 ${r.valid ? "" : "bg-red-50"}`}
                              >
                                <td className="px-2 py-1">{r.row}</td>
                                <td className="px-2 py-1">{r.employeeCode || "—"}</td>
                                <td className="px-2 py-1">{r.name || "—"}</td>
                                <td className="px-2 py-1">{r.email || "—"}</td>
                                <td className="px-2 py-1">{r.designation || "—"}</td>
                                <td className="px-2 py-1">{r.payLevel ?? "—"}</td>
                                <td className="px-2 py-1">{r.grossBasicPay ?? "—"}</td>
                                <td className="px-2 py-1">{r.status || "—"}</td>
                                <td className="px-2 py-1 capitalize">{r.action}</td>
                                <td className="px-2 py-1">
                                  {r.valid ? (
                                    <span className="text-emerald-700">OK</span>
                                  ) : (
                                    <span className="text-red-700" title={r.errors.map((e) => e.message).join("; ")}>
                                      {r.errors.map((e) => e.message).join("; ") || "Invalid"}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
              <div className="border-t border-slate-100 px-5 py-3 text-right">
                <button type="button" className="btn btn-outline" onClick={closeImportModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
