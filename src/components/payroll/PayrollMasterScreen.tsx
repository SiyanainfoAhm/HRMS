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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ToastProvider";
import { SkeletonTable, SkeletonCard } from "@/components/Skeleton";
import { AppCard } from "@/components/ui/AppCard";
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
import { PayrollMasterDataGrid } from "@/components/payroll/PayrollMasterDataGrid";
import { PasswordField } from "@/components/PasswordField";
import { dispatchHrmsChange, onHrmsChange } from "@/lib/hrmsChangeBus";
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
  normalizePanInput,
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
    setForm({
      ...emptyForm(companyDefaultDa, companyDefaultHra),
      employeeCode: generateNextEmployeeCode(rows.map((r) => r.employeeCode ?? "").filter(Boolean)),
    });
    resetFormValidationState();
    setFormSection("basic");
    setFormOpen(true);
  }

  async function openEdit(row: PayrollMasterRecord) {
    setEditing(row);
    resetFormValidationState();
    setFormSection("basic");
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

  const cpfBadge = `CPF auto-calculated at ${Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}% of total earnings`;

  const formSections = [
    { id: "basic" as const, label: "Basic Details" },
    { id: "payroll" as const, label: "Payroll Details" },
    { id: "statutory" as const, label: "Statutory" },
    { id: "deductions" as const, label: "Deductions" },
    { id: "bank" as const, label: "Bank Details" },
    ...(editing ? [{ id: "history" as const, label: "History" }] : []),
  ];

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
                Export Master
              </Button>
              <Button size="sm" variant="outline" onClick={handleSync} loading={busy === "sync"} disabled={busy === "sync"}>
                Sync Employees
              </Button>
            </>
          ) : undefined
        }
      />

      <AppCard padding={false} className="overflow-hidden">
        {loading ? (
          <div className="p-4">
            <SkeletonTable rows={8} columns={10} />
          </div>
        ) : loadError ? (
          <div className="p-5">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">Could not load payroll master</p>
              <p className="mt-1">{loadError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => loadRows()}>
                Retry
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
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
            resetKey={rows.map((r) => r.id).join(",")}
            onEdit={openEdit}
            onDeactivate={setDeactivateTarget}
          />
        )}
      </AppCard>

      <Modal
        open={formOpen}
        onClose={() => {
          resetFormValidationState();
          setFormOpen(false);
        }}
        title={editing ? "Edit Employee" : "Add Employee"}
        description={editing ? `${form.employeeCode || "—"} · ${form.name || form.email}` : "Payroll master record"}
        headerExtra={editing ? <Badge tone={form.status === "active" ? "success" : "neutral"}>{form.status}</Badge> : null}
        size="2xl"
        asForm
        onSubmit={handleSave}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                resetFormValidationState();
                setFormOpen(false);
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
                      setFormSection(s.id);
                      visitTab(s.id);
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
                    <FormField label="Designation" required error={showError("designation")}>
                      <Input
                        id={fieldDomId("designation")}
                        invalid={Boolean(showError("designation"))}
                        value={form.designation}
                        onChange={(e) => patchForm({ designation: e.target.value })}
                        onBlur={() => touchField("designation")}
                      />
                    </FormField>
                    <div>
                      <label className={labelCls}>Department</label>
                      <input className={inputCls} value={form.department} onChange={(e) => patchForm({ department: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Division</label>
                      <input className={inputCls} value={form.division} onChange={(e) => patchForm({ division: e.target.value })} />
                    </div>
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
                </section>
                )}

                {formSection === "payroll" && (
                <section>
                  <h4 className="mb-3 text-sm font-semibold text-slate-800">Payroll details</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    <FormField label={`PF (CPF) — ${Math.round(GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS * 100)}%`}>
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
              disabled={
                importing ||
                importPreviewing ||
                !importFile ||
                !importPreview ||
                (importPreview?.summary?.valid_rows ?? 0) === 0
              }
              onClick={handleImport}
            >
              Confirm import
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

                {importFile && importPreviewing && (
                  <SkeletonTable rows={4} columns={6} />
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
      </Modal>

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
