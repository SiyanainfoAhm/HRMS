"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { emptyPaginationMeta, type PaginationMeta } from "@/lib/pagination";
import { ActivityLogDetails } from "./ActivityLogDetails";
import { actionLabel, buildActivityLogQueryParams, fieldLabel, formatTimestamp, payrollMonth, type AuditRecord } from "./activityLogPresentation";

type ActivityEvent = AuditRecord & { actorUserId?: string | null; employeeId?: string | null; changeCount?: number; changeClassificationSource?: string | null; directChangeCount?: number | null; recalculatedChangeCount?: number | null };
const ACTIONS = ["auth.login", "user.created", "employee.created", "employee.updated", "payroll_master.changed", "payroll.draft.saved", "payroll.draft.discarded", "payroll.generated", "payroll.generated.amended", "payroll.excel.exported", "payslip.generated", "payslip.viewed", "user.access.changed", "payroll.configuration.changed"];

export function ActivityLogScreen() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyPaginationMeta(25));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [employee, setEmployee] = useState("");
  const [period, setPeriod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);

  const filters = useMemo(() => ({ search, action, actor, employee, period, from, to, category, outcome }), [search, action, actor, employee, period, from, to, category, outcome]);
  const params = useMemo(() => buildActivityLogQueryParams(filters, page, perPage), [filters, page, perPage]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/activity-logs?${params}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || data?.error || "Could not load activity logs.");
        if (controller.signal.aborted) return;
        setEvents(Array.isArray(data.events) ? data.events : []);
        const p = data.pagination ?? {};
        setMeta({ current_page: Number(p.currentPage ?? 1), per_page: Number(p.perPage ?? perPage), total: Number(p.total ?? 0), last_page: Number(p.lastPage ?? 1) });
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load activity logs."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [params, perPage]);

  async function exportLogs() {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams(params); exportParams.delete("page"); exportParams.delete("per_page"); exportParams.set("export", "1");
      const response = await fetch(`/api/activity-logs?${exportParams}`);
      if (!response.ok) throw new Error("Could not export activity logs.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "cirt-activity-log.csv"; link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export activity logs."); }
    finally { setExporting(false); }
  }

  function resetFilters() { setSearch(""); setAction(""); setActor(""); setEmployee(""); setPeriod(""); setFrom(""); setTo(""); setCategory(""); setOutcome(""); setPage(1); }
  function update<T>(setter: (value: T) => void, value: T) { setter(value); setPage(1); }

  return <section className="flex min-h-0 flex-col gap-5 pb-6">
    <PageHeader title="Activity Log" description="Track payroll changes, employee updates, and administrative actions." className="!mb-0" />
    <div className="card space-y-5 !p-4 sm:!p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><SlidersHorizontal className="h-5 w-5" /></div>
          <div><h2 className="text-sm font-semibold text-slate-900">Filter activity</h2><p className="mt-0.5 text-xs text-slate-500">Narrow the log by person, action, or date.</p></div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button type="button" variant="outline" onClick={resetFilters}>Reset filters</Button>
          <Button type="button" disabled={exporting || loading} loading={exporting} onClick={() => void exportLogs()}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <label className="min-w-0"><span className="label-field">Search</span><span className="relative block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden /><input className="input-field w-full pl-9" value={search} onChange={(e) => update(setSearch, e.target.value)} placeholder="Employee, actor or activity" /></span></label>
        <Select label="Category" value={category} onChange={(v) => update(setCategory, v)}><option value="">All categories</option><option value="payroll">Payroll</option><option value="security">Security</option><option value="administration">Administration</option></Select>
        <Select label="Activity" value={action} onChange={(v) => update(setAction, v)}><option value="">All activities</option>{ACTIONS.map((item) => <option value={item} key={item}>{actionLabel(item)}</option>)}</Select>
        <Select label="Outcome" value={outcome} onChange={(v) => update(setOutcome, v)}><option value="">All outcomes</option><option value="succeeded">Successful</option><option value="failed">Failed</option></Select>
        <label className="min-w-0"><span className="label-field">User</span><input className="input-field w-full" value={actor} onChange={(e) => update(setActor, e.target.value)} placeholder="Name or email" /></label>
        <label className="min-w-0"><span className="label-field">Employee</span><input className="input-field w-full" value={employee} onChange={(e) => update(setEmployee, e.target.value)} placeholder="Name or employee code" /></label>
        <label className="min-w-0"><span className="label-field">Payroll month</span><input className="input-field w-full" type="month" value={period} onChange={(e) => update(setPeriod, e.target.value)} /></label>
        <label className="min-w-0"><span className="label-field">From</span><input className="input-field w-full" type="date" value={from} onChange={(e) => update(setFrom, e.target.value)} /></label>
        <label className="min-w-0"><span className="label-field">To</span><input className="input-field w-full" type="date" value={to} onChange={(e) => update(setTo, e.target.value)} /></label>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead><tr className="bg-slate-50/90 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-4 py-3">Date &amp; Time</th><th className="px-4 py-3">Performed By</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Payroll Month</th><th className="px-4 py-3">Changes</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Details</th></tr></thead>
          <tbody>{loading && events.length === 0 ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="border-t border-slate-100"><td colSpan={8} className="p-3"><div className="h-5 animate-pulse rounded bg-slate-100" /></td></tr>) : null}
            {!loading && events.length === 0 && !error ? <tr><td colSpan={8} className="p-12 text-center"><div className="font-medium text-slate-700">No activity found</div><div className="mt-1 text-sm text-slate-500">Try changing or resetting your filters.</div></td></tr> : null}
            {events.map((event) => <tr className="border-t border-slate-100 align-middle transition-colors hover:bg-blue-50/40" key={event.eventId}>
              <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{formatTimestamp(event.timestamp)}</td>
              <td className="p-3"><span className="font-medium text-slate-800">{event.actor || "Unknown user"}</span><span className="block text-xs capitalize text-slate-500">{event.actorRole?.replace(/[._-]+/g, " ") || "—"}</span></td>
              <td className="px-4 py-3.5 font-medium text-slate-800">{actionLabel(event.action, event.outcome)}</td>
              <td className="p-3 text-slate-700">{event.employee || "—"}</td>
              <td className="whitespace-nowrap px-4 py-3.5 text-slate-700">{payrollMonth(event.payrollYear, event.payrollMonth)}</td>
              <td className="max-w-[260px] p-3 text-slate-600">{event.changeClassificationSource === "payroll-ui" ? <>{event.directChangeCount || 0} direct · {event.recalculatedChangeCount || 0} recalculated</> : event.changeCount ? <><span>{event.changeCount} {event.changeCount === 1 ? "field" : "fields"} changed</span>{event.changedFieldNames?.length ? <span className="mt-1 block truncate text-xs text-slate-500" title={event.changedFieldNames.map(fieldLabel).join(", ")}>{event.changedFieldNames.map(fieldLabel).join(", ")}{event.changeCount > event.changedFieldNames.length ? ", …" : ""}</span> : null}</> : "—"}</td>
              <td className="p-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${event.outcome === "failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{event.outcome === "failed" ? "Failed" : "Success"}</span></td>
              <td className="px-4 py-3.5"><button type="button" className="rounded-md font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => setSelected(event)}>View details</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <PaginationControls meta={meta} onPageChange={setPage} onPerPageChange={(size) => { setPerPage(size); setPage(1); }} loading={loading} />
    </div>
    <ActivityLogDetails key={selected?.eventId ?? "closed"} event={selected} onClose={() => setSelected(null)} />
  </section>;
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="min-w-0"><span className="label-field">{label}</span><select className="input-field w-full" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></label>; }
