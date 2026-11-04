"use client";

import { useEffect, useMemo, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  periodReportPreviewUrl,
  previewCell,
  type PeriodReportPreviewData,
  type PeriodReportType,
} from "@/lib/periodReport";

type Props = {
  open: boolean;
  onClose: () => void;
  type: PeriodReportType;
  months: string[];
  /** Comma-separated employee user ids (Export Employee Payroll scope). */
  employeeUserIds?: string;
  onDownload: () => void;
  downloading?: boolean;
};

/** On-screen preview of exactly what the Excel will contain (same server query, same totals row). */
export function PeriodReportPreview({ open, onClose, type, months, employeeUserIds, onDownload, downloading = false }: Props) {
  const [data, setData] = useState<PeriodReportPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = months.join(",");

  useEffect(() => {
    if (!open || months.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      try {
        const res = await fetch(periodReportPreviewUrl(type, months, employeeUserIds), { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message || body?.error || "Could not build the preview.");
        if (!cancelled) setData(body as PeriodReportPreviewData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not build the preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, type, employeeUserIds]);

  const money = useMemo(() => new Set(data?.moneyColumns ?? []), [data]);
  const title = type === "tds" ? "TDS Data preview" : type === "division-wise" ? "Division-Wise Salary preview" : "Employee Payroll preview";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={data ? `${data.rowCount} rows · ${data.months.length} month${data.months.length === 1 ? "" : "s"} · grouped by employee, months in order` : undefined}
      size="2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" loading={downloading} disabled={!data || data.rowCount === 0} onClick={onDownload}>
            Download Excel
          </Button>
        </>
      }
    >
      {loading ? <AppPageLoader variant="inline" message="Building preview..." submessage="" /> : null}
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {data && data.rowCount === 0 ? <p className="text-sm text-slate-500">No payroll rows for the selected months.</p> : null}
      {data && data.rowCount > 0 ? (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                {data.headers.map((h, i) => (
                  <th key={`${h}-${i}`} className={`whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold text-slate-700 ${money.has(i) ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/50">
                  {r.map((v, ci) => (
                    <td key={ci} className={`whitespace-nowrap px-2 py-1 tabular-nums ${money.has(ci) ? "text-right" : ""}`}>
                      {previewCell(v, money.has(ci))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
              <tr>
                {data.totals.map((v, ci) => (
                  <td key={ci} className={`whitespace-nowrap border-t border-slate-300 px-2 py-1.5 tabular-nums ${money.has(ci) ? "text-right" : ""}`}>
                    {previewCell(v, money.has(ci))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}
