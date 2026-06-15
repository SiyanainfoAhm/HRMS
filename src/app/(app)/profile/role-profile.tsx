"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo, useState, useRef, FormEvent } from "react";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { PasswordField } from "@/components/PasswordField";
import { upload as apiUpload } from "@/lib/api";
import { fmtDmy } from "@/lib/dateFormat";
import { isAdminRole } from "@/lib/roles";
import {
  normalizeDigits,
  normalizePanInput,
  validateAadhaarDigits,
  validateBankDetails,
  validateIndianMobileDigits,
  validateIndianMobileInteractive,
  normalizeIfscInput,
} from "@/lib/employeeValidators";
import { PASSWORD_COMPLEXITY_HINT, validatePasswordComplexity } from "@/lib/passwordValidators";
import { GovernmentPayslipPrint } from "@/components/payslip/GovernmentPayslipPrint";
import type { GovernmentMonthlySlip } from "@/lib/governmentPayslipLayout";
import type { GovernmentLeavePayslipDisplay } from "@/lib/leaveBalancesCompute";

export function ProfileContent() {
  const { role } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const isEmployeeSelfService = !isAdminRole(role);
  const tab = params.get("tab") || (isEmployeeSelfService ? "pay" : "profile");

  useEffect(() => {
    if (isEmployeeSelfService && tab !== "pay") {
      router.replace("/profile?tab=pay");
    }
  }, [isEmployeeSelfService, tab, router]);

  const canEditEmployment = useMemo(() => isAdminRole(role), [role]);
  const canEditOrgFields = useMemo(() => isAdminRole(role), [role]);
  const isAdmin = isAdminRole(role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emergencyPhoneError, setEmergencyPhoneError] = useState<string | null>(null);
  const [aadhaarError, setAadhaarError] = useState<string | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);

  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [authProvider, setAuthProvider] = useState<"password" | "google">("password");

  const newPasswordError = useMemo(() => {
    if (!newPasswordTouched && !newPassword) return null;
    return validatePasswordComplexity(newPassword);
  }, [newPassword, newPasswordTouched]);

  const [form, setForm] = useState({
    email: "",
    name: "",
    employeeCode: "",
    phone: "",
    gender: "" as "" | "male" | "female" | "other",
    designation: "",
    designationId: "",
    departmentId: "",
    divisionId: "",
    shiftId: "",
    aadhaar: "",
    pan: "",
    uanNumber: "",
    pfNumber: "",
    esicNumber: "",
    dateOfBirth: "",
    dateOfJoining: "",
    currentAddressLine1: "",
    currentAddressLine2: "",
    currentCity: "",
    currentState: "",
    currentCountry: "",
    currentPostalCode: "",
    permanentAddressLine1: "",
    permanentAddressLine2: "",
    permanentCity: "",
    permanentState: "",
    permanentCountry: "",
    permanentPostalCode: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    bankName: "",
    bankAccountHolderName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    employmentStatus: "preboarding" as "preboarding" | "current" | "past",
    ctc: null as number | null,
  });

  const [payslipsData, setPayslipsData] = useState<{
    company: { name: string; address: string; logoUrl: string | null } | null;
    user: {
      name: string;
      employeeCode: string;
      designation: string;
      departmentName?: string;
      dateOfJoining: string;
      aadhaar: string;
      pan: string;
      uanNumber: string;
      pfNumber: string;
      esicNumber: string;
      governmentPayLevel?: number | null;
    } | null;
    payslips: {
      id: string;
      periodMonth: string;
      periodStart: string;
      periodFormatted: string;
      generatedAt: string;
      payDays: number;
      unpaidLeaves: number;
      netPay: number;
      grossPay: number;
      basic: number;
      hra: number;
      allowances: number;
      medical: number;
      trans: number;
      lta: number;
      personal: number;
      deductions: number;
      pfEmployee: number;
      esicEmployee: number;
      professionalTax: number;
      incentive: number;
      prBonus: number;
      reimbursement: number;
      tds: number;
      bankName?: string;
      bankAccountNumber?: string;
      payrollMode?: string;
      governmentMonthly?: Record<string, number> | null;
      leavePayslip?: GovernmentLeavePayslipDisplay | null;
    }[];
  } | null>(null);
  const [myPayrollMaster, setMyPayrollMaster] = useState<{ tds?: number | null } | null>(null);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const payslipRef = useRef<HTMLDivElement>(null);

  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [designations, setDesignations] = useState<{ id: string; title: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; division_id?: string }[]>([]);
  const [divisions, setDivisions] = useState<{ id: string; name: string }[]>([]);
  const [shifts, setShifts] = useState<{ id: string; name: string }[]>([]);
  const [designationAddPrompt, setDesignationAddPrompt] = useState<string | null>(null);
  const [addingDesignation, setAddingDesignation] = useState(false);

  type MyDocRow = {
    submission_id: string;
    document_id: string;
    document_name: string;
    kind: string;
    status: string;
    file_url: string | null;
    signature_name: string | null;
    signed_at: string | null;
    submitted_at: string | null;
    review_note: string | null;
  };

  function parseMyDocumentsPayload(data: Record<string, unknown>): MyDocRow[] {
    const raw =
      (data.items as unknown[]) ??
      (data.documents as unknown[]) ??
      [];
    if (!Array.isArray(raw)) return [];

    return raw.map((item) => {
      const row = item as Record<string, unknown>;
      const doc = (row.document as Record<string, unknown> | undefined) ?? {};
      return {
        submission_id: String(row.submission_id ?? row.id ?? ""),
        document_id: String(row.document_id ?? doc.id ?? ""),
        document_name: String(row.document_name ?? doc.name ?? "Document"),
        kind: String(row.kind ?? doc.kind ?? "upload"),
        status: String(row.status ?? "pending"),
        file_url: (row.file_url as string | null) ?? null,
        signature_name: (row.signature_name as string | null) ?? null,
        signed_at: (row.signed_at as string | null) ?? null,
        submitted_at: (row.submitted_at as string | null) ?? null,
        review_note: (row.review_note as string | null) ?? null,
      };
    });
  }

  const [myDocuments, setMyDocuments] = useState<MyDocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string>("");
  const [docBusyId, setDocBusyId] = useState<string | null>(null);

  async function uploadToStorage(_docName: string, _kind: "upload" | "digital_signature", file: Blob, fileNameHint: string) {
    const formData = new FormData();
    formData.append("file", file, fileNameHint || "file");
    const result = await apiUpload("/reimbursements/upload", formData);
    return result.url;
  }

  async function refreshMyDocuments() {
    const res = await fetch("/api/me/documents");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to load documents");
    setMyDocuments(parseMyDocumentsPayload(data));
  }

  async function handleDownloadPdf(userName?: string, month?: string, year?: string) {
    const el = payslipRef.current;
    if (!el) return;

    setPdfDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight) * 0.95;
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 5;

      pdf.addImage(imgData, "PNG", imgX, imgY, imgWidth * ratio, imgHeight * ratio);

      const namePart = (userName || "Employee").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-") || "Employee";
      const monthStr = (month || String(new Date().getMonth() + 1)).padStart(2, "0");
      const yearStr = year || String(new Date().getFullYear());
      const fileName = `Salary-Slip-${namePart}-${monthStr}-${yearStr}.pdf`;

      pdf.save(fileName);
    } catch (err) {
      console.error("PDF download failed:", err);
      window.print();
    } finally {
      setPdfDownloading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load profile");
        if (cancelled) return;
        const u = data.user;
        setMeId(String(u?.id ?? ""));
        setAuthProvider(u?.authProvider === "google" ? "google" : "password");
        setForm({
          email: u?.email ?? "",
          name: u?.name ?? "",
          employeeCode: u?.employeeCode ?? "",
          phone: normalizeDigits(String(u?.phone ?? "")).slice(-10),
          gender: (["male", "female", "other"].includes(u?.gender) ? u.gender : "") as "" | "male" | "female" | "other",
          designation: u?.designation ?? "",
          designationId: u?.designationId ?? "",
          departmentId: u?.departmentId ?? "",
          divisionId: u?.divisionId ?? "",
          shiftId: u?.shiftId ?? "",
          aadhaar: normalizeDigits(String(u?.aadhaar ?? "")).slice(0, 12),
          pan: normalizePanInput(String(u?.pan ?? "")),
          uanNumber: u?.uanNumber ?? "",
          pfNumber: u?.pfNumber ?? "",
          esicNumber: u?.esicNumber ?? "",
          dateOfBirth: u?.dateOfBirth ?? "",
          dateOfJoining: u?.dateOfJoining ?? "",
          currentAddressLine1: u?.currentAddressLine1 ?? "",
          currentAddressLine2: u?.currentAddressLine2 ?? "",
          currentCity: u?.currentCity ?? "",
          currentState: u?.currentState ?? "",
          currentCountry: u?.currentCountry ?? "",
          currentPostalCode: normalizeDigits(String(u?.currentPostalCode ?? "")).slice(0, 6),
          permanentAddressLine1: u?.permanentAddressLine1 ?? "",
          permanentAddressLine2: u?.permanentAddressLine2 ?? "",
          permanentCity: u?.permanentCity ?? "",
          permanentState: u?.permanentState ?? "",
          permanentCountry: u?.permanentCountry ?? "",
          permanentPostalCode: normalizeDigits(String(u?.permanentPostalCode ?? "")).slice(0, 6),
          emergencyContactName: u?.emergencyContactName ?? "",
          emergencyContactPhone: normalizeDigits(String(u?.emergencyContactPhone ?? "")).slice(-10),
          bankName: u?.bankName ?? "",
          bankAccountHolderName: u?.bankAccountHolderName ?? "",
          bankAccountNumber: normalizeDigits(String(u?.bankAccountNumber ?? "")),
          bankIfsc: String(u?.bankIfsc ?? "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 11),
          employmentStatus: u?.employmentStatus ?? "preboarding",
          ctc: u?.ctc ?? null,
        } as any);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/payroll-master");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load payroll master");
        if (!cancelled) setMyPayrollMaster(data?.payrollMaster ?? null);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "documents") return;
    let cancelled = false;
    (async () => {
      setDocsLoading(true);
      setDocsError(null);
      try {
        await refreshMyDocuments();
      } catch (e: unknown) {
        if (!cancelled) setDocsError(e instanceof Error ? e.message : "Failed to load documents");
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "profile" || isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const [desRes, depRes, divRes, shiftRes] = await Promise.all([
          fetch("/api/settings/designations"),
          fetch("/api/settings/departments"),
          fetch("/api/settings/divisions"),
          fetch("/api/settings/shifts"),
        ]);
        if (cancelled) return;
        const [desData, depData, divData, shiftData] = await Promise.all([
          desRes.json(),
          depRes.json(),
          divRes.json(),
          shiftRes.json(),
        ]);
        if (cancelled) return;
        setDesignations((desData.designations ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, title: d.title })));
        setDepartments((depData.departments ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name, division_id: d.division_id })));
        setDivisions((divData.divisions ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name })));
        setShifts((shiftData.shifts ?? []).filter((d: any) => d.is_active !== false).map((d: any) => ({ id: d.id, name: d.name })));
      } catch {
        // keep empty
      }
    })();
    return () => { cancelled = true; };
  }, [tab, isAdmin]);

  useEffect(() => {
    if (tab !== "pay") return;
    let cancelled = false;
    (async () => {
      setPayslipsLoading(true);
      setPayslipsError(null);
      try {
        const res = await fetch("/api/payslips/me");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load payslips");
        if (!cancelled) {
          setPayslipsData({
            company: data.company,
            user: data.user,
            payslips: data.payslips || [],
          });
          const slips = data.payslips || [];
          const first = slips[0];
          const now = new Date();
          if (first?.periodMonth) {
            const [y, m] = first.periodMonth.split("-");
            setSelectedYear(y || String(now.getFullYear()));
            setSelectedMonth(m || String(now.getMonth() + 1).padStart(2, "0"));
          } else {
            setSelectedYear(String(now.getFullYear()));
            setSelectedMonth(String(now.getMonth() + 1).padStart(2, "0"));
          }
        }
      } catch (e: any) {
        if (!cancelled) setPayslipsError(e?.message || "Failed to load payslips");
      } finally {
        if (!cancelled) setPayslipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    setPhoneError(null);
    setEmergencyPhoneError(null);
    setAadhaarError(null);
    setBankError(null);

    const phoneDigits = normalizeDigits(form.phone);
    if (phoneDigits) {
      const phErr = validateIndianMobileDigits(phoneDigits);
      if (phErr) {
        setPhoneError(phErr);
        setError(phErr);
        setSaving(false);
        return;
      }
    }
    const emergencyDigits = normalizeDigits(form.emergencyContactPhone);
    if (emergencyDigits) {
      const emErr = validateIndianMobileDigits(emergencyDigits);
      if (emErr) {
        setEmergencyPhoneError(emErr);
        setError(`Emergency contact: ${emErr}`);
        setSaving(false);
        return;
      }
    }
    const aadhaarDigits = normalizeDigits(form.aadhaar);
    if (aadhaarDigits) {
      const aErr = validateAadhaarDigits(aadhaarDigits);
      if (aErr) {
        setAadhaarError(aErr);
        setError(aErr);
        setSaving(false);
        return;
      }
    }

    const bankDigits = normalizeDigits(form.bankAccountNumber);
    const bankIfscNorm = normalizeIfscInput(form.bankIfsc);
    const hasAnyBank =
      form.bankName.trim() ||
      form.bankAccountHolderName.trim() ||
      bankDigits ||
      bankIfscNorm;
    if (hasAnyBank) {
      const bErr = validateBankDetails({
        bankName: form.bankName,
        bankAccountHolderName: form.bankAccountHolderName,
        bankAccountNumber: bankDigits,
        bankIfsc: bankIfscNorm,
        legalName: form.name,
      });
      if (bErr) {
        setBankError(bErr);
        setError(bErr);
        setSaving(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          phone: phoneDigits,
          emergencyContactPhone: emergencyDigits,
          aadhaar: aadhaarDigits,
          bankAccountNumber: bankDigits,
          bankIfsc: bankIfscNorm,
          bankAccountHolderName: form.bankAccountHolderName.trim(),
          currentPostalCode: normalizeDigits(form.currentPostalCode),
          permanentPostalCode: normalizeDigits(form.permanentPostalCode),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const emailErr = data?.errors?.email?.[0];
        throw new Error(emailErr || data?.message || data?.error || "Failed to save profile");
      }
      setSuccess("Saved");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    setNewPasswordTouched(true);
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    const complexityErr = validatePasswordComplexity(newPassword);
    if (complexityErr) {
      setPasswordError(complexityErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to change password");
      setPasswordSuccess("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: unknown) {
      setPasswordError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <>
      {designationAddPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close"
            onClick={() => setDesignationAddPrompt(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <p className="text-sm text-slate-700">
              Add &quot;{designationAddPrompt}&quot; to designations?
            </p>
            <p className="mt-1 text-xs text-slate-500">This will add it to the master list for future use.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  setAddingDesignation(true);
                  try {
                    const res = await fetch("/api/settings/designations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ title: designationAddPrompt }),
                    });
                    const data = await res.json();
                    if (res.ok && data?.designation) {
                      setDesignations((prev) => [...prev, { id: data.designation.id, title: data.designation.title }]);
                      setForm((p) => ({ ...p, designationId: data.designation.id, designation: data.designation.title }));
                      setDesignationAddPrompt(null);
                    }
                  } catch {
                    // ignore
                  } finally {
                    setAddingDesignation(false);
                  }
                }}
                disabled={addingDesignation}
                className="btn btn-primary"
              >
                {addingDesignation ? "Adding..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setDesignationAddPrompt(null)}
                className="btn btn-outline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

    <section className="space-y-4">
      <div>
        <h1 className="page-title">{isEmployeeSelfService ? "My Salary Slips" : "Profile"}</h1>
        <p className="muted">
          {isEmployeeSelfService
            ? "View and download your salary slips."
            : isAdmin
              ? "You are the master admin. Manage companies and edit company details—employee fields do not apply to you."
              : "For employees this shows personal, bank and emergency contact information."}
        </p>
      </div>

      {!isEmployeeSelfService && (
      <div className="flex flex-wrap gap-2">
        <Link
          href="/profile?tab=profile"
          className={`btn ${tab === "profile" ? "btn-primary" : "btn-outline"}`}
        >
          My Profile
        </Link>
        {!isAdmin && (
            <Link
              href="/profile?tab=pay"
              className={`btn ${tab === "pay" ? "btn-primary" : "btn-outline"}`}
            >
              My Pay
            </Link>
        )}
      </div>
      )}

      {tab === "profile" && (
        <>
        <form onSubmit={handleSave} className="card space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                {isAdmin ? "Account details" : "My details"}
              </h2>
              <p className="muted">
                {isAdmin
                  ? "Basic account info. You manage companies from the Companies section."
                  : ""}
              </p>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving || loading}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          {loading ? (
            <p className="muted">Loading...</p>
          ) : (
            <div className="space-y-6">
              {error && <p className="text-sm text-red-600">{error}</p>}
              {success && <p className="text-sm text-emerald-700">{success}</p>}

              <div className={`grid grid-cols-1 gap-4 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-3"}`}>
                {isAdmin && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    required
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="mt-0.5 text-xs text-slate-500">Used to sign in. Must be unique.</p>
                </div>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => {
                      const d = normalizeDigits(e.target.value).slice(0, 10);
                      setForm((p) => ({ ...p, phone: d }));
                      setPhoneError(d.length === 10 ? validateIndianMobileDigits(d) : null);
                    }}
                    onBlur={() =>
                      setPhoneError(
                        form.phone ? validateIndianMobileInteractive(normalizeDigits(form.phone)) : null,
                      )
                    }
                    placeholder="10-digit mobile (starts 6–9)"
                    aria-invalid={Boolean(phoneError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      phoneError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
                  {!phoneError && form.phone.length > 0 && form.phone.length < 10 && (
                    <p className="mt-1 text-xs text-slate-500">{form.phone.length}/10 digits</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value as any }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                  <p className="mt-0.5 text-xs text-slate-500">Used for avatar display on dashboard.</p>
                </div>
                {!isAdmin && (
                <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Employee code</label>
                  <input
                    type="text"
                    value={form.employeeCode}
                    onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value }))}
                    readOnly={!canEditOrgFields}
                    disabled={!canEditOrgFields}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  />
                  {!canEditOrgFields && (
                    <p className="mt-1 text-xs text-slate-500">View only. Super admin/Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Designation</label>
                  <div className="relative">
                    <input
                      type="text"
                      list="profile-designation-list"
                      value={form.designation}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDesignationAddPrompt(null);
                        const match = designations.find((d) => d.title.toLowerCase() === v.trim().toLowerCase());
                        setForm((p) => ({ ...p, designation: v, designationId: match ? match.id : "" }));
                      }}
                      onBlur={() => {
                        const v = form.designation.trim();
                        if (!v) return;
                        const match = designations.find((d) => d.title.toLowerCase() === v.toLowerCase());
                        if (!match) setDesignationAddPrompt(v);
                        else setDesignationAddPrompt(null);
                      }}
                      placeholder="Search or type new"
                      readOnly={!canEditOrgFields}
                      disabled={!canEditOrgFields}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                    />
                    <datalist id="profile-designation-list">
                      {designations.map((d) => (
                        <option key={d.id} value={d.title} />
                      ))}
                    </datalist>
                  </div>
                  {!canEditOrgFields && (
                    <p className="mt-1 text-xs text-slate-500">View only. Super admin/Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Department</label>
                  <select
                    value={form.departmentId}
                    disabled={!canEditOrgFields}
                    onChange={(e) => setForm((p) => ({ ...p, departmentId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  >
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.division_id ? ` (${divisions.find((x) => x.id === d.division_id)?.name ?? ""})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Division</label>
                  <select
                    value={form.divisionId}
                    disabled={!canEditOrgFields}
                    onChange={(e) => setForm((p) => ({ ...p, divisionId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  >
                    <option value="">Select division</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Shift</label>
                  <select
                    value={form.shiftId}
                    disabled={!canEditOrgFields}
                    onChange={(e) => setForm((p) => ({ ...p, shiftId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  >
                    <option value="">Select shift</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Aadhaar</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    value={form.aadhaar}
                    onChange={(e) => {
                      const d = normalizeDigits(e.target.value).slice(0, 12);
                      setForm((p) => ({ ...p, aadhaar: d }));
                      setAadhaarError(d.length === 12 ? validateAadhaarDigits(d) : null);
                    }}
                    placeholder="12 digits"
                    aria-invalid={Boolean(aadhaarError)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                      aadhaarError
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                    }`}
                  />
                  {aadhaarError && <p className="mt-1 text-xs text-red-600">{aadhaarError}</p>}
                  {!aadhaarError && form.aadhaar.length > 0 && form.aadhaar.length < 12 && (
                    <p className="mt-1 text-xs text-slate-500">{form.aadhaar.length}/12 digits</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">PAN</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={form.pan}
                    onChange={(e) => setForm((p) => ({ ...p, pan: normalizePanInput(e.target.value) }))}
                    placeholder="e.g. ABCDE1234F"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">UAN number</label>
                  <input
                    type="text"
                    value={form.uanNumber}
                    onChange={(e) => setForm((p) => ({ ...p, uanNumber: e.target.value }))}
                    readOnly={!canEditEmployment}
                    disabled={!canEditEmployment}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  />
                  {!canEditEmployment && (
                    <p className="mt-1 text-xs text-slate-500">View only. Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">PF number</label>
                  <input
                    type="text"
                    value={form.pfNumber}
                    onChange={(e) => setForm((p) => ({ ...p, pfNumber: e.target.value }))}
                    readOnly={!canEditOrgFields}
                    disabled={!canEditOrgFields}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  />
                  {!canEditOrgFields && (
                    <p className="mt-1 text-xs text-slate-500">View only. Super admin/Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">ESIC number</label>
                  <input
                    type="text"
                    value={form.esicNumber}
                    onChange={(e) => setForm((p) => ({ ...p, esicNumber: e.target.value }))}
                    readOnly={!canEditOrgFields}
                    disabled={!canEditOrgFields}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-600"
                  />
                  {!canEditOrgFields && (
                    <p className="mt-1 text-xs text-slate-500">View only. Super admin/Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of birth</label>
                  <DatePickerField
                    value={form.dateOfBirth}
                    onChange={(v) => setForm((p) => ({ ...p, dateOfBirth: v }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of joining</label>
                  <DatePickerField
                    value={form.dateOfJoining}
                    onChange={(v) => setForm((p) => ({ ...p, dateOfJoining: v }))}
                    disabled={!canEditOrgFields}
                    className="w-full"
                  />
                  {!canEditOrgFields && (
                    <p className="mt-1 text-xs text-slate-500">View only. Super admin/Admin/HR can edit in Employees.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">CTC (monthly)</label>
                  <input
                    type="text"
                    value={form.ctc != null ? String(form.ctc) : ""}
                    readOnly
                    disabled
                    placeholder="—"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  />
                  <p className="mt-0.5 text-xs text-slate-500">View only. Admin/HR can edit in Employees.</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <select
                    value={form.employmentStatus}
                    disabled={!canEditEmployment}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, employmentStatus: e.target.value as any }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50"
                  >
                    <option value="preboarding">Preboarding</option>
                    <option value="current">Current</option>
                    <option value="past">Past</option>
                  </select>
                  {!canEditEmployment && (
                    <p className="mt-1 text-xs text-slate-500">Only Admin/HR can change status.</p>
                  )}
                </div>
              </>
              )}

              </div>

              {!isAdmin && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Current address</h3>
                  <div className="mt-3 space-y-3">
                    <input
                      type="text"
                      placeholder="Address line 1"
                      value={form.currentAddressLine1}
                      onChange={(e) => setForm((p) => ({ ...p, currentAddressLine1: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      placeholder="Address line 2"
                      value={form.currentAddressLine2}
                      onChange={(e) => setForm((p) => ({ ...p, currentAddressLine2: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        type="text"
                        placeholder="City"
                        value={form.currentCity}
                        onChange={(e) => setForm((p) => ({ ...p, currentCity: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="State"
                        value={form.currentState}
                        onChange={(e) => setForm((p) => ({ ...p, currentState: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Country"
                        value={form.currentCountry}
                        onChange={(e) => setForm((p) => ({ ...p, currentCountry: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="PIN (6 digits)"
                        value={form.currentPostalCode}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            currentPostalCode: normalizeDigits(e.target.value).slice(0, 6),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Permanent address</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        placeholder="Address line 1"
                        value={form.permanentAddressLine1}
                        onChange={(e) => setForm((p) => ({ ...p, permanentAddressLine1: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Address line 2"
                        value={form.permanentAddressLine2}
                        onChange={(e) => setForm((p) => ({ ...p, permanentAddressLine2: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          placeholder="City"
                          value={form.permanentCity}
                          onChange={(e) => setForm((p) => ({ ...p, permanentCity: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="State"
                          value={form.permanentState}
                          onChange={(e) => setForm((p) => ({ ...p, permanentState: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="Country"
                          value={form.permanentCountry}
                          onChange={(e) => setForm((p) => ({ ...p, permanentCountry: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="PIN (6 digits)"
                          inputMode="numeric"
                          maxLength={6}
                          value={form.permanentPostalCode}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              permanentPostalCode: normalizeDigits(e.target.value).slice(0, 6),
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Emergency contact</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        placeholder="Name"
                        value={form.emergencyContactName}
                        onChange={(e) => setForm((p) => ({ ...p, emergencyContactName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile"
                        value={form.emergencyContactPhone}
                        onChange={(e) => {
                          const d = normalizeDigits(e.target.value).slice(0, 10);
                          setForm((p) => ({ ...p, emergencyContactPhone: d }));
                          setEmergencyPhoneError(d.length === 10 ? validateIndianMobileDigits(d) : null);
                        }}
                        onBlur={() =>
                          setEmergencyPhoneError(
                            form.emergencyContactPhone
                              ? validateIndianMobileInteractive(normalizeDigits(form.emergencyContactPhone))
                              : null,
                          )
                        }
                        aria-invalid={Boolean(emergencyPhoneError)}
                        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                          emergencyPhoneError
                            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                            : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                        }`}
                      />
                      {emergencyPhoneError && (
                        <p className="text-xs text-red-600">{emergencyPhoneError}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Bank details</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Account holder name must match your profile name. IFSC: 11 characters (e.g. SBIN0001234).
                    </p>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        placeholder="Bank name"
                        value={form.bankName}
                        onChange={(e) => {
                          setBankError(null);
                          setForm((p) => ({ ...p, bankName: e.target.value }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Account holder name (same as profile name)"
                        value={form.bankAccountHolderName}
                        onChange={(e) => {
                          setBankError(null);
                          setForm((p) => ({ ...p, bankAccountHolderName: e.target.value }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Account number (9–18 digits)"
                        value={form.bankAccountNumber}
                        onChange={(e) => {
                          setBankError(null);
                          setForm((p) => ({
                            ...p,
                            bankAccountNumber: normalizeDigits(e.target.value),
                          }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="IFSC"
                        maxLength={11}
                        value={form.bankIfsc}
                        onChange={(e) => {
                          setBankError(null);
                          setForm((p) => ({
                            ...p,
                            bankIfsc: normalizeIfscInput(e.target.value),
                          }));
                        }}
                        className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      {bankError && <p className="text-xs text-red-600">{bankError}</p>}
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          )}
        </form>

        {authProvider !== "google" && (
          <form onSubmit={handleChangePassword} className="card space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="mb-1 text-lg font-semibold text-slate-900">Change password</h2>
                <p className="muted text-sm">
                  {PASSWORD_COMPLEXITY_HINT} This applies to your next sign-in.
                </p>
              </div>
              <button type="submit" className="btn btn-primary shrink-0" disabled={passwordSaving || loading}>
                {passwordSaving ? "Updating…" : "Update password"}
              </button>
            </div>
            {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            {passwordSuccess && <p className="text-sm text-emerald-700">{passwordSuccess}</p>}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <PasswordField
                label="Current password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
              />
              <PasswordField
                label="New password"
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                onBlur={() => setNewPasswordTouched(true)}
                error={newPasswordError}
              />
              <PasswordField
                label="Confirm new password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
            </div>
          </form>
        )}
        </>
      )}

      {tab === "pay" && (
        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Payslips</h2>
          <p className="muted">Select month and year to view your salary slip. Available from your joining date.</p>

          <div className="mt-4">
            {payslipsLoading ? (
              <p className="muted">Loading...</p>
            ) : payslipsError ? (
              <p className="text-sm text-red-600">{payslipsError}</p>
            ) : !payslipsData ? (
              <p className="muted">Loading...</p>
            ) : (
              <>
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span className="text-slate-600">TDS (monthly from master):</span>{" "}
                  <span className="font-semibold">{myPayrollMaster?.tds != null ? Number(myPayrollMaster.tds).toLocaleString("en-IN") : "0"}</span>
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={String(m).padStart(2, "0")}>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {(() => {
                      const doj = payslipsData.user?.dateOfJoining;
                      const joinYear = doj ? parseInt(doj.slice(0, 4), 10) : new Date().getFullYear() - 2;
                      const currentYear = new Date().getFullYear();
                      const years = [];
                      for (let y = currentYear; y >= Math.max(joinYear, 2020); y--) years.push(y);
                      return years.map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ));
                    })()}
                  </select>
                  {payslipsData.payslips.some((p) => p.periodMonth === `${selectedYear}-${selectedMonth}`) && (
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(payslipsData.user?.name, selectedMonth, selectedYear)}
                      disabled={pdfDownloading}
                      className="btn btn-primary print:hidden"
                    >
                      {pdfDownloading ? "Generating..." : "Download PDF"}
                    </button>
                  )}
                </div>

                {(() => {
                  const key = `${selectedYear}-${selectedMonth}`;
                  const slip = payslipsData.payslips.find((p) => p.periodMonth === key);
                  const company = payslipsData.company;
                  const user = payslipsData.user;

                  if (!slip) {
                    return <p className="muted">No payslip for the selected period.</p>;
                  }

                  const salaryDate = fmtDmy(slip.generatedAt);
                  const dojFormatted = user?.dateOfJoining ? fmtDmy(user.dateOfJoining) : "—";

                  const n = (x: number) => (x ?? 0).toLocaleString("en-IN");
                  const totalPerf = slip.incentive + slip.prBonus + slip.reimbursement;
                  const salaryAfterDeductions = slip.grossPay - slip.deductions;
                  const takeHome = Math.round(
                    salaryAfterDeductions - slip.tds + slip.incentive + slip.prBonus + slip.reimbursement
                  );
                  const gov = slip.governmentMonthly;
                  if (gov) {
                    return (
                      <GovernmentPayslipPrint
                        ref={payslipRef}
                        company={company}
                        user={{
                          name: user?.name,
                          employeeCode: user?.employeeCode,
                          designation: user?.designation,
                          departmentName: user?.departmentName,
                          dateOfJoining: user?.dateOfJoining,
                          uanNumber: user?.uanNumber,
                          pfNumber: user?.pfNumber,
                        }}
                        slip={{
                          generatedAt: slip.generatedAt,
                          periodStart: slip.periodStart,
                          payDays: slip.payDays,
                          unpaidLeaves: slip.unpaidLeaves,
                          bankName: slip.bankName,
                          bankAccountNumber: slip.bankAccountNumber,
                          netPay: slip.netPay,
                        }}
                        gov={gov as GovernmentMonthlySlip}
                        leavePayslip={slip.leavePayslip ?? null}
                      />
                    );
                  }

                  const cellClass = "border border-black px-3 py-2 align-top text-sm";
                  const thClass = "border border-black px-3 py-2 text-left font-semibold text-sm";

                  return (
                    <div ref={payslipRef} className="payslip-print-area overflow-x-auto rounded-lg border border-black bg-white p-6 print:overflow-visible print:max-w-[190mm]" style={{ minWidth: "min(100%, 190mm)" }}>
                      <table className="payslip-header-table w-full border-collapse" style={{ border: "1px solid #000" }}>
                        <tbody>
                          <tr>
                            <td colSpan={2} className="border border-black px-4 py-4 text-center">
                              <div className="text-base font-bold text-slate-900">{company?.name || "Company"}</div>
                              {company?.address && (
                                <div className="mt-0.5 text-sm text-slate-600">{company.address}</div>
                              )}
                              <div className="mt-2 text-base font-bold uppercase tracking-wide">Salary Slip</div>
                              <div className="text-sm font-semibold">
                                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
                                  parseInt(selectedMonth, 10) - 1
                                ]}{" "}
                                {selectedYear}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className={`w-1/2 ${cellClass}`}>
                              <div className="space-y-1.5 text-sm leading-relaxed">
                                <div><span className="text-slate-600">Employee Name:</span> {user?.name || "—"}</div>
                                <div><span className="text-slate-600">Designation:</span> {user?.designation || "—"}</div>
                                <div><span className="text-slate-600">Department:</span> {user?.departmentName || "—"}</div>
                                <div><span className="text-slate-600">Salary Date:</span> {salaryDate}</div>
                              </div>
                            </td>
                            <td className={`w-1/2 ${cellClass}`}>
                              <div className="space-y-1.5 text-sm leading-relaxed">
                                <div><span className="text-slate-600">Joining Date:</span> {dojFormatted}</div>
                                <div><span className="text-slate-600">Aadhaar:</span> {user?.aadhaar || "—"}</div>
                                <div><span className="text-slate-600">PAN:</span> {user?.pan || "—"}</div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className={cellClass}>
                              <div className="space-y-1.5 text-sm leading-relaxed">
                                <div><span className="text-slate-600">Total Paid Days:</span> {slip.payDays}</div>
                                <div><span className="text-slate-600">Unpaid Leaves:</span> {slip.unpaidLeaves}</div>
                              </div>
                            </td>
                            <td className={cellClass}>
                              <div className="space-y-1.5 text-sm leading-relaxed">
                                <div><span className="text-slate-600">ESIC number:</span> {user?.esicNumber || "—"}</div>
                                <div><span className="text-slate-600">UAN number:</span> {user?.uanNumber || "—"}</div>
                                <div><span className="text-slate-600">PF number:</span> {user?.pfNumber || "—"}</div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={2} className="border border-black p-0">
                              <table className="payslip-financial-table w-full border-collapse text-sm">
                                  <>
                                <colgroup>
                                  <col />
                                  <col />
                                  <col />
                                  <col />
                                  <col />
                                  <col />
                                  <col />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th className={`${thClass} w-20`}>Earnings</th>
                                    <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Actual</th>
                                    <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Paid</th>
                                    <th className={`${thClass} w-24`}>Employee Deductions</th>
                                    <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Amount</th>
                                    <th className={`${thClass} w-24`}>Performance Earnings</th>
                                    <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className={cellClass}>Basic</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.basic)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.basic)}</td>
                                    <td className={cellClass}>Professional Tax</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.professionalTax)}</td>
                                    <td className={cellClass}>Bonus</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.prBonus)}</td>
                                  </tr>
                                  <tr>
                                    <td className={cellClass}>HRA</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.hra)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.hra)}</td>
                                    <td className={cellClass}>PF</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.pfEmployee)}</td>
                                    <td className={cellClass}>Incentive</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.incentive)}</td>
                                  </tr>
                                  <tr>
                                    <td className={cellClass}>Medical</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.medical)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.medical)}</td>
                                    <td className={cellClass}>ESIC</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.esicEmployee)}</td>
                                    <td className={cellClass}>Reimbursement</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.reimbursement)}</td>
                                  </tr>
                                  <tr>
                                    <td className={cellClass}>Trans</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.trans)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.trans)}</td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                  <tr>
                                    <td className={cellClass}>LTA</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.lta)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.lta)}</td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                  <tr>
                                    <td className={cellClass}>Personal</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.personal)}</td>
                                    <td className={`${cellClass} text-right`}>{n(slip.personal)}</td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                  <tr>
                                    <td className={`${cellClass} font-medium`}>GROSS</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(slip.grossPay)}</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(slip.grossPay)}</td>
                                    <td className={`${cellClass} font-medium`}>Total Deduction</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(slip.deductions)}</td>
                                    <td className={`${cellClass} font-medium`}>Total</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(totalPerf)}</td>
                                  </tr>
                                  <tr>
                                    <td className={`${cellClass} font-medium`}>Net Payable Salary</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(takeHome)}</td>
                                    <td className={`${cellClass} text-right font-medium`}>{n(takeHome)}</td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                  <tr>
                                    <td className={`${cellClass} font-bold`}>Net Pay</td>
                                    <td colSpan={5} className={cellClass}></td>
                                    <td className={`${cellClass} text-right font-bold`}>{n(takeHome)}</td>
                                  </tr>
                                  <tr>
                                    <td colSpan={3} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                  <tr>
                                    <td colSpan={3} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                    <td colSpan={2} className={cellClass}></td>
                                  </tr>
                                </tbody>
                                  </>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="card space-y-4">
          <div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Documents</h2>
            <p className="muted text-sm">Files you uploaded or signed during onboarding.</p>
          </div>
          {docsLoading && <p className="muted">Loading…</p>}
          {docsError && <p className="text-sm text-red-600">{docsError}</p>}
          {!docsLoading && !docsError && myDocuments.length === 0 && (
            <p className="muted">No documents on file yet.</p>
          )}
          {!docsLoading && myDocuments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-4 font-medium">Document</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">File / signature</th>
                    <th className="py-2 pr-4 font-medium">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {myDocuments.map((row) => (
                    <tr key={row.submission_id} className="border-b border-slate-100">
                      <td className="py-2 pr-4 align-top">{row.document_name}</td>
                      <td className="py-2 pr-4 align-top">
                        {row.kind === "digital_signature" ? "E-sign" : "Upload"}
                      </td>
                      <td className="py-2 pr-4 align-top">{row.status}</td>
                      <td className="py-2 pr-4 align-top">
                        {row.file_url ? (
                          <a href={row.file_url} target="_blank" rel="noreferrer" className="font-medium text-brand-blue underline hover:text-brand-navy">
                            Open file
                          </a>
                        ) : row.signature_name ? (
                          <span className="text-slate-600">Signed as {row.signature_name}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-4 align-top">
                        {row.kind === "upload" ? (
                          <input
                            type="file"
                            disabled={docBusyId === row.document_id}
                            className="block w-[220px] text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 disabled:opacity-50"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                setDocBusyId(row.document_id);
                                const publicUrl = await uploadToStorage(row.document_name, "upload", file, file.name);
                                const res = await fetch("/api/me/documents", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "submit_document", documentId: row.document_id, fileUrl: publicUrl }),
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data?.error || "Failed to submit document");
                                await refreshMyDocuments();
                              } catch (err: any) {
                                setDocsError(err?.message || "Failed to upload document");
                              } finally {
                                setDocBusyId(null);
                                (e.target as HTMLInputElement).value = "";
                              }
                            }}
                          />
                        ) : (
                          <form
                            className="flex items-center gap-2"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const fd = new FormData(e.currentTarget);
                              const signatureName = String(fd.get("signatureName") || "").trim();
                              if (!signatureName) return;
                              try {
                                setDocBusyId(row.document_id);
                                const receiptText = `Document: ${row.document_name}\nSigned by: ${signatureName}\nSigned at: ${new Date().toISOString()}\n`;
                                const blob = new Blob([receiptText], { type: "text/plain" });
                                let receiptUrl = "";
                                try {
                                  receiptUrl = await uploadToStorage(
                                    row.document_name,
                                    "digital_signature",
                                    blob,
                                    `${row.document_name}_SIGNATURE_RECEIPT.txt`
                                  );
                                } catch {
                                  receiptUrl = "";
                                }
                                const res = await fetch("/api/me/documents", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    action: "submit_document",
                                    documentId: row.document_id,
                                    signatureName,
                                    fileUrl: receiptUrl || undefined,
                                  }),
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data?.error || "Failed to sign document");
                                await refreshMyDocuments();
                                (e.currentTarget as HTMLFormElement).reset();
                              } catch (err: any) {
                                setDocsError(err?.message || "Failed to sign document");
                              } finally {
                                setDocBusyId(null);
                              }
                            }}
                          >
                            <input
                              name="signatureName"
                              placeholder="Your name"
                              disabled={docBusyId === row.document_id}
                              className="w-[140px] rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                            />
                            <button
                              type="submit"
                              disabled={docBusyId === row.document_id}
                              className="btn btn-outline !py-1.5 !text-sm"
                            >
                              {docBusyId === row.document_id ? "Signing..." : "Sign"}
                            </button>
                          </form>
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
    </section>
    </>
  );
}
