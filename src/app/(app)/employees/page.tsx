"use client";

import { useEffect, useState, FormEvent } from "react";
import { useToast } from "@/components/ToastProvider";

type Employee = {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "admin" | "hr" | "manager" | "employee";
  employmentStatus: "preboarding" | "current" | "past";
  employeeCode: string;
  phone: string;
  dateOfJoining: string;
  createdAt: string;
};

export default function EmployeesPage() {
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Employee["role"]>("employee");
  const [employmentStatus, setEmploymentStatus] = useState<Employee["employmentStatus"]>("preboarding");
  const [employeeCode, setEmployeeCode] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [currentAddressLine1, setCurrentAddressLine1] = useState("");
  const [currentAddressLine2, setCurrentAddressLine2] = useState("");
  const [currentCity, setCurrentCity] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [currentCountry, setCurrentCountry] = useState("");
  const [currentPostalCode, setCurrentPostalCode] = useState("");
  const [permanentAddressLine1, setPermanentAddressLine1] = useState("");
  const [permanentAddressLine2, setPermanentAddressLine2] = useState("");
  const [permanentCity, setPermanentCity] = useState("");
  const [permanentState, setPermanentState] = useState("");
  const [permanentCountry, setPermanentCountry] = useState("");
  const [permanentPostalCode, setPermanentPostalCode] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<Employee["employmentStatus"]>("preboarding");
  const [docs, setDocs] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocKind, setNewDocKind] = useState<"upload" | "digital_signature">("upload");
  const [newDocMandatory, setNewDocMandatory] = useState(true);
  const [newDocContent, setNewDocContent] = useState("");
  const [creatingDoc, setCreatingDoc] = useState(false);

  const [companyDocs, setCompanyDocs] = useState<any[]>([]);
  const [docsForInviteLoading, setDocsForInviteLoading] = useState(false);
  const [requestedDocIds, setRequestedDocIds] = useState<string[]>([]);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<any>(null);

  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendTarget, setResendTarget] = useState<Employee | null>(null);
  const [resendDocIds, setResendDocIds] = useState<string[]>([]);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/employees");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load employees");
        if (!cancelled) setEmployees(data.employees);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load employees");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsDialogOpen(false);
    }
    if (isDialogOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDialogOpen]);

  function resetForm() {
    setFormError(null);
    setName("");
    setEmail("");
    setRole("employee");
    setEmploymentStatus("preboarding");
    setEmployeeCode("");
    setPhone("");
    setDateOfJoining("");
    setCurrentAddressLine1("");
    setCurrentAddressLine2("");
    setCurrentCity("");
    setCurrentState("");
    setCurrentCountry("");
    setCurrentPostalCode("");
    setPermanentAddressLine1("");
    setPermanentAddressLine2("");
    setPermanentCity("");
    setPermanentState("");
    setPermanentCountry("");
    setPermanentPostalCode("");
    setEmergencyContactName("");
    setEmergencyContactPhone("");
    setBankName("");
    setBankAccountNumber("");
    setBankIfsc("");
    setPassword("");
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          role,
          employmentStatus,
          employeeCode: employeeCode.trim() || undefined,
          phone: phone.trim() || undefined,
          dateOfJoining: dateOfJoining || undefined,
          currentAddressLine1: currentAddressLine1.trim() || undefined,
          currentAddressLine2: currentAddressLine2.trim() || undefined,
          currentCity: currentCity.trim() || undefined,
          currentState: currentState.trim() || undefined,
          currentCountry: currentCountry.trim() || undefined,
          currentPostalCode: currentPostalCode.trim() || undefined,
          permanentAddressLine1: permanentAddressLine1.trim() || undefined,
          permanentAddressLine2: permanentAddressLine2.trim() || undefined,
          permanentCity: permanentCity.trim() || undefined,
          permanentState: permanentState.trim() || undefined,
          permanentCountry: permanentCountry.trim() || undefined,
          permanentPostalCode: permanentPostalCode.trim() || undefined,
          emergencyContactName: emergencyContactName.trim() || undefined,
          emergencyContactPhone: emergencyContactPhone.trim() || undefined,
          bankName: bankName.trim() || undefined,
          bankAccountNumber: bankAccountNumber.trim() || undefined,
          bankIfsc: bankIfsc.trim() || undefined,
          password: password.trim() || undefined,
          requestedDocumentIds: requestedDocIds.length ? requestedDocIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error || "Failed to add employee");
        setFormLoading(false);
        return;
      }
      setEmployees((prev) => [data.employee, ...prev]);
      if (data.inviteUrl) {
        const link = String(data.inviteUrl);
        try {
          await navigator.clipboard.writeText(link);
          showToast("success", "Invite link copied to clipboard (valid 48 hours)");
        } catch {
          showToast("success", "Employee added. Invite link generated.");
        }
      }
      resetForm();
      setRequestedDocIds([]);
      setIsDialogOpen(false);
    } catch {
      setFormError("Failed to add employee");
    } finally {
      setFormLoading(false);
    }
  }

  async function loadDocuments() {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/company/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load documents");
      setDocs(data.documents || []);
    } catch (e: any) {
      setDocsError(e?.message || "Failed to load documents");
    } finally {
      setDocsLoading(false);
    }
  }

  async function loadCompanyDocsForInvite(): Promise<any[]> {
    setDocsForInviteLoading(true);
    try {
      const res = await fetch("/api/company/documents");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load documents");
      const docs = data.documents || [];
      setCompanyDocs(docs);
      setRequestedDocIds(docs.filter((d: any) => d.is_mandatory).map((d: any) => d.id));
      return docs;
    } catch {
      setCompanyDocs([]);
      setRequestedDocIds([]);
      return [];
    } finally {
      setDocsForInviteLoading(false);
    }
  }

  async function openDetails(employeeId: string) {
    setDetailsDialogOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsData(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/onboarding`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load details");
      setDetailsData(data);
    } catch (e: any) {
      setDetailsError(e?.message || "Failed to load details");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function resendInvite(emp: Employee) {
    setResendTarget(emp);
    // Always refresh company documents for resend dialog
    const docs = await loadCompanyDocsForInvite();

    // Default: mandatory docs (or none if company has no docs)
    const mandatory = (docs || []).filter((d: any) => d.is_mandatory).map((d: any) => d.id);
    setResendDocIds(mandatory.length ? mandatory : []);
    setResendDialogOpen(true);
  }

  async function convertToCurrent(emp: Employee) {
    try {
      setError(null);
      const res = await fetch("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert_to_current", userId: emp.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to convert");
      const refreshed = await fetch("/api/employees");
      const refreshedData = await refreshed.json();
      if (refreshed.ok) setEmployees(refreshedData.employees);
      showToast("success", "Employee moved to Current");
    } catch (e: any) {
      showToast("error", e?.message || "Failed to convert");
    }
  }

  async function createDocument(e: FormEvent) {
    e.preventDefault();
    setCreatingDoc(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/company/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDocName.trim(),
          kind: newDocKind,
          isMandatory: Boolean(newDocMandatory),
          contentText: newDocKind === "digital_signature" ? newDocContent : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create document");
      setNewDocName("");
      setNewDocKind("upload");
      setNewDocMandatory(true);
      setNewDocContent("");
      await loadDocuments();
    } catch (e: any) {
      setDocsError(e?.message || "Failed to create document");
    } finally {
      setCreatingDoc(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employees</h1>
        <p className="muted">Manage employees for your company.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("preboarding")}
          className={`btn ${activeTab === "preboarding" ? "btn-primary" : "btn-outline"}`}
        >
          Preboarding
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("current")}
          className={`btn ${activeTab === "current" ? "btn-primary" : "btn-outline"}`}
        >
          Current
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("past")}
          className={`btn ${activeTab === "past" ? "btn-primary" : "btn-outline"}`}
        >
          Past
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setDocsDialogOpen(true);
            loadDocuments();
          }}
        >
          Company documents
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            resetForm();
            loadCompanyDocsForInvite();
            setIsDialogOpen(true);
          }}
        >
          Add employee
        </button>
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => setIsDialogOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add employee</h2>
                <p className="text-sm text-slate-500">Create an employee in your company directory.</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setIsDialogOpen(false)}>
                Close
              </button>
            </div>

            <form onSubmit={handleCreate} className="max-h-[75vh] overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Employee["role"])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                  <select
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value as Employee["employmentStatus"])}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="preboarding">Preboarding</option>
                    <option value="current">Current</option>
                    <option value="past">Past</option>
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Employee code</label>
                  <input
                    type="text"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date of joining</label>
                  <input
                    type="date"
                    value={dateOfJoining}
                    onChange={(e) => setDateOfJoining(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="md:col-span-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Current address</h3>
                      <div className="mt-3 space-y-3">
                        <input
                          type="text"
                          placeholder="Address line 1"
                          value={currentAddressLine1}
                          onChange={(e) => setCurrentAddressLine1(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="Address line 2"
                          value={currentAddressLine2}
                          onChange={(e) => setCurrentAddressLine2(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            placeholder="City"
                            value={currentCity}
                            onChange={(e) => setCurrentCity(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="State"
                            value={currentState}
                            onChange={(e) => setCurrentState(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="Country"
                            value={currentCountry}
                            onChange={(e) => setCurrentCountry(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="Postal code"
                            value={currentPostalCode}
                            onChange={(e) => setCurrentPostalCode(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Permanent address</h3>
                      <div className="mt-3 space-y-3">
                        <input
                          type="text"
                          placeholder="Address line 1"
                          value={permanentAddressLine1}
                          onChange={(e) => setPermanentAddressLine1(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          placeholder="Address line 2"
                          value={permanentAddressLine2}
                          onChange={(e) => setPermanentAddressLine2(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            placeholder="City"
                            value={permanentCity}
                            onChange={(e) => setPermanentCity(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="State"
                            value={permanentState}
                            onChange={(e) => setPermanentState(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="Country"
                            value={permanentCountry}
                            onChange={(e) => setPermanentCountry(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="Postal code"
                            value={permanentPostalCode}
                            onChange={(e) => setPermanentPostalCode(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Emergency contact name</label>
                      <input
                        type="text"
                        value={emergencyContactName}
                        onChange={(e) => setEmergencyContactName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Emergency contact phone</label>
                      <input
                        type="text"
                        value={emergencyContactPhone}
                        onChange={(e) => setEmergencyContactPhone(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Bank name</label>
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Account number</label>
                      <input
                        type="text"
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">IFSC</label>
                      <input
                        type="text"
                        value={bankIfsc}
                        onChange={(e) => setBankIfsc(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Temp password (optional)</label>
                      <input
                        type="text"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Generate automatically if empty"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Documents to request (sent in invite)</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Select which company documents this employee must complete. Link is valid for 48 hours.
                    </p>
                    {docsForInviteLoading ? (
                      <p className="muted mt-2">Loading documents...</p>
                    ) : companyDocs.length === 0 ? (
                      <p className="muted mt-2">No company documents configured. Add them from “Company documents”.</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {companyDocs.map((d: any) => (
                          <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={requestedDocIds.includes(d.id)}
                              onChange={(e) => {
                                setRequestedDocIds((prev) => {
                                  if (e.target.checked) return Array.from(new Set([...prev, d.id]));
                                  return prev.filter((x) => x !== d.id);
                                });
                              }}
                            />
                            <span>
                              {d.name} <span className="text-slate-500">({d.kind}{d.is_mandatory ? ", mandatory" : ""})</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-4">
                  {formError && <p className="text-sm text-red-600">{formError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        resetForm();
                        setIsDialogOpen(false);
                      }}
                      disabled={formLoading}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={formLoading}>
                      {formLoading ? "Adding..." : "Add employee"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {docsDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setDocsDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Company documents</h2>
                <p className="text-sm text-slate-500">Define mandatory onboarding documents (upload or digital signature).</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setDocsDialogOpen(false)}>
                Close
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-6">
              <form onSubmit={createDocument} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Document name</label>
                  <input
                    type="text"
                    required
                    value={newDocName}
                    onChange={(e) => setNewDocName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Offer Letter / ID Proof / NDA"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
                  <select
                    value={newDocKind}
                    onChange={(e) => setNewDocKind(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="upload">Upload</option>
                    <option value="digital_signature">Digital signature</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex items-end">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={newDocMandatory} onChange={(e) => setNewDocMandatory(e.target.checked)} />
                    Mandatory
                  </label>
                </div>
                {newDocKind === "digital_signature" && (
                  <div className="md:col-span-4">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Document text</label>
                    <textarea
                      value={newDocContent}
                      onChange={(e) => setNewDocContent(e.target.value)}
                      className="w-full min-h-[120px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Paste document text for signature (offer letter / NDA terms)."
                    />
                  </div>
                )}
                <div className="md:col-span-4">
                  {docsError && <p className="text-sm text-red-600">{docsError}</p>}
                  <button type="submit" className="btn btn-primary" disabled={creatingDoc}>
                    {creatingDoc ? "Saving..." : "Add document"}
                  </button>
                </div>
              </form>

              <div className="card">
                <h3 className="text-base font-semibold text-slate-900">Existing documents</h3>
                {docsLoading ? (
                  <p className="muted mt-2">Loading...</p>
                ) : docs.length === 0 ? (
                  <p className="muted mt-2">No documents configured yet.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Mandatory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => (
                          <tr key={d.id} className="border-t border-slate-200">
                            <td className="px-3 py-2">{d.name}</td>
                            <td className="px-3 py-2">{d.kind}</td>
                            <td className="px-3 py-2">{d.is_mandatory ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : employees.filter((e) => e.employmentStatus === activeTab).length === 0 ? (
          <p className="muted">No employees yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                  {activeTab === "preboarding" && <th className="px-3 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {employees
                  .filter((e) => e.employmentStatus === activeTab)
                  .map((e) => (
                  <tr key={e.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">{e.name || "-"}</td>
                    <td className="px-3 py-2">{e.email}</td>
                    <td className="px-3 py-2">{e.employeeCode || "-"}</td>
                    <td className="px-3 py-2">{e.phone || "-"}</td>
                    <td className="px-3 py-2">{e.role.replace("_", " ")}</td>
                    <td className="px-3 py-2">{e.employmentStatus}</td>
                    <td className="px-3 py-2">{new Date(e.createdAt).toLocaleDateString()}</td>
                    {activeTab === "preboarding" && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn btn-outline" onClick={() => openDetails(e.id)} title="View">
                            👁
                          </button>
                          <button type="button" className="btn btn-outline" onClick={() => resendInvite(e)} title="Send documents again">
                            📩
                          </button>
                          <button type="button" className="btn btn-primary" onClick={() => convertToCurrent(e)} title="Convert to current">
                            ✅
                          </button>
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

      {detailsDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setDetailsDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Preboarding details</h2>
                <p className="text-sm text-slate-500">Employee info + submitted documents</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setDetailsDialogOpen(false)}>
                Close
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5">
              {detailsLoading ? (
                <p className="muted">Loading...</p>
              ) : detailsError ? (
                <p className="text-sm text-red-600">{detailsError}</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="card">
                      <h3 className="text-base font-semibold text-slate-900">Employee</h3>
                      <div className="mt-2 text-sm text-slate-700 space-y-1">
                        <div>
                          <span className="text-slate-500">Name:</span> {detailsData?.employee?.name || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Email:</span> {detailsData?.employee?.email || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Phone:</span> {detailsData?.employee?.phone || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">DOJ:</span> {detailsData?.employee?.date_of_joining || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Current address:</span> {detailsData?.employee?.current_address_line1 || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Bank:</span> {detailsData?.employee?.bank_account_number ? "Provided" : "-"}
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="text-base font-semibold text-slate-900">Invite</h3>
                      <div className="mt-2 text-sm text-slate-700 space-y-1">
                        <div>
                          <span className="text-slate-500">Status:</span> {detailsData?.invite?.status || "-"}
                        </div>
                        <div>
                          <span className="text-slate-500">Expires:</span> {detailsData?.invite?.expires_at ? new Date(detailsData.invite.expires_at).toLocaleString() : "-"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card mt-4">
                    <h3 className="text-base font-semibold text-slate-900">Documents</h3>
                    {(!detailsData?.documents || detailsData.documents.length === 0) ? (
                      <p className="muted mt-2">No documents requested.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Name</th>
                              <th className="px-3 py-2">Type</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">File / Signature</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailsData.documents.map((d: any) => {
                              const sub = (detailsData.submissions || []).find((s: any) => s.document_id === d.id);
                              return (
                                <tr key={d.id} className="border-t border-slate-200">
                                  <td className="px-3 py-2">{d.name}</td>
                                  <td className="px-3 py-2">{d.kind}</td>
                                  <td className="px-3 py-2">{sub?.status || "pending"}</td>
                                  <td className="px-3 py-2">
                                    {sub?.file_url ? (
                                      <a className="text-emerald-700 underline" href={sub.file_url} target="_blank" rel="noreferrer">
                                        View file
                                      </a>
                                    ) : sub?.signature_name ? (
                                      <span>Signed by {sub.signature_name}</span>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {resendDialogOpen && resendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setResendDialogOpen(false)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Send documents again</h2>
              <p className="text-sm text-slate-500">
                Select documents to request for <span className="font-medium">{resendTarget.email}</span>. Link will be valid for 48 hours.
              </p>
            </div>
            <div className="p-5 space-y-4">
              {companyDocs.length === 0 ? (
                <p className="muted">No company documents configured. Add them from “Company documents”.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {companyDocs.map((d: any) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={resendDocIds.includes(d.id)}
                        onChange={(e) => {
                          setResendDocIds((prev) => {
                            if (e.target.checked) return Array.from(new Set([...prev, d.id]));
                            return prev.filter((x) => x !== d.id);
                          });
                        }}
                      />
                      <span>
                        {d.name} <span className="text-slate-500">({d.kind}{d.is_mandatory ? ", mandatory" : ""})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-outline" onClick={() => setResendDialogOpen(false)} disabled={resending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={resending}
                  onClick={async () => {
                    if (!resendTarget) return;
                    setResending(true);
                    try {
                      const res = await fetch("/api/invites", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          email: resendTarget.email,
                          userId: resendTarget.id,
                          requestedDocumentIds: resendDocIds,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error || "Failed to resend invite");
                      const link = `${window.location.origin}/invite/${data.invite.token}`;
                      try {
                        await navigator.clipboard.writeText(link);
                        showToast("success", "Invite link copied to clipboard (valid 48 hours)");
                      } catch {
                        // ignore clipboard errors
                        showToast("success", "Invite link generated (valid 48 hours)");
                      }
                      setResendDialogOpen(false);
                    } catch (e: any) {
                      setError(e?.message || "Failed to resend invite");
                      showToast("error", e?.message || "Failed to resend invite");
                    } finally {
                      setResending(false);
                    }
                  }}
                >
                  {resending ? "Sending..." : "Send link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

