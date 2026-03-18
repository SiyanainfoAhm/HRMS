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
  });

  const [payslips, setPayslips] = useState<
    {
      id: string;
      payslipNumber: string | null;
      generatedAt: string;
      currency: string;
      netPay: any;
      grossPay: any;
      bankName: string;
      bankAccountNumber: string;
      bankIfsc: string;
    }[]
  >([]);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);

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
        });
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
        if (!cancelled) setPayslips(data.payslips || []);
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
          <p className="muted">Each payslip shows the bank snapshot used for that payroll run.</p>

          <div className="mt-4">
            {payslipsLoading ? (
              <p className="muted">Loading...</p>
            ) : payslipsError ? (
              <p className="text-sm text-red-600">{payslipsError}</p>
            ) : payslips.length === 0 ? (
              <p className="muted">No payslips yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Payslip #</th>
                      <th className="px-3 py-2">Generated</th>
                      <th className="px-3 py-2">Gross</th>
                      <th className="px-3 py-2">Net</th>
                      <th className="px-3 py-2">Bank</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">IFSC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((p) => (
                      <tr key={p.id} className="border-t border-slate-200">
                        <td className="px-3 py-2">{p.payslipNumber || "-"}</td>
                        <td className="px-3 py-2">{new Date(p.generatedAt).toLocaleDateString()}</td>
                        <td className="px-3 py-2">
                          {p.currency} {p.grossPay}
                        </td>
                        <td className="px-3 py-2">
                          {p.currency} {p.netPay}
                        </td>
                        <td className="px-3 py-2">{p.bankName || "-"}</td>
                        <td className="px-3 py-2">{p.bankAccountNumber || "-"}</td>
                        <td className="px-3 py-2">{p.bankIfsc || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
