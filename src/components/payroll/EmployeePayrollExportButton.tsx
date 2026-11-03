"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ToastProvider";
import { PeriodMultiSelect } from "@/components/payroll/PeriodMultiSelect";
import { PeriodReportPreview } from "@/components/payroll/PeriodReportPreview";
import { defaultSelection, monthsQuery, type ReportPeriod } from "@/lib/periodReport";

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

/** Lets the Downloads menu open the dialog without rendering the standalone button. */
export type EmployeePayrollExportHandle = { openDialog: () => void };

type Props = {
  /** Hide the standalone button (the Downloads menu opens the dialog through the ref). */
  hideTrigger?: boolean;
  /** Prefer shorter label on Run Payroll toolbar */
  buttonLabel?: string;
  disabled?: boolean;
  className?: string;
  /** The currently selected month ("YYYY-MM"): the default selection when that month was generated. */
  defaultMonth?: string;
  /**
   * When set (e.g. Run Payroll active division/department/search filters),
   * resolve the matching employee user IDs and restrict the Excel export.
   */
  resolveEmployeeUserIds?: () => Promise<string[]>;
};

/**
 * Download saved employee-payroll snapshots for any set of generated months (one row per employee per
 * month, grouped by employee), with an on-screen preview. Shared by Payroll Master and Run Payroll.
 */
export const EmployeePayrollExportButton = forwardRef<EmployeePayrollExportHandle, Props>(function EmployeePayrollExportButton(
  {
    buttonLabel = "Export Employee Payroll",
    disabled = false,
    className,
    resolveEmployeeUserIds,
    defaultMonth = "",
    hideTrigger = false,
  },
  ref,
) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [selectedEmployeeIdsText, setSelectedEmployeeIdsText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIds, setPreviewIds] = useState("");

  async function openDialog() {
    setOpen(true);
    setLoadingOpts(true);
    try {
      const res = await fetch("/api/payroll/export-periods", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to load payroll months");
      const list = (data.periods ?? []) as ReportPeriod[];
      setPeriods(list);
      setSelectedMonths(defaultSelection(list, defaultMonth));
      setExportScope("all");
      setSelectedEmployeeIdsText("");
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Failed to open export");
      setOpen(false);
    } finally {
      setLoadingOpts(false);
    }
  }

  /** Comma-separated employee ids for the chosen scope ("" = everyone). Throws a user-facing message. */
  async function scopeEmployeeIds(): Promise<string> {
    if (exportScope === "filtered" && resolveEmployeeUserIds) {
      const ids = await resolveEmployeeUserIds();
      if (ids.length === 0) throw new Error("No employees match the current Run Payroll filters.");
      return ids.join(",");
    }
    if (exportScope === "selected") {
      const ids = selectedEmployeeIdsText.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) throw new Error("Enter at least one employee user ID for the selected-employee scope.");
      return [...new Set(ids)].join(",");
    }
    return "";
  }

  async function preview() {
    if (selectedMonths.length < 1) {
      showToast("error", "Select at least 1 payroll month.");
      return;
    }
    try {
      setPreviewIds(await scopeEmployeeIds());
      setPreviewOpen(true);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Preview failed");
    }
  }

  async function download() {
    if (selectedMonths.length < 1) {
      showToast("error", "Select at least 1 payroll month.");
      return;
    }
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("months", monthsQuery(selectedMonths));
      const ids = await scopeEmployeeIds();
      if (ids) qs.set("employeeUserIds", ids);
      await downloadFromApi(`/api/payroll/master/export-employee-payroll?${qs.toString()}`, "cirt_employee_payroll.xlsx");
      showToast("success", "Employee payroll Excel downloaded");
      setPreviewOpen(false);
      setOpen(false);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  useImperativeHandle(ref, () => ({ openDialog: () => void openDialog() }));

  return (
    <>
      {hideTrigger ? null : (
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
      )}

      <Modal
        open={open}
        onClose={() => !downloading && setOpen(false)}
        title="Export Employee Payroll Excel"
        description="One row per employee per saved month, grouped by employee with months in order. Pick any generated months; all saved employees are included by default."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" disabled={downloading} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" disabled={loadingOpts || selectedMonths.length < 1} onClick={() => void preview()}>
              Preview
            </Button>
            <Button
              type="button"
              loading={downloading}
              disabled={loadingOpts || selectedMonths.length < 1}
              onClick={() => void download()}
            >
              Download Excel
            </Button>
          </>
        }
      >
        {loadingOpts ? (
          <AppPageLoader variant="inline" message="Loading payroll months..." submessage="" />
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
                {resolveEmployeeUserIds ? (
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                    <input type="radio" name="employee-payroll-export-scope" checked={exportScope === "filtered"} onChange={() => setExportScope("filtered")} />
                    <span>Current filtered results — only search and organisation filters.</span>
                  </label>
                ) : null}
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
              <p className="text-sm font-semibold text-slate-800">Payroll months</p>
              <p className="mb-2 mt-0.5 text-xs text-slate-500">Required. Only months with a generated payroll run can be chosen.</p>
              <PeriodMultiSelect periods={periods} selected={selectedMonths} onChange={setSelectedMonths} />
            </div>
          </div>
        )}
      </Modal>

      <PeriodReportPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="employee-payroll"
        months={selectedMonths}
        employeeUserIds={previewIds}
        downloading={downloading}
        onDownload={() => void download()}
      />
    </>
  );
});
