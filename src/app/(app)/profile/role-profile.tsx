"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo, useState, useRef, FormEvent } from "react";
import { DatePickerField } from "@/components/ui/DatePickerField";

export function ProfileContent() {
  const { role } = useAuth();
  const params = useSearchParams();
  const tab = params.get("tab") || "profile";

  const canEditEmployment = useMemo(() => role === "admin" || role === "hr", [role]);
  const isSuperAdmin = role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    bankAccountNumber: "",
    bankIfsc: "",
    employmentStatus: "preboarding" as "preboarding" | "current" | "past",
    ctc: null as number | null,
  });

  const [payslipsData, setPayslipsData] = useState<{
    company: { name: string; address: string } | null;
    user: { name: string; employeeCode: string; designation: string; dateOfJoining: string; aadhaar: string; pan: string; uanNumber: string; pfNumber: string; esicNumber: string } | null;
    payslips: {
      id: string;
      periodMonth: string;
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
    }[];
  } | null>(null);
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
        setForm({
          email: u?.email ?? "",
          name: u?.name ?? "",
          employeeCode: u?.employeeCode ?? "",
          phone: u?.phone ?? "",
          gender: (["male", "female", "other"].includes(u?.gender) ? u.gender : "") as "" | "male" | "female" | "other",
          designation: u?.designation ?? "",
          designationId: u?.designationId ?? "",
          departmentId: u?.departmentId ?? "",
          divisionId: u?.divisionId ?? "",
          shiftId: u?.shiftId ?? "",
          aadhaar: u?.aadhaar ?? "",
          pan: u?.pan ?? "",
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
          currentPostalCode: u?.currentPostalCode ?? "",
          permanentAddressLine1: u?.permanentAddressLine1 ?? "",
          permanentAddressLine2: u?.permanentAddressLine2 ?? "",
          permanentCity: u?.permanentCity ?? "",
          permanentState: u?.permanentState ?? "",
          permanentCountry: u?.permanentCountry ?? "",
          permanentPostalCode: u?.permanentPostalCode ?? "",
          emergencyContactName: u?.emergencyContactName ?? "",
          emergencyContactPhone: u?.emergencyContactPhone ?? "",
          bankName: u?.bankName ?? "",
          bankAccountNumber: u?.bankAccountNumber ?? "",
          bankIfsc: u?.bankIfsc ?? "",
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
    if (tab !== "profile" || isSuperAdmin) return;
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
  }, [tab, isSuperAdmin]);

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
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save profile");
      setSuccess("Saved");
    } catch (e: any) {
      setError(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Profile</h1>
        <p className="muted">
          {isSuperAdmin
            ? "You are the master admin. Manage companies and edit company details—employee fields do not apply to you."
            : "For employees this shows personal, bank and emergency contact information."}
        </p>
      </div>

      <div className="flex gap-2">
        <Link
          href="/profile?tab=profile"
          className={`btn ${tab === "profile" ? "btn-primary" : "btn-outline"}`}
        >
          My Profile
        </Link>
        {!isSuperAdmin && (
          <>
            <Link
              href="/profile?tab=pay"
              className={`btn ${tab === "pay" ? "btn-primary" : "btn-outline"}`}
            >
              My Pay
            </Link>
            <Link
              href="/profile?tab=documents"
              className={`btn ${tab === "documents" ? "btn-primary" : "btn-outline"}`}
            >
              My Documents
            </Link>
          </>
        )}
      </div>

      {tab === "profile" && (
        <form onSubmit={handleSave} className="card space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                {isSuperAdmin ? "Account details" : "My details"}
              </h2>
              <p className="muted">
                {isSuperAdmin
                  ? "Basic account info. You manage companies from the Companies section."
                  : "These fields are stored in `HRMS_users` for custom auth."}
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

              <div className={`grid grid-cols-1 gap-4 ${isSuperAdmin ? "md:grid-cols-3" : "md:grid-cols-3"}`}>
                {isSuperAdmin && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    readOnly
                    disabled
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  />
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
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
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
                {!isSuperAdmin && (
                <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Employee code</label>
                  <input
                    type="text"
                    value={form.employeeCode}
                    onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
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
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <datalist id="profile-designation-list">
                      {designations.map((d) => (
                        <option key={d.id} value={d.title} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Department</label>
                  <select
                    value={form.departmentId}
                    onChange={(e) => setForm((p) => ({ ...p, departmentId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    onChange={(e) => setForm((p) => ({ ...p, divisionId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    onChange={(e) => setForm((p) => ({ ...p, shiftId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    value={form.aadhaar}
                    onChange={(e) => setForm((p) => ({ ...p, aadhaar: e.target.value }))}
                    placeholder="12-digit Aadhaar"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">PAN</label>
                  <input
                    type="text"
                    value={form.pan}
                    onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value }))}
                    placeholder="e.g. ABCD1234E"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">ESIC number</label>
                  <input
                    type="text"
                    value={form.esicNumber}
                    onChange={(e) => setForm((p) => ({ ...p, esicNumber: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
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
                    className="w-full"
                  />
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

              {!isSuperAdmin && (
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
                        placeholder="Postal code"
                        value={form.currentPostalCode}
                        onChange={(e) => setForm((p) => ({ ...p, currentPostalCode: e.target.value }))}
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
                          placeholder="Postal code"
                          value={form.permanentPostalCode}
                          onChange={(e) => setForm((p) => ({ ...p, permanentPostalCode: e.target.value }))}
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
                        type="text"
                        placeholder="Phone"
                        value={form.emergencyContactPhone}
                        onChange={(e) => setForm((p) => ({ ...p, emergencyContactPhone: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Bank details</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        placeholder="Bank name"
                        value={form.bankName}
                        onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Account number"
                        value={form.bankAccountNumber}
                        onChange={(e) => setForm((p) => ({ ...p, bankAccountNumber: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="IFSC"
                        value={form.bankIfsc}
                        onChange={(e) => setForm((p) => ({ ...p, bankIfsc: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          )}
        </form>
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

                  const salaryDate = new Date(slip.generatedAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  });
                  const dojFormatted = user?.dateOfJoining
                    ? new Date(user.dateOfJoining + "T12:00:00").toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—";

                  const n = (x: number) => (x ?? 0).toLocaleString("en-IN");
                  const totalPerf = slip.incentive + slip.prBonus + slip.reimbursement;
                  const salaryAfterDeductions = slip.grossPay - slip.deductions;
                  const takeHome = Math.round(
                    salaryAfterDeductions - slip.tds + slip.incentive + slip.prBonus + slip.reimbursement
                  );

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
        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Documents</h2>
          <p className="muted">
            Store uploaded documents and reference them from an extra table; this page gives
            employees a way to view their own records.
          </p>
        </div>
      )}
    </section>
    </>
  );
}
