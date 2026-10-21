"use client";

import { useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ToastProvider";

type PeriodOpt = { id: string; label: string; payrollRun?: boolean };
type ExportScope = "all" | "filtered" | "selected";

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
  /**
   * When set (e.g. Run Payroll active division/department/search filters),
   * resolve the matching employee user IDs and restrict the Excel export.
   */
  resolveEmployeeUserIds?: () => Promise<string[]>;
};

/**
 * Download saved employee-payroll snapshots for one month or a custom three-month period.
 * Shared by Payroll Master and Run Payroll.
 */
export function EmployeePayrollExportButton({
  buttonLabel = "Export Employee Payroll",
  disabled = false,
  className,
  resolveEmployeeUserIds,
}: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [periods, setPeriods] = useState<PeriodOpt[]>([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>([]);
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [selectedEmployeeIdsText, setSelectedEmployeeIdsText] = useState("");

  async function openDialog() {
    setOpen(true);
    setLoadingOpts(true);
    try {
      const periodsRes = await fetch("/api/payroll/periods");
      const periodsData = await periodsRes.json();
      if (!periodsRes.ok) {
        throw new Error(periodsData?.error || periodsData?.message || "Failed to load payroll periods");
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

      const defaultPeriod = nextPeriods.find((p) => p.payrollRun)?.id ?? nextPeriods[0]?.id ?? null;
      setSelectedPeriodIds(defaultPeriod ? [defaultPeriod] : []);
      setExportScope("all");
      setSelectedEmployeeIdsText("");
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
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("periodIds", selectedPeriodIds.join(","));
      if (exportScope === "filtered" && resolveEmployeeUserIds) {
        const ids = await resolveEmployeeUserIds();
        if (ids.length === 0) {
          throw new Error("No employees match the current Run Payroll filters.");
        }
        qs.set("employeeUserIds", ids.join(","));
      }
      if (exportScope === "selected") {
        const ids = selectedEmployeeIdsText.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) {
          throw new Error("Enter at least one employee user ID for the selected-employee scope.");
        }
        qs.set("employeeUserIds", [...new Set(ids)].join(","));
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
        description={"One row per employee per saved month. Choose one month, or up to three months for a custom three-month payroll report. All saved employees are included by default."}
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
          <AppPageLoader variant="inline" message="Loading payroll periods..." submessage="" />
        ) : (
          <div className="space-y-5">
            <fieldset>
                <legend className="text-sm font-semibold text-slate-800">Export scope</legend>
                <p className="mt-0.5 text-xs text-slate-500">
                  Audit, search, and pagination never restrict an export unless this filtered scope is selected.
                </p>
                <div className="mt-2 space-y-1 rounded-lg border border-slate-200 p-2 text-sm">
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                    <input type="radio" name="employee-payroll-export-scope" checked={exportScope === "all"} onChange={() => setExportScope("all")} />
                    <span><strong>All employees</strong> — complete saved payroll population.</span>
                  </label>
                  {resolveEmployeeUserIds ? <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                    <input type="radio" name="employee-payroll-export-scope" checked={exportScope === "filtered"} onChange={() => setExportScope("filtered")} />
                    <span>Current filtered results — only search and organisation filters.</span>
                  </label> : null}
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                    <input type="radio" name="employee-payroll-export-scope" checked={exportScope === "selected"} onChange={() => setExportScope("selected")} />
                    <span>Selected employees — enter employee user IDs below.</span>
                  </label>
                </div>
                {exportScope === "selected" ? (
                  <textarea
                    className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
                    aria-label="Selected employee user IDs"
                    placeholder="Employee user IDs, separated by commas or lines"
                    value={selectedEmployeeIdsText}
                    onChange={(event) => setSelectedEmployeeIdsText(event.target.value)}
                  />
                ) : null}
              </fieldset>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Payroll run months{" "}
                <span className="font-normal text-slate-500">({selectedPeriodIds.length}/3)</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Required. Select one month, or up to three months for a custom three-month report.</p>
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

          </div>
        )}
      </Modal>
    </>
  );
}
