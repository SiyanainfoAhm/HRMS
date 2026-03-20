"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo, useState, FormEvent } from "react";

export function ProfileContent() {
  const { role } = useAuth();
  const params = useSearchParams();
  const tab = params.get("tab") || "profile";

  const canEditEmployment = useMemo(() => role === "super_admin" || role === "admin" || role === "hr", [role]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    employeeCode: "",
    phone: "",
    gender: "" as "" | "male" | "female" | "other",
    designation: "",
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
          name: u?.name ?? "",
          employeeCode: u?.employeeCode ?? "",
          phone: u?.phone ?? "",
          gender: (["male", "female", "other"].includes(u?.gender) ? u.gender : "") as "" | "male" | "female" | "other",
          designation: u?.designation ?? "",
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
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Profile</h1>
        <p className="muted">
          For employees this shows personal, bank and emergency contact information from
          HRMS_employees.
        </p>
      </div>

      <div className="flex gap-2">
        <Link
          href="/profile?tab=profile"
          className={`btn ${tab === "profile" ? "btn-primary" : "btn-outline"}`}
        >
          My Profile
        </Link>
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
      </div>

      {tab === "profile" && (
        <form onSubmit={handleSave} className="card space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">My details</h2>
              <p className="muted">These fields are stored in `HRMS_users` for custom auth.</p>
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

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                  <label className="mb-1 block text-sm font-medium text-slate-700">Employee code</label>
                  <input
                    type="text"
                    value={form.employeeCode}
                    onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value }))}
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
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Designation</label>
                  <input
                    type="text"
                    value={form.designation}
                    onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))}
                    placeholder="e.g. Software Engineer"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
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
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
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
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of joining</label>
                  <input
                    type="date"
                    value={form.dateOfJoining}
                    onChange={(e) => setForm((p) => ({ ...p, dateOfJoining: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
              </div>

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
                  const netPay = slip.netPay - slip.tds + totalPerf;

                  return (
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full border-collapse text-sm" style={{ border: "1px solid #1e293b" }}>
                        <tbody>
                          <tr>
                            <td colSpan={6} className="border border-slate-800 px-4 py-3 text-center">
                              <div className="font-bold text-slate-900">{company?.name || "Company"}</div>
                              {company?.address && (
                                <div className="text-xs text-slate-600">{company.address}</div>
                              )}
                              <div className="mt-2 font-bold uppercase tracking-wide">Salary Slip</div>
                              <div className="font-semibold">
                                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
                                  parseInt(selectedMonth, 10) - 1
                                ]}{" "}
                                {selectedYear}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className="w-1/2 border border-slate-800 px-3 py-2 align-top">
                              <div className="space-y-1">
                                <div><span className="text-slate-600">Employee Code:</span> {user?.employeeCode || "—"}</div>
                                <div><span className="text-slate-600">Employee Name:</span> {user?.name || "—"}</div>
                                <div><span className="text-slate-600">Designation:</span> {user?.designation || "—"}</div>
                                <div><span className="text-slate-600">Salary Date:</span> {salaryDate}</div>
                                <div><span className="text-slate-600">Total Paid Days:</span> {slip.payDays}</div>
                                <div><span className="text-slate-600">Unpaid Leaves:</span> {slip.unpaidLeaves}</div>
                              </div>
                            </td>
                            <td className="w-1/2 border border-slate-800 px-3 py-2 align-top">
                              <div className="space-y-1">
                                <div><span className="text-slate-600">Joining Date:</span> {dojFormatted}</div>
                                <div><span className="text-slate-600">Aadhaar:</span> {user?.aadhaar || "—"}</div>
                                <div><span className="text-slate-600">PAN:</span> {user?.pan || "—"}</div>
                                <div><span className="text-slate-600">ESIC number:</span> {user?.esicNumber || "—"}</div>
                                <div><span className="text-slate-600">UAN number:</span> {user?.uanNumber || "—"}</div>
                                <div><span className="text-slate-600">PF number:</span> {user?.pfNumber || "—"}</div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={2} className="border border-slate-800 p-0">
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="bg-slate-100">
                                    <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Earnings</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-right w-20">Actual</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-right w-20">Paid</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Employee Deductions</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-right w-20">Amount</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Performance Earnings</th>
                                    <th className="border border-slate-800 px-2 py-1.5 text-right w-20">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1">Basic & DA</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.basic)}</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.basic)}</td>
                                    <td className="border border-slate-800 px-2 py-1">Professional Tax</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.professionalTax)}</td>
                                    <td className="border border-slate-800 px-2 py-1">Performance Bonus</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.prBonus)}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1">HRA</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.hra)}</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.hra)}</td>
                                    <td className="border border-slate-800 px-2 py-1">PF</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.pfEmployee)}</td>
                                    <td className="border border-slate-800 px-2 py-1">Performance Incentive</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.incentive)}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1">Allowances</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.allowances)}</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.allowances)}</td>
                                    <td className="border border-slate-800 px-2 py-1">ESIC</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.esicEmployee)}</td>
                                    <td className="border border-slate-800 px-2 py-1">Reimbursement</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.reimbursement)}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1 font-medium">GROSS</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(slip.grossPay)}</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(slip.grossPay)}</td>
                                    <td className="border border-slate-800 px-2 py-1">TDS</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right">{n(slip.tds)}</td>
                                    <td className="border border-slate-800 px-2 py-1 font-medium">Total</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(totalPerf)}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1 font-medium">Net Payable Salary</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(netPay)}</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(netPay)}</td>
                                    <td className="border border-slate-800 px-2 py-1 font-medium">Total Deduction</td>
                                    <td className="border border-slate-800 px-2 py-1 text-right font-medium">{n(slip.deductions)}</td>
                                    <td colSpan={2} className="border border-slate-800 px-2 py-1"></td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-800 px-2 py-1 font-bold">Net Pay</td>
                                    <td colSpan={2} className="border border-slate-800 px-2 py-1 text-right font-bold">{n(netPay)}</td>
                                    <td colSpan={4} className="border border-slate-800 px-2 py-1"></td>
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
  );
}
