"use client";

import { useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ToastProvider";

type PeriodOpt = { id: string; label: string; payrollRun?: boolean };
type QuarterOpt = { id: string; label: string };

async function downloadFromApi(path: string, fallbackName: string) {
  const res = await fetch(path);
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    if (contentType.includes("application/json")) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || err?.message || "Download failed");
    }
    const text = await res.text().catch(() => "");
    throw new Error(text || "Download failed");
  }
  if (contentType.includes("application/json")) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.message || "Download failed");
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition");
  const match = cd?.match(/filename="?([^";\n]+)"?/i);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  /** Prefer shorter label on Run Payroll toolbar */
  buttonLabel?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Download employee + payroll Excel with 1–3 run months and optional ≤3 quarters.
 * Shared by Payroll Master and Run Payroll.
 */
export function EmployeePayrollExportButton({
  buttonLabel = "Export Employee Payroll",
  disabled = false,
  className,
}: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [periods, setPeriods] = useState<PeriodOpt[]>([]);
  const [quarters, setQuarters] = useState<QuarterOpt[]>([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>([]);
  const [selectedQuarterIds, setSelectedQuarterIds] = useState<string[]>([]);

  async function openDialog() {
    setOpen(true);
    setLoadingOpts(true);
    try {
      const [periodsRes, quartersRes] = await Promise.all([
        fetch("/api/payroll/periods"),
        fetch("/api/settings/quarters"),
      ]);
      const periodsData = await periodsRes.json();
      const quartersData = await quartersRes.json();
      if (!periodsRes.ok) {
        throw new Error(periodsData?.error || periodsData?.message || "Failed to load payroll periods");
      }
      if (!quartersRes.ok) {
        throw new Error(quartersData?.error || quartersData?.message || "Failed to load quarters");
      }

      const nextPeriods = ((periodsData.periods ?? []) as Array<Record<string, unknown>>)
        .map((p) => {
          const id = String(p.id ?? "");
          const name = String(p.period_name ?? p.periodName ?? "").trim();
          const start = String(p.period_start ?? p.periodStart ?? "").slice(0, 10);
          return {
            id,
            label: name || start || id,
            payrollRun: Boolean(p.payroll_run ?? p.payrollRun),
          };
        })
        .filter((p) => p.id);
      setPeriods(nextPeriods);

      const nextQuarters = ((quartersData.quarters ?? []) as Array<Record<string, unknown>>)
        .map((q) => {
          const id = String(q.id ?? "");
          const name = String(q.quarterName ?? q.quarter_name ?? "").trim();
          const type = String(q.quarterType ?? q.quarter_type ?? "").trim();
          return { id, label: type ? `${name} (${type})` : name || id };
        })
        .filter((q) => q.id);
      setQuarters(nextQuarters);

      const defaultPeriod = nextPeriods.find((p) => p.payrollRun)?.id ?? nextPeriods[0]?.id ?? null;
      setSelectedPeriodIds(defaultPeriod ? [defaultPeriod] : []);
      setSelectedQuarterIds([]);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Failed to open export");
      setOpen(false);
    } finally {
      setLoadingOpts(false);
    }
  }

  function toggle(
    id: string,
    selected: string[],
    setSelected: (next: string[]) => void,
    max: number,
    label: string,
  ) {
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
      return;
    }
    if (selected.length >= max) {
      showToast("error", `Select at most ${max} ${label}.`);
      return;
    }
    setSelected([...selected, id]);
  }

  async function download() {
    if (selectedPeriodIds.length < 1) {
      showToast("error", "Select at least 1 payroll run month.");
      return;
    }
    if (selectedPeriodIds.length > 3) {
      showToast("error", "Select at most 3 payroll run months.");
      return;
    }
    if (selectedQuarterIds.length > 3) {
      showToast("error", "Select at most 3 quarters.");
      return;
    }
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("periodIds", selectedPeriodIds.join(","));
      if (selectedQuarterIds.length > 0) {
        qs.set("quarterIds", selectedQuarterIds.join(","));
      }
      await downloadFromApi(
        `/api/payroll/master/export-employee-payroll?${qs.toString()}`,
        "cirt_employee_payroll_export.xlsx",
      );
      showToast("success", "Employee payroll Excel downloaded");
      setOpen(false);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        disabled={disabled || downloading}
        loading={downloading}
        onClick={() => void openDialog()}
      >
        {buttonLabel}
      </Button>

      <Modal
        open={open}
        onClose={() => !downloading && setOpen(false)}
        title="Export Employee Payroll Excel"
        description="One row per employee per selected month (long format). Month-specific amounts come from generated payroll. Choose 1–3 run months. Optionally filter by up to 3 quarters."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" disabled={downloading} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={downloading}
              disabled={loadingOpts || selectedPeriodIds.length < 1}
              onClick={() => void download()}
            >
              Download Excel
            </Button>
          </>
        }
      >
        {loadingOpts ? (
          <AppPageLoader variant="inline" message="Loading periods and quarters..." submessage="" />
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Payroll run months{" "}
                <span className="font-normal text-slate-500">({selectedPeriodIds.length}/3)</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Required. Select 1 to 3 months (e.g. last month).</p>
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {periods.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-slate-500">No payroll periods found.</p>
                ) : (
                  periods.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPeriodIds.includes(p.id)}
                        onChange={() =>
                          toggle(p.id, selectedPeriodIds, setSelectedPeriodIds, 3, "payroll run months")
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{p.label}</span>
                      {p.payrollRun ? (
                        <Badge tone="success" className="shrink-0">
                          Run
                        </Badge>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">
                Quarters{" "}
                <span className="font-normal text-slate-500">
                  ({selectedQuarterIds.length}/3, optional)
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Optional filter. Leave empty for all employees; or pick 1–3 quarters.
              </p>
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {quarters.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-slate-500">No quarters found.</p>
                ) : (
                  quarters.map((q) => (
                    <label
                      key={q.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedQuarterIds.includes(q.id)}
                        onChange={() =>
                          toggle(q.id, selectedQuarterIds, setSelectedQuarterIds, 3, "quarters")
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{q.label}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
