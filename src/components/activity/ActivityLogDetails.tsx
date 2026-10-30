"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { actionLabel, auditChanges, safeValue, type AuditRecord } from "./activityLogPresentation";

type Props = { event: AuditRecord | null; onClose: () => void };

export function ActivityLogDetails({ event, onClose }: Props) {
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(event));
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  useEffect(() => {
    if (!event) return;
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setError(null);
    void fetch(`/api/activity-logs/${encodeURIComponent(event.eventId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || "Could not load event details.");
        setDetail(body.event as AuditRecord);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load event details.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [event]);

  const changes = detail ? auditChanges(detail, showUnchanged) : [];

  return (
    <Modal open={Boolean(event)} onClose={onClose} title={detail ? actionLabel(detail.action, detail.outcome) : "Activity details"} size="xl">
      {loading ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading event details...</div> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {detail && !loading ? (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Changed Fields</h3>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              Show unchanged fields
            </label>
          </div>
          {changes.length ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Payroll Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th><th className="px-3 py-2">Difference</th></tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.field} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">{change.label}</td>
                      <td className="px-3 py-2 text-slate-600">{safeValue(change.before, change.field)}</td>
                      <td className="px-3 py-2 text-slate-800">{safeValue(change.after, change.field)}</td>
                      <td className={`px-3 py-2 font-medium ${change.difference === undefined || change.difference === 0 ? "text-slate-500" : "text-slate-700"}`}>
                        {change.difference === undefined ? "—" : change.difference === 0 ? "0" : `${change.difference > 0 ? "+" : "−"}${safeValue(Math.abs(change.difference), change.field)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No field comparison is available for this event.</p>}
        </section>
      ) : null}
    </Modal>
  );
}
