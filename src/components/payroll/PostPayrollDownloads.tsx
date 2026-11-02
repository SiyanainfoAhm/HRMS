"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MonthInput } from "@/components/ui/MonthInput";
import { reconcileMonthRange } from "@/lib/dateInputs";

/** CIRT-11/12: Post Payroll Downloads. Each report is built from the generated payroll of the chosen month. */
const REPORTS = [
  { type: "tds", title: "TDS Data", note: "One row per employee per month. Choose a range with To month.", range: true },
  { type: "cpf", title: "CPF / VPF Statement", note: "Details of CPF, VPF for the month, with totals.", range: false },
  { type: "division-wise", title: "Division-Wise Salary", note: "Gross salary, employee count and pay-level split by division.", range: false },
  { type: "paybill", title: "Paybill", note: "One row per employee: earnings, deductions, net pay. Includes a print-style sheet.", range: false },
] as const;

function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PostPayrollDownloads() {
  const [month, setMonth] = useState(defaultMonth());
  const [toMonth, setToMonth] = useState("");
  /** Months that have generated payroll; null while loading or if the list cannot be read (then nothing is disabled). */
  const [available, setAvailable] = useState<string[] | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/payroll/post-downloads-months", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.months) || cancelled) return;
        setAvailable(data.months);
        // The default (last month) may not be generated yet: start on the latest month that is, unless the user already chose.
        if (data.months.length > 0 && !touched.current) setMonth((m) => (data.months.includes(m) ? m : data.months[data.months.length - 1]));
      } catch {
        /* leave every month selectable; the download reports a missing month itself */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function changeMonth(next: string) {
    touched.current = true;
    const r = reconcileMonthRange({ from: next, to: toMonth });
    setMonth(r.from);
    setToMonth(r.to);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(type: string, range: boolean) {
    setBusy(type);
    setError(null);
    try {
      const [y, m] = month.split("-");
      const p = new URLSearchParams({ year: y, month: String(Number(m)) });
      if (range && toMonth) {
        const [ty, tm] = toMonth.split("-");
        p.set("to_year", ty);
        p.set("to_month", String(Number(tm)));
      }
      const res = await fetch(`/api/payroll/post-downloads/${type}?${p}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || "Could not create the file.");
      }
      const blob = await res.blob();
      const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${type}_${y}${m}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-5 pb-6">
      <PageHeader title="Post Payroll Downloads" description="Excel files for a generated payroll month." className="!mb-0" />
      <div className="card space-y-4 !p-4 sm:!p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="label-field">Month</span>
            <MonthInput aria-label="Month" required value={month} available={available} unavailableReason="No payroll generated" onChange={changeMonth} className="w-44" />
          </div>
          <div>
            <span className="label-field">To month (TDS only, optional)</span>
            <MonthInput aria-label="To month" optional value={toMonth} min={month || undefined} available={available} unavailableReason="No payroll generated" onChange={(v) => setToMonth(reconcileMonthRange({ from: month, to: v }).to)} className="w-44" />
          </div>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((r) => (
            <div key={r.type} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{r.title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{r.note}</p>
              </div>
              <Button type="button" loading={busy === r.type} disabled={busy !== null || !month} onClick={() => void download(r.type, r.range)}>
                <Download className="mr-1.5 h-4 w-4" />Excel
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
