"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { FormEvent, useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";

export default function PayrollPage() {
  const { role } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") || "master";

  const canManage = role === "super_admin" || role === "admin" || role === "hr";

  const [masters, setMasters] = useState<any[]>([]);
  const [mastersLoading, setMastersLoading] = useState(false);
  const [editMasterOpen, setEditMasterOpen] = useState<any>(null);
  const [editGross, setEditGross] = useState("");
  const [editPfEligible, setEditPfEligible] = useState(false);
  const [editEsicEligible, setEditEsicEligible] = useState(false);
  const [editEffectiveDate, setEditEffectiveDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [runMonth, setRunMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  const [runYear, setRunYear] = useState(() => String(new Date().getFullYear()));
  const [runDay, setRunDay] = useState(() => String(new Date().getDate()));
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    periodName: string;
    periodStart: string;
    periodEnd: string;
    daysInMonth: number;
    effectiveRunDay: number;
    alreadyRun: boolean;
    existingPeriodId: string | null;
    rows: {
      employeeUserId: string;
      employeeName: string | null;
      employeeEmail: string;
      payDays: number;
      unpaidLeaveDays: number;
      grossPay: number;
      pfEmployee: number;
      pfEmployer: number;
      esicEmployee: number;
      esicEmployer: number;
      profTax: number;
      deductions: number;
      netPay: number;
      takeHome: number;
      ctc: number;
    }[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pastPeriods, setPastPeriods] = useState<{ id: string; periodName: string; periodStart: string; periodEnd: string; excelFilePath: string | null }[]>([]);
  const [pastPeriodsLoading, setPastPeriodsLoading] = useState(false);
  const [editableRows, setEditableRows] = useState<
    {
      employeeUserId: string;
      employeeName: string | null;
      employeeEmail: string;
      payDays: number;
      unpaidLeaveDays: number;
      grossMonthly?: number;
      grossPay: number;
      pfEmployee: number;
      pfEmployer: number;
      esicEmployee: number;
      esicEmployer: number;
      profTax: number;
      deductions: number;
      netPay: number;
      incentive: number;
      prBonus: number;
      reimbursement: number;
      tds: number;
      takeHome: number;
      ctc: number;
      ctcBase?: number;
    }[]
  >([]);

  useEffect(() => {
    if (preview?.rows?.length && preview.daysInMonth) {
      setEditableRows(
        preview.rows.map((r: any) => ({
          ...r,
          grossMonthly: r.grossMonthly ?? Math.round((r.grossPay * preview.daysInMonth) / (r.payDays || 1)),
          incentive: r.incentive ?? 0,
          prBonus: r.prBonus ?? 0,
          reimbursement: r.reimbursement ?? 0,
          tds: r.tds ?? 0,
          ctcBase: r.ctcBase ?? r.ctc,
        }))
      );
    } else {
      setEditableRows([]);
    }
  }, [preview?.rows, preview?.daysInMonth]);

  function updateEditableRow(
    employeeUserId: string,
    field: string,
    value: number
  ) {
    const daysInMonth = preview?.daysInMonth ?? 30;
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.employeeUserId !== employeeUserId) return row;
        const next = { ...row, [field]: value } as typeof row;
        const recalcTakeHome = () => {
          next.takeHome = next.netPay - (next.tds ?? 0) + (next.incentive ?? 0) + (next.prBonus ?? 0) + (next.reimbursement ?? 0);
        };
        const recalcCtc = () => {
          const base = row.ctcBase ?? row.ctc;
          next.ctc = base + (next.incentive ?? 0) + (next.prBonus ?? 0);
        };
        if (field === "payDays") {
          const newPayDays = Math.max(0, Math.min(daysInMonth, value));
          const grossMonthly = row.grossMonthly ?? Math.round((row.grossPay * daysInMonth) / (row.payDays || 1));
          next.payDays = newPayDays;
          next.grossPay = newPayDays === 0 ? 0 : Math.round((grossMonthly * newPayDays) / daysInMonth);
          const ratio = row.payDays > 0 && newPayDays > 0 ? newPayDays / row.payDays : newPayDays === 0 ? 0 : 1;
          next.pfEmployee = Math.round(row.pfEmployee * ratio);
          next.pfEmployer = Math.round(row.pfEmployer * ratio);
          next.esicEmployee = Math.round(row.esicEmployee * ratio);
          next.esicEmployer = Math.round(row.esicEmployer * ratio);
          next.deductions = next.pfEmployee + next.esicEmployee + next.profTax;
          next.netPay = next.grossPay - next.deductions;
          recalcTakeHome();
          recalcCtc();
        } else if (["grossPay", "pfEmployee", "esicEmployee", "profTax"].includes(field)) {
          next.deductions = next.pfEmployee + next.esicEmployee + next.profTax;
          next.netPay = next.grossPay - next.deductions;
          recalcTakeHome();
          recalcCtc();
        } else if (field === "deductions") {
          next.netPay = next.grossPay - value;
          recalcTakeHome();
          recalcCtc();
        } else if (["incentive", "prBonus", "reimbursement", "tds"].includes(field)) {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "netPay") {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "takeHome") {
          next.takeHome = value;
          recalcCtc();
        } else if (field === "ctc") {
          next.ctc = value;
        }
        return next;
      })
    );
  }

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setMastersLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/payroll/master");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load masters");
        if (!cancelled) setMasters(data.masters || []);
      } catch {
        if (!cancelled) setMasters([]);
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const daysInSelectedMonth = new Date(
    parseInt(runYear, 10),
    parseInt(runMonth, 10),
    0
  ).getDate();

  useEffect(() => {
    const day = parseInt(runDay, 10) || 1;
    if (day > daysInSelectedMonth) {
      setRunDay(String(daysInSelectedMonth));
    }
  }, [runMonth, runYear, runDay, daysInSelectedMonth]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    setPreview(null);
    setEditableRows([]);
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}`
        );
        const data = await res.json();
        if (!cancelled && res.ok) setPreview(data.preview ?? null);
        else if (!cancelled) setPreview(null);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage, tab, runYear, runMonth, runDay]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    setPastPeriodsLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/payroll/periods");
        const data = await res.json();
        if (!cancelled && res.ok) setPastPeriods(data.periods ?? []);
        else if (!cancelled) setPastPeriods([]);
      } catch {
        if (!cancelled) setPastPeriods([]);
      } finally {
        if (!cancelled) setPastPeriodsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage, tab]);

  async function handleSaveMaster(e: FormEvent) {
    e.preventDefault();
    if (!editMasterOpen) return;
    setEditSaving(true);
    try {
      const gross = parseFloat(editGross) || 0;
      const res = await fetch("/api/payroll/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeUserId: editMasterOpen.employeeUserId,
          grossSalary: gross,
          pfEligible: editPfEligible,
          esicEligible: editEsicEligible,
          effectiveStartDate: editEffectiveDate,
          reasonForChange: editReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update");
      showToast("success", "Payroll master updated");
      setEditMasterOpen(null);
      const refresh = await fetch("/api/payroll/master");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to update");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleRunPayroll(e: FormEvent) {
    e.preventDefault();
    setRunError(null);
    setRunning(true);
    try {
      const rowsPayload = editableRows.map((r) => ({
        employeeUserId: r.employeeUserId,
        payDays: r.payDays,
        grossPay: r.grossPay,
        netPay: r.netPay,
        pfEmployee: r.pfEmployee,
        pfEmployer: r.pfEmployer,
        esicEmployee: r.esicEmployee,
        esicEmployer: r.esicEmployer,
        profTax: r.profTax,
        deductions: r.deductions,
        incentive: r.incentive ?? 0,
        prBonus: r.prBonus ?? 0,
        reimbursement: r.reimbursement ?? 0,
        tds: r.tds ?? 0,
        takeHome: r.takeHome,
        ctc: r.ctc,
      }));
      const res = await fetch("/api/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(runYear, 10),
          month: parseInt(runMonth, 10),
          runDay: parseInt(runDay, 10),
          rows: rowsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to run payroll");
      showToast("success", `Payroll generated: ${data.payslipsGenerated} payslips. Excel saved to storage.`);
      router.push("/payroll?tab=master");
    } catch (e: any) {
      setRunError(e?.message || "Failed to run payroll");
      showToast("error", e?.message || "Failed to run payroll");
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Payroll</h1>
        <p className="muted">You don&apos;t have access to payroll management.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Payroll</h1>
        <p className="muted">Payroll Master and monthly payroll run.</p>
      </div>

      <div className="flex gap-2">
        <Link
          href="/payroll?tab=master"
          className={`btn ${tab === "master" ? "btn-primary" : "btn-outline"}`}
        >
          Payroll Master
        </Link>
        <Link
          href="/payroll?tab=run"
          className={`btn ${tab === "run" ? "btn-primary" : "btn-outline"}`}
        >
          Run Payroll
        </Link>
      </div>

      {tab === "master" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Payroll Master</h2>
            <p className="muted mb-3">
              Current employees&apos; salary structure. Master record is created when converted to current. Only record with effective end date = null is used for monthly payroll.
            </p>
            {mastersLoading ? (
              <p className="muted">Loading...</p>
            ) : masters.length === 0 ? (
              <p className="muted">No current employees with payroll master.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Gross (mo)</th>
                      <th className="px-3 py-2">CTC (mo)</th>
                      <th className="px-3 py-2">Take home</th>
                      <th className="px-3 py-2">PF</th>
                      <th className="px-3 py-2">ESIC</th>
                      <th className="px-3 py-2">Applicable Month</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masters.map((row) => (
                      <tr key={row.employeeUserId} className="border-t border-slate-200">
                        <td className="px-3 py-2">{row.employeeName || row.employeeEmail || "—"}</td>
                        <td className="px-3 py-2">
                          {row.master ? `₹${Number(row.master.grossSalary).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.master ? `₹${Number(row.master.ctc).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.master ? `₹${Number(row.master.takeHome).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-3 py-2">{row.master?.pfEligible ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{row.master?.esicEligible ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{row.master?.effectiveStartDate || "—"}</td>
                        <td className="px-3 py-2">
                          {row.master ? (
                            <button
                              type="button"
                              className="btn btn-outline !py-1 !text-xs"
                              onClick={() => {
                                setEditMasterOpen(row);
                                setEditGross(String(row.master.grossSalary || ""));
                                setEditPfEligible(row.master.pfEligible || false);
                                setEditEsicEligible(row.master.esicEligible || false);
                                setEditEffectiveDate(new Date().toISOString().slice(0, 10));
                                setEditReason("UpdateOnly");
                              }}
                            >
                              Edit
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {editMasterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setEditMasterOpen(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5">
            <h3 className="text-lg font-semibold text-slate-900">Edit Payroll Master</h3>
            <p className="text-sm text-slate-500 mt-1">{editMasterOpen.employeeName || editMasterOpen.employeeEmail}</p>
            <form onSubmit={handleSaveMaster} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Gross salary (monthly) *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={editGross}
                  onChange={(e) => setEditGross(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editPfEligible} onChange={(e) => setEditPfEligible(e.target.checked)} />
                  PF eligible
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editEsicEligible} onChange={(e) => setEditEsicEligible(e.target.checked)} />
                  ESIC eligible
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Effective start date *</label>
                <input
                  type="date"
                  value={editEffectiveDate}
                  onChange={(e) => setEditEffectiveDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Reason for change *</label>
                <select
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select reason</option>
                  <option value="NewJoin">New Join</option>
                  <option value="Promotion">Promotion</option>
                  <option value="Demotion">Demotion</option>
                  <option value="YearlyAppraisal">Yearly Appraisal</option>
                  <option value="Increment">Increment</option>
                  <option value="UpdateOnly">Update Only</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-outline" onClick={() => setEditMasterOpen(null)} disabled={editSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={editSaving}>
                  {editSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === "run" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Run monthly payroll</h2>
            <p className="muted mb-4">
              Generate payroll once per month for all employees who have Payroll Master records.
            </p>
            <form onSubmit={handleRunPayroll} className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Month</label>
                  <select
                    value={runMonth}
                    onChange={(e) => setRunMonth(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={String(m).padStart(2, "0")}>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                  <input
                    type="number"
                    min="2020"
                    max="2030"
                    value={runYear}
                    onChange={(e) => setRunYear(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Run date (day)</label>
                  <input
                    type="number"
                    min="1"
                    max={daysInSelectedMonth}
                    value={runDay}
                    onChange={(e) => setRunDay(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {preview?.periodName && (
                    <span className="text-lg font-semibold text-slate-800">{preview.periodName}</span>
                  )}
                  <button
                    type="submit"
                    className={`btn btn-primary ${preview?.alreadyRun ? "cursor-not-allowed opacity-50" : ""}`}
                    disabled={running || preview?.alreadyRun}
                  >
                    {running ? "Generating..." : "Generate"}
                  </button>
                </div>
              </div>
              {runError && <p className="text-sm text-red-600">{runError}</p>}
              {preview?.alreadyRun && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-amber-700">Payroll already run for this period.</p>
                  {preview?.existingPeriodId && (
                    <a
                      href={`/api/payroll/export?periodId=${preview.existingPeriodId}`}
                      download
                      className="btn btn-outline !py-1.5 !text-sm"
                    >
                      Download Excel
                    </a>
                  )}
                </div>
              )}
              {previewLoading ? (
                <p className="muted py-6">Loading payroll for selected month and year...</p>
              ) : editableRows.length ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="mb-3 text-sm text-slate-600">
                    {preview?.alreadyRun
                      ? "Payroll generated for this period. Values are read-only."
                      : "Edit values before generating. Changing pay days will recalculate gross, PF, ESIC and deductions."}
                  </p>
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="w-[100px] px-1.5 py-1">Employee</th>
                      <th className="w-[52px] px-1 py-1">Days</th>
                      <th className="w-[60px] px-1 py-1">Gross</th>
                      <th className="w-[60px] px-1 py-1">Net</th>
                      <th className="w-[48px] px-1 py-1">PF</th>
                      <th className="w-[48px] px-1 py-1">PF(R)</th>
                      <th className="w-[48px] px-1 py-1">ESIC</th>
                      <th className="w-[52px] px-1 py-1">ESIC(R)</th>
                      <th className="w-[44px] px-1 py-1">PT</th>
                      <th className="w-[48px] px-1 py-1">Bonus</th>
                      <th className="w-[48px] px-1 py-1">Inc</th>
                      <th className="w-[52px] px-1 py-1">Reimb</th>
                      <th className="w-[44px] px-1 py-1">TDS</th>
                      <th className="w-[52px] px-1 py-1">Ded</th>
                      <th className="w-[60px] px-1 py-1">Take</th>
                      <th className="w-[60px] px-1 py-1">CTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableRows.map((r) => {
                      const readOnly = !!preview?.alreadyRun;
                      return (
                      <tr key={r.employeeUserId} className="border-t border-slate-200">
                        <td className="truncate px-1.5 py-1 font-medium text-slate-900" title={r.employeeName || r.employeeEmail || undefined}>
                          {r.employeeName || r.employeeEmail || "—"}
                        </td>
                        <td className="px-1 py-1">
                          {readOnly ? (
                            <span className="py-0.5">{r.payDays}{r.unpaidLeaveDays > 0 ? ` (-${r.unpaidLeaveDays})` : ""}</span>
                          ) : (
                            <>
                              <input
                                type="number"
                                min={0}
                                max={preview?.daysInMonth ?? 31}
                                value={r.payDays}
                                onChange={(e) =>
                                  updateEditableRow(r.employeeUserId, "payDays", parseInt(e.target.value, 10) || 0)
                                }
                                className="w-full max-w-[44px] rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />
                              {r.unpaidLeaveDays > 0 && (
                                <span className="ml-0.5 text-[10px] text-amber-700">(-{r.unpaidLeaveDays})</span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.grossPay.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.grossPay} onChange={(e) => updateEditableRow(r.employeeUserId, "grossPay", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.netPay.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.netPay} onChange={(e) => updateEditableRow(r.employeeUserId, "netPay", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.pfEmployee.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.pfEmployee} onChange={(e) => updateEditableRow(r.employeeUserId, "pfEmployee", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.pfEmployer.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.pfEmployer} onChange={(e) => updateEditableRow(r.employeeUserId, "pfEmployer", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.esicEmployee.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.esicEmployee} onChange={(e) => updateEditableRow(r.employeeUserId, "esicEmployee", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.esicEmployer.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.esicEmployer} onChange={(e) => updateEditableRow(r.employeeUserId, "esicEmployer", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.profTax.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.profTax} onChange={(e) => updateEditableRow(r.employeeUserId, "profTax", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.prBonus ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.prBonus ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "prBonus", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.incentive ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.incentive ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "incentive", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.reimbursement ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.reimbursement ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "reimbursement", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.tds ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.tds ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "tds", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.deductions.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.deductions} onChange={(e) => updateEditableRow(r.employeeUserId, "deductions", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span className="font-medium">{r.takeHome.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.takeHome} onChange={(e) => updateEditableRow(r.employeeUserId, "takeHome", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs font-medium focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.ctc.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.ctc} onChange={(e) => updateEditableRow(r.employeeUserId, "ctc", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            ) : !preview?.alreadyRun ? (
              <p className="muted py-6">No employees in payroll for the selected month and year. Ensure employees have Payroll Master records.</p>
            ) : null}
            </form>
          </div>

          
        </div>
      )}
    </section>
  );
}
