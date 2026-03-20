"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";

export function ApprovalsContent() {
  const { role } = useAuth();
  const { showToast } = useToast();
  const params = useSearchParams();
  const tab = params.get("tab") || "leave";

  const canApprove = useMemo(
    () => role === "super_admin" || role === "admin" || role === "hr",
    [role]
  );

  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [typeRows, setTypeRows] = useState<any[]>([]);
  const [requests, setRequests] = useState<
    {
      id: string;
      leaveTypeId: string;
      leaveTypeName: string;
      startDate: string;
      endDate: string;
      totalDays: any;
      reason: string | null;
      status: string;
      createdAt: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [currentEmployees, setCurrentEmployees] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<null | { id: string; reason: string }>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [balancePreview, setBalancePreview] = useState<{ paidDays: number; unpaidDays: number } | null>(null);

  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeIsPaid, setNewTypeIsPaid] = useState(true);
  const [newAccrualMethod, setNewAccrualMethod] = useState<"monthly" | "annual" | "none">("monthly");
  const [newMonthlyRate, setNewMonthlyRate] = useState("1");
  const [newAnnualQuota, setNewAnnualQuota] = useState("12");
  const [newProrateOnJoin, setNewProrateOnJoin] = useState(true);
  const [creatingType, setCreatingType] = useState(false);

  const [editPolicyFor, setEditPolicyFor] = useState<null | { leaveTypeId: string; name: string }>(null);
  const [editAccrualMethod, setEditAccrualMethod] = useState<"monthly" | "annual" | "none">("monthly");
  const [editMonthlyRate, setEditMonthlyRate] = useState("1");
  const [editAnnualQuota, setEditAnnualQuota] = useState("12");
  const [editProrateOnJoin, setEditProrateOnJoin] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  function diffDaysInclusive(start: string, end: string): number {
    if (!start || !end) return 0;
    const s = new Date(start + "T00:00:00Z").getTime();
    const e = new Date(end + "T00:00:00Z").getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
    return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
  }

  const selectedLeaveType = typeRows.find((t: any) => t.id === leaveTypeId);
  const totalDays = diffDaysInclusive(startDate, endDate);

  useEffect(() => {
    if (tab !== "leave") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [typesRes, reqRes] = await Promise.all([fetch("/api/leave/types"), fetch("/api/leave/requests")]);
        const typesData = await typesRes.json();
        const reqData = await reqRes.json();
        if (!typesRes.ok) throw new Error(typesData?.error || "Failed to load leave types");
        if (!reqRes.ok) throw new Error(reqData?.error || "Failed to load leave requests");
        if (cancelled) return;
        setTypeRows(typesData.types || []);
        setTypes((typesData.types || []).map((t: any) => ({ id: t.id, name: t.name })));
        setRequests(reqData.requests || []);
        if (!leaveTypeId && (typesData.types || []).length) setLeaveTypeId(typesData.types[0].id);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load leave data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!leaveDialogOpen || !canApprove) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/employees");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load employees");
        if (cancelled) return;
        const current = (data.employees || []).filter((e: any) => e.employmentStatus === "current");
        setCurrentEmployees(current.map((e: any) => ({ id: e.id, name: e.name, email: e.email })));
        if (!selectedEmployeeId && current.length) setSelectedEmployeeId(current[0].id);
      } catch {
        if (!cancelled) setCurrentEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leaveDialogOpen, canApprove]);

  useEffect(() => {
    if (!leaveDialogOpen || totalDays <= 0) {
      setBalancePreview(null);
      return;
    }
    if (canApprove && !selectedEmployeeId) {
      setBalancePreview(null);
      return;
    }
    const userId = canApprove ? selectedEmployeeId : undefined;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (leaveTypeId) params.set("leaveTypeId", leaveTypeId);
        if (startDate) params.set("asOf", startDate);
        if (userId) params.set("userId", userId);
        const res = await fetch(`/api/leave/balance?${params.toString()}`);
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const bal = Array.isArray(data.balances) ? data.balances[0] : null;
        if (!selectedLeaveType) {
          setBalancePreview(null);
          return;
        }
        if (selectedLeaveType.is_paid === false) {
          setBalancePreview({ paidDays: 0, unpaidDays: totalDays });
          return;
        }
        const remaining = bal?.remaining;
        const paid = remaining == null ? totalDays : Math.min(totalDays, Math.max(0, remaining));
        const unpaid = totalDays - paid;
        setBalancePreview({ paidDays: paid, unpaidDays: unpaid });
      } catch {
        if (!cancelled) setBalancePreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leaveDialogOpen, totalDays, leaveTypeId, startDate, selectedEmployeeId, canApprove, selectedLeaveType]);

  async function refreshLeaveData() {
    const [typesRes, reqRes] = await Promise.all([fetch("/api/leave/types"), fetch("/api/leave/requests")]);
    const typesData = await typesRes.json();
    const reqData = await reqRes.json();
    if (!typesRes.ok) throw new Error(typesData?.error || "Failed to load leave types");
    if (!reqRes.ok) throw new Error(reqData?.error || "Failed to load leave requests");
    setTypeRows(typesData.types || []);
    setTypes((typesData.types || []).map((t: any) => ({ id: t.id, name: t.name })));
    setRequests(reqData.requests || []);
  }

  async function submitLeave(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        leaveTypeId,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
        ...(canApprove ? { employeeUserId: selectedEmployeeId } : {}),
      }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to submit request");
      // refresh list
      const reqRes = await fetch("/api/leave/requests");
      const reqData = await reqRes.json();
      if (!reqRes.ok) throw new Error(reqData?.error || "Failed to refresh requests");
      setRequests(reqData.requests || []);
      setStartDate("");
      setEndDate("");
      setReason("");
      setLeaveDialogOpen(false);
      showToast("success", canApprove ? "Leave added" : "Request submitted");
    } catch (e: any) {
      setError(e?.message || "Failed to submit request");
      showToast("error", e?.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  async function createLeaveTypeWithPolicy(e: FormEvent) {
    e.preventDefault();
    setCreatingType(true);
    setError(null);
    try {
      const name = newTypeName.trim();
      if (!name) throw new Error("Leave type name is required");

      const typeRes = await fetch("/api/leave/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          isPaid: Boolean(newTypeIsPaid),
          code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 16) || undefined,
        }),
      });
      const typeData = await typeRes.json();
      if (!typeRes.ok) throw new Error(typeData?.error || "Failed to create leave type");

      const leaveTypeId = typeData?.type?.id as string;
      if (!leaveTypeId) throw new Error("Leave type created but missing id");

      const policyRes = await fetch("/api/leave/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeId,
          accrualMethod: newAccrualMethod,
          monthlyAccrualRate: newAccrualMethod === "monthly" ? Number(newMonthlyRate) : null,
          annualQuota: newAccrualMethod === "none" ? null : Number(newAnnualQuota),
          prorateOnJoin: Boolean(newProrateOnJoin),
          resetMonth: 1,
          resetDay: 1,
        }),
      });
      const policyData = await policyRes.json();
      if (!policyRes.ok) throw new Error(policyData?.error || "Failed to save leave policy");

      await refreshLeaveData();
      setNewTypeName("");
      setNewTypeIsPaid(true);
      setNewAccrualMethod("monthly");
      setNewMonthlyRate("1");
      setNewAnnualQuota("12");
      setNewProrateOnJoin(true);
      setManageTypesOpen(false);
      showToast("success", "Leave type created");
    } catch (e: any) {
      setError(e?.message || "Failed to create leave type");
      showToast("error", e?.message || "Failed to create leave type");
    } finally {
      setCreatingType(false);
    }
  }

  function openEditPolicy(t: any) {
    const p = Array.isArray(t.HRMS_leave_policies) ? t.HRMS_leave_policies[0] : t.HRMS_leave_policies;
    setEditPolicyFor({ leaveTypeId: t.id, name: t.name });
    setEditAccrualMethod((p?.accrual_method as any) || "monthly");
    setEditMonthlyRate(String(p?.monthly_accrual_rate ?? "1"));
    setEditAnnualQuota(String(p?.annual_quota ?? "12"));
    setEditProrateOnJoin(Boolean(p?.prorate_on_join ?? true));
  }

  async function savePolicy() {
    if (!editPolicyFor) return;
    setSavingPolicy(true);
    setError(null);
    try {
      const res = await fetch("/api/leave/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeId: editPolicyFor.leaveTypeId,
          accrualMethod: editAccrualMethod,
          monthlyAccrualRate: editAccrualMethod === "monthly" ? Number(editMonthlyRate) : null,
          annualQuota: editAccrualMethod === "none" ? null : Number(editAnnualQuota),
          prorateOnJoin: Boolean(editProrateOnJoin),
          resetMonth: 1,
          resetDay: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save policy");
      await refreshLeaveData();
      setEditPolicyFor(null);
      showToast("success", "Policy saved");
    } catch (e: any) {
      setError(e?.message || "Failed to save policy");
      showToast("error", e?.message || "Failed to save policy");
    } finally {
      setSavingPolicy(false);
    }
  }

  async function act(id: string, action: "approve" | "reject") {
    if (action === "reject") {
      setRejectDialog({ id, reason: "" });
      return;
    }
    setActionLoadingId(id);
    setError(null);
    try {
      const res = await fetch("/api/leave/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update request");
      const reqRes = await fetch("/api/leave/requests");
      const reqData = await reqRes.json();
      if (!reqRes.ok) throw new Error(reqData?.error || "Failed to refresh requests");
      setRequests(reqData.requests || []);
      showToast("success", "Updated successfully");
    } catch (e: any) {
      setError(e?.message || "Failed to update request");
      showToast("error", e?.message || "Failed to update request");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function submitReject() {
    if (!rejectDialog) return;
    const { id, reason } = rejectDialog;
    setActionLoadingId(id);
    setError(null);
    try {
      const res = await fetch("/api/leave/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reject", rejectionReason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to reject request");
      const reqRes = await fetch("/api/leave/requests");
      const reqData = await reqRes.json();
      if (!reqRes.ok) throw new Error(reqData?.error || "Failed to refresh requests");
      setRequests(reqData.requests || []);
      setRejectDialog(null);
      showToast("success", "Rejected");
    } catch (e: any) {
      setError(e?.message || "Failed to reject request");
      showToast("error", e?.message || "Failed to reject request");
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Approvals</h1>
        <p className="muted">
          {role === "employee"
            ? "Submit leave and reimbursement requests."
            : "Review and approve requests for your team / company."}
        </p>
      </div>

      <div className="flex gap-2">
        <Link
          href="/approvals?tab=leave"
          className={`btn ${tab === "leave" ? "btn-primary" : "btn-outline"}`}
        >
          Leave
        </Link>
        <Link
          href="/approvals?tab=reimbursement"
          className={`btn ${tab === "reimbursement" ? "btn-primary" : "btn-outline"}`}
        >
          Reimbursement
        </Link>
      </div>

      {tab === "leave" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">{canApprove ? "Add leave" : "Request leave"}</h2>
            <p className="muted">
              {canApprove
                ? "Add leave directly. Super Admin/Admin/HR entries are auto-approved."
                : "Submit a leave request. Super Admin/Admin/HR can approve/reject."}
            </p>

            <div className="mt-4 flex items-center justify-between gap-3">
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={() => {
                  setError(null);
                  setSelectedEmployeeId("");
                  setLeaveDialogOpen(true);
                }}
              >
                {canApprove ? "Add leave" : "Request leave"}
              </button>
            </div>
          </div>

          {canApprove && (
            <div className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="mb-1 text-lg font-semibold text-slate-900">Leave types & policy (company-wise)</h2>
                  <p className="muted">
                    Configure accrual/quota rules per leave type. Balances reset every year on Jan 1.
                  </p>
                </div>
                <button type="button" className="btn btn-outline" onClick={() => setManageTypesOpen(true)}>
                  Add leave type
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Paid</th>
                      <th className="px-3 py-2">Accrual</th>
                      <th className="px-3 py-2">Monthly</th>
                      <th className="px-3 py-2">Annual quota</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeRows.map((t: any) => {
                      const p = Array.isArray(t.HRMS_leave_policies) ? t.HRMS_leave_policies[0] : t.HRMS_leave_policies;
                      return (
                        <tr key={t.id} className="border-t border-slate-200">
                          <td className="px-3 py-2">{t.name}</td>
                          <td className="px-3 py-2">{t.is_paid ? "Yes" : "No"}</td>
                          <td className="px-3 py-2">{p?.accrual_method ?? "-"}</td>
                          <td className="px-3 py-2">{p?.monthly_accrual_rate ?? "-"}</td>
                          <td className="px-3 py-2">{p?.annual_quota ?? "-"}</td>
                          <td className="px-3 py-2">
                            <button type="button" className="btn btn-outline" onClick={() => openEditPolicy(t)}>
                              Edit policy
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Leave requests</h2>
            {loading ? (
              <p className="muted">Loading...</p>
            ) : requests.length === 0 ? (
              <p className="muted">No leave requests yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Dates</th>
                      <th className="px-3 py-2">Days</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Reason</th>
                      {canApprove && <th className="px-3 py-2">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-t border-slate-200">
                        <td className="px-3 py-2">{r.leaveTypeName || "-"}</td>
                        <td className="px-3 py-2">
                          {r.startDate} → {r.endDate}
                        </td>
                        <td className="px-3 py-2">{r.totalDays}</td>
                        <td className="px-3 py-2">{r.status}</td>
                        <td className="px-3 py-2">{r.reason || "-"}</td>
                        {canApprove && (
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={actionLoadingId === r.id || r.status !== "pending"}
                                onClick={() => act(r.id, "approve")}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline"
                                disabled={actionLoadingId === r.id || r.status !== "pending"}
                                onClick={() => act(r.id, "reject")}
                              >
                                Reject
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

          {rejectDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Close dialog"
                onClick={() => setRejectDialog(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
              >
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">Reject leave request</h3>
                  <p className="mt-1 text-sm text-slate-500">Add a reason (optional) and confirm.</p>
                </div>
                <div className="p-5 space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Reason</label>
                  <input
                    type="text"
                    value={rejectDialog.reason}
                    onChange={(e) => setRejectDialog((p) => (p ? { ...p, reason: e.target.value } : p))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" className="btn btn-outline" onClick={() => setRejectDialog(null)} disabled={actionLoadingId === rejectDialog.id}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={submitReject} disabled={actionLoadingId === rejectDialog.id}>
                      {actionLoadingId === rejectDialog.id ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {leaveDialogOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Close dialog"
                onClick={() => setLeaveDialogOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                className="relative z-10 w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl"
              >
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">{canApprove ? "Add leave" : "Request leave"}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {canApprove ? "Fill in the details to add leave." : "Fill in the details to submit a leave request."}
                  </p>
                </div>

                <form onSubmit={submitLeave} className="p-5">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                      {canApprove && (
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700">Employee</label>
                          <select
                            required={canApprove}
                            value={selectedEmployeeId}
                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            <option value="">Select employee</option>
                            {currentEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name || e.email}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
                        <select
                          value={leaveTypeId}
                          onChange={(e) => setLeaveTypeId(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          {types.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Reason (optional)</label>
                        <input
                          type="text"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Start date</label>
                        <input
                          type="date"
                          required
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">End date</label>
                        <input
                          type="date"
                          required
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    {totalDays > 0 && (
                      <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-700">
                        <span className="font-medium">Total: {totalDays} day{totalDays !== 1 ? "s" : ""}</span>
                        {balancePreview ? (
                          <>
                            {balancePreview.paidDays > 0 && <span className="ml-2 text-emerald-700">{Math.round(balancePreview.paidDays)} paid</span>}
                            {balancePreview.unpaidDays > 0 && <span className="ml-2 text-amber-700">{Math.round(balancePreview.unpaidDays)} unpaid</span>}
                          </>
                        ) : selectedLeaveType?.is_paid === false ? (
                          <span className="ml-2 text-amber-700">{totalDays} unpaid</span>
                        ) : (
                          <span className="ml-2 text-slate-500">Calculating...</span>
                        )}
                      </div>
                    )}

                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-outline" onClick={() => setLeaveDialogOpen(false)} disabled={submitting || loading}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={submitting || loading || (canApprove && currentEmployees.length === 0)}
                      >
                        {submitting ? (canApprove ? "Adding..." : "Submitting...") : canApprove ? "Add leave" : "Submit request"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {manageTypesOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setManageTypesOpen(false)} />
              <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">Add leave type</h3>
                  <p className="mt-1 text-sm text-slate-500">Create a leave type and set company-wise accrual rules.</p>
                </div>

                <form onSubmit={createLeaveTypeWithPolicy} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                      <input
                        type="text"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Paid Leave"
                        required
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input type="checkbox" checked={newTypeIsPaid} onChange={(e) => setNewTypeIsPaid(e.target.checked)} />
                        Paid (affects payroll)
                      </label>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Accrual method</label>
                      <select
                        value={newAccrualMethod}
                        onChange={(e) => setNewAccrualMethod(e.target.value as any)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="monthly">Monthly (e.g. 1/month)</option>
                        <option value="annual">Annual quota (e.g. 3/year)</option>
                        <option value="none">No limit</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Prorate on join</label>
                      <select
                        value={newProrateOnJoin ? "yes" : "no"}
                        onChange={(e) => setNewProrateOnJoin(e.target.value === "yes")}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    {newAccrualMethod === "monthly" && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Monthly accrual rate</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={newMonthlyRate}
                          onChange={(e) => setNewMonthlyRate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    )}

                    {newAccrualMethod !== "none" && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Annual quota</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={newAnnualQuota}
                          onChange={(e) => setNewAnnualQuota(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-outline" onClick={() => setManageTypesOpen(false)} disabled={creatingType}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={creatingType}>
                        {creatingType ? "Creating..." : "Create"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {editPolicyFor && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={() => setEditPolicyFor(null)} />
              <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">Edit policy</h3>
                  <p className="mt-1 text-sm text-slate-500">{editPolicyFor.name}</p>
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Accrual method</label>
                      <select
                        value={editAccrualMethod}
                        onChange={(e) => setEditAccrualMethod(e.target.value as any)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="annual">Annual</option>
                        <option value="none">No limit</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Prorate on join</label>
                      <select
                        value={editProrateOnJoin ? "yes" : "no"}
                        onChange={(e) => setEditProrateOnJoin(e.target.value === "yes")}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    {editAccrualMethod === "monthly" && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Monthly accrual rate</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editMonthlyRate}
                          onChange={(e) => setEditMonthlyRate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    )}

                    {editAccrualMethod !== "none" && (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">Annual quota</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editAnnualQuota}
                          onChange={(e) => setEditAnnualQuota(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-outline" onClick={() => setEditPolicyFor(null)} disabled={savingPolicy}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={savePolicy} disabled={savingPolicy}>
                        {savingPolicy ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "reimbursement" && (
        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Reimbursement claims</h2>
          <p className="muted mb-3">
            Map this UI to the HRMS_reimbursements table. Employees raise claims, managers /
            approvers change status and add approval timestamps.
          </p>
        </div>
      )}
    </section>
  );
}
