"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AttendanceDateFilter, type AttendancePreset } from "@/components/AttendanceDateFilter";
import { SkeletonTable } from "@/components/Skeleton";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type Row = {
  logId: string;
  workDate: string;
  employeeId: string;
  employeeName: string | null;
  employeeEmail: string;
  checkInAt: string | null;
  lunchCheckOutAt: string | null;
  lunchCheckInAt: string | null;
  checkOutAt: string | null;
  totalHours: number | null;
  lunchBreakMinutes: number;
  lunchBreakMinutesRecorded?: number;
  mandatoryLunchAssumed?: boolean;
  teaBreakMinutes: number;
  lunchBreakOpen: boolean;
  teaBreakOpen: boolean;
  status: string | null;
  grossMinutes: number | null;
  activeMinutes: number | null;
  meetsEightHourWork: boolean;
};

function formatTimeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtHoursMin(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function formatDayHeading(ymd: string): string {
  return new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortYmd(ymd: string): string {
  return new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AttendanceRow({
  r,
  showDateCol,
  showEmployeeCols,
}: {
  r: Row;
  showDateCol: boolean;
  showEmployeeCols: boolean;
}) {
  return (
    <tr className="bg-white transition-colors hover:bg-emerald-50/40">
      {showDateCol && (
        <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-600">{formatShortYmd(r.workDate)}</td>
      )}
      {showEmployeeCols && (
        <td className="px-4 py-3">
          <div className="font-medium text-slate-900">{r.employeeName || "—"}</div>
          <div className="text-xs text-slate-500">{r.employeeEmail}</div>
        </td>
      )}
      <td className="px-3 py-3 tabular-nums text-slate-800">{formatTimeIST(r.checkInAt)}</td>
      <td className="px-3 py-3 tabular-nums text-slate-800">{formatTimeIST(r.lunchCheckOutAt)}</td>
      <td className="px-3 py-3 tabular-nums text-slate-800">{formatTimeIST(r.lunchCheckInAt)}</td>
      <td className="px-3 py-3 tabular-nums text-slate-800">{formatTimeIST(r.checkOutAt)}</td>
      <td className="px-3 py-3 font-medium text-slate-800">{fmtHoursMin(r.grossMinutes)}</td>
      <td className="px-3 py-3 font-medium text-slate-800">{fmtHoursMin(r.activeMinutes)}</td>
      <td className="px-3 py-3 text-xs text-slate-600">
        {r.lunchBreakMinutes} / {r.teaBreakMinutes}
      </td>
      <td className="px-3 py-3 text-xs text-slate-600">
        {r.mandatoryLunchAssumed ? "1h default (no lunch punch)" : "—"}
      </td>
      <td className="px-3 py-3">
        {r.checkOutAt ? (
          r.meetsEightHourWork ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Yes
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">No</span>
          )
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs">
        {r.lunchBreakOpen || r.teaBreakOpen ? (
          <span className="text-amber-800">
            {r.lunchBreakOpen ? "Lunch " : ""}
            {r.teaBreakOpen ? "Tea" : ""}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default function AttendancePage() {
  const { role } = useAuth();
  const isManagerial = role === "super_admin" || role === "admin" || role === "hr";

  const [startDate, setStartDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
  );
  const [endDate, setEndDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
  );
  const [preset, setPreset] = useState<AttendancePreset>("today");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasEmployee, setHasEmployee] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      const url = isManagerial
        ? `/api/attendance/company?${params.toString()}`
        : `/api/attendance/me?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setRows(data.rows ?? []);
      setHasEmployee(data.hasEmployee !== false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isManagerial, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const showDateCol = startDate !== endDate;
  const showEmployeeCols = isManagerial;

  const grouped = useMemo(() => {
    if (!showDateCol) return null;
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const d = String(r.workDate || "").slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, showDateCol]);

  const baseCols = showEmployeeCols ? 11 : 10;
  const colCount = showDateCol ? baseCols + 1 : baseCols;

  const title = isManagerial ? "Company attendance" : "My attendance";
  const description = isManagerial
    ? "Punch sequence: first check in → lunch out → lunch in → final check out. If lunch punches are missing, a mandatory 1 hour lunch is applied for that day (stored on final check out when possible). Active time = gross minus lunch (effective) and tea. Present for payroll when active work is at least 8 hours. Dates use the IST calendar."
    : "Your records for the selected period (IST). Same punch rules as on the dashboard. Use the Dashboard to punch in/out for today.";

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="muted mt-1 max-w-3xl">{description}</p>
      </div>

      {!hasEmployee ? (
        <div className="card border-amber-200/80 bg-amber-50/40">
          <p className="text-sm font-medium text-slate-800">No employee profile linked</p>
          <p className="muted mt-1">
            Your account is not linked to an employee record yet. Ask HR to complete your profile; then your attendance history will appear here.
          </p>
        </div>
      ) : (
        <div className="card border-slate-200/80 shadow-md shadow-slate-200/40">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <AttendanceDateFilter
              startDate={startDate}
              endDate={endDate}
              preset={preset}
              onChange={(next) => {
                setStartDate(next.startDate);
                setEndDate(next.endDate);
                setPreset(next.preset);
              }}
            />
            <button
              type="button"
              className="btn btn-outline shrink-0 rounded-lg px-4 py-2 text-sm font-medium shadow-sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {loading ? (
            <SkeletonTable rows={6} columns={colCount} />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
              <p className="text-sm font-medium text-slate-600">No attendance records for this period.</p>
              <p className="muted mt-1">
                {isManagerial ? "Try another date range or refresh after employees punch." : "Try another date range, or punch in from the Dashboard for today."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-emerald-900/10 bg-gradient-to-r from-emerald-900/[0.07] to-slate-50/80">
                      {showDateCol && (
                        <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                          Date
                        </th>
                      )}
                      {showEmployeeCols && (
                        <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                          Employee
                        </th>
                      )}
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        1. First in
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        2. Lunch out
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        3. Lunch in
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        4. Final out
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        Gross
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        Active
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        Lunch / Tea
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        Lunch note
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        ≥8h
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                        Open break
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!showDateCol &&
                      rows.map((r) => (
                        <AttendanceRow key={r.logId} r={r} showDateCol={false} showEmployeeCols={showEmployeeCols} />
                      ))}
                    {showDateCol &&
                      grouped?.map(([date, dayRows]) => (
                        <Fragment key={date}>
                          <tr className="bg-slate-100/90">
                            <td
                              colSpan={colCount}
                              className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
                            >
                              {formatDayHeading(date)}
                            </td>
                          </tr>
                          {dayRows.map((r) => (
                            <AttendanceRow key={r.logId} r={r} showDateCol={true} showEmployeeCols={showEmployeeCols} />
                          ))}
                        </Fragment>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
