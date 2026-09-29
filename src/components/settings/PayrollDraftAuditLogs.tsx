"use client";

import { useEffect, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";

type AuditLog = {
  id: string;
  action: string;
  payrollMonth: number;
  payrollYear: number;
  employeeCount: number;
  performedBy: string;
  performedAt: string | null;
};

export function PayrollDraftAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/payroll/drafts/audits");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load audit logs");
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audit logs");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Payroll Draft Audit Logs</h2>
        <p className="mt-1 text-sm text-slate-600">History of deleted or reset Run Payroll drafts.</p>
      </div>
      {loading ? <AppPageLoader variant="inline" message="Loading audit logs..." submessage="" /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!loading && !error && logs.length === 0 ? <p className="text-sm text-slate-500">No draft reset history yet.</p> : null}
      {!loading && logs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr><th className="px-2 py-2">Action</th><th className="px-2 py-2">Period</th><th className="px-2 py-2">Employees</th><th className="px-2 py-2">Performed by</th><th className="px-2 py-2">Timestamp</th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium capitalize">{log.action}</td>
                  <td className="px-2 py-2">{String(log.payrollMonth).padStart(2, "0")}/{log.payrollYear}</td>
                  <td className="px-2 py-2 tabular-nums">{log.employeeCount}</td>
                  <td className="px-2 py-2">{log.performedBy}</td>
                  <td className="px-2 py-2">{log.performedAt ? new Date(log.performedAt).toLocaleString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
