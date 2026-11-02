"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { DateInput } from "@/components/ui/DateInput";
import { formatDmyFromIso, formatDmyTimeFromIso, formatTime12FromIso } from "@/lib/dateInputs";
import { emptyPaginationMeta, type PaginationMeta } from "@/lib/pagination";

/**
 * CIRT-10: one row per action (not per employee). "View Details" opens the child rows
 * Changed Item | Previous Value | Updated Value for that action only.
 */
export type ActivityEntry = {
  id: string;
  action: string;
  actionCode: string;
  performedBy: string;
  /** ISO timestamp; Date and Time columns are formatted from it (DD/MM/YYYY, 12-hour, IST). */
  performedAt: string;
  module: "Payroll" | "Master" | "Configuration" | string;
  outcome: string;
  employeeCount: number;
  detailCount: number;
};

export type ActivityEntryDetail = {
  employee: string | null;
  changedItem: string;
  previousValue: string | null;
  updatedValue: string | null;
};

const MODULES = ["Payroll", "Master", "Configuration"] as const;

export function ActivityEntriesView() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyPaginationMeta(25));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [open, setOpen] = useState<ActivityEntry | null>(null);
  const [details, setDetails] = useState<ActivityEntryDetail[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (module) p.set("module", module);
    if (actor.trim()) p.set("actor", actor.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [module, actor, from, to, page, perPage]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/activity-logs/entries?${params}`, { signal: controller.signal, cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || data?.error || "Could not load the activity log.");
        if (controller.signal.aborted) return;
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        const p = data.pagination ?? {};
        setMeta({ current_page: Number(p.currentPage ?? 1), per_page: Number(p.perPage ?? perPage), total: Number(p.total ?? 0), last_page: Number(p.lastPage ?? 1) });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the activity log.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [params, perPage]);

  async function openDetails(entry: ActivityEntry) {
    setOpen(entry);
    setDetails(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/activity-logs/entries/${encodeURIComponent(entry.id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || "Could not load the details.");
      setDetails(Array.isArray(data.entry?.details) ? data.entry.details : []);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Could not load the details.");
    }
  }

  const showEmployee = (details ?? []).some((d) => d.employee);

  return (
    <section className="flex min-h-0 flex-col gap-5 pb-6">
      <PageHeader title="Activity Log" description="One record per action. Open View Details to see what changed." className="!mb-0" />
      <div className="card space-y-4 !p-4 sm:!p-5">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0">
            <span className="label-field">Module</span>
            <select className="input-field w-full" value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }}>
              <option value="">All modules</option>
              {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="min-w-0">
            <span className="label-field">Performed By</span>
            <input className="input-field w-full" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} placeholder="User name" />
          </label>
          <div className="min-w-0">
            <span className="label-field">From</span>
            <DateInput aria-label="From date" optional value={from} max={to || undefined} onChange={(v) => { setFrom(v); setPage(1); }} />
          </div>
          <div className="min-w-0">
            <span className="label-field">To</span>
            <DateInput aria-label="To date" optional value={to} min={from || undefined} onChange={(v) => { setTo(v); setPage(1); }} />
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={() => { setModule(""); setActor(""); setFrom(""); setTo(""); setPage(1); }}>Reset filters</Button>
          </div>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/90 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Performed By</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">View Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0
                ? Array.from({ length: 5 }, (_, i) => <tr key={i} className="border-t border-slate-100"><td colSpan={6} className="p-3"><div className="h-5 animate-pulse rounded bg-slate-100" /></td></tr>)
                : null}
              {!loading && entries.length === 0 && !error ? (
                <tr><td colSpan={6} className="p-12 text-center text-slate-500">No activity found. Earlier per-employee records are under &ldquo;Earlier records&rdquo;.</td></tr>
              ) : null}
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100 transition-colors hover:bg-blue-50/40">
                  <td className="px-4 py-3.5 font-medium text-slate-800">
                    {entry.action}
                    {entry.outcome === "failed" ? <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Failed</span> : null}
                    {entry.employeeCount > 0 ? <span className="block text-xs font-normal text-slate-500">{entry.employeeCount} employee{entry.employeeCount === 1 ? "" : "s"}</span> : null}
                  </td>
                  <td className="px-4 py-3.5 text-slate-700">{entry.performedBy}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{formatDmyFromIso(entry.performedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{formatTime12FromIso(entry.performedAt)}</td>
                  <td className="px-4 py-3.5 text-slate-700">{entry.module}</td>
                  <td className="px-4 py-3.5">
                    <button type="button" className="rounded-md font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => void openDetails(entry)}>
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationControls meta={meta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} loading={loading} />
      </div>

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? `${open.action} — ${formatDmyTimeFromIso(open.performedAt)}` : "Details"}>
        {detailError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{detailError}</p> : null}
        {!detailError && details === null ? <div className="h-16 animate-pulse rounded bg-slate-100" /> : null}
        {details !== null && details.length === 0 ? <p className="text-sm text-slate-500">No individual field changes were recorded for this action.</p> : null}
        {details !== null && details.length > 0 ? (
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {showEmployee ? <th className="px-3 py-2">Employee</th> : null}
                  <th className="px-3 py-2">Changed Item</th>
                  <th className="px-3 py-2">Previous Value</th>
                  <th className="px-3 py-2">Updated Value</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {showEmployee ? <td className="px-3 py-2 text-slate-600">{d.employee ?? "—"}</td> : null}
                    <td className="px-3 py-2 font-medium text-slate-800">{d.changedItem}</td>
                    <td className="px-3 py-2 text-slate-600">{d.previousValue ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-900">{d.updatedValue ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
