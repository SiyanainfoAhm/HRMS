"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileSpreadsheet, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { cn } from "@/lib/cn";
import { fmtIn } from "./payrollRunPreviewShared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BANK_LETTER_FORMAT_OPTIONS = [
  {
    value: "docx" as const,
    label: "Word document",
    hint: ".docx · HDFC letter template",
    Icon: FileText,
  },
  {
    value: "xlsx" as const,
    label: "Excel workbook",
    hint: ".xlsx · employee salary table",
    Icon: FileSpreadsheet,
  },
  {
    value: "pdf" as const,
    label: "PDF letter",
    hint: ".pdf · printable advice",
    Icon: FileText,
  },
];

type BankLetterFormat = (typeof BANK_LETTER_FORMAT_OPTIONS)[number]["value"];

type Totals = {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
};

export type PayrollRunStatusKind = "calculated" | "unsaved" | "draft" | "finalized" | "audit";

type Props = {
  runMonth: string;
  runYear: string;
  onMonthChange: (v: string) => void;
  onYearChange: (v: string) => void;
  periodName?: string;
  running: boolean;
  generateDisabled: boolean;
  generateLabel: string;
  showGenerate?: boolean;
  extraActions?: ReactNode;
  search: string;
  onSearchChange: (v: string) => void;
  divisionFilter: string;
  onDivisionFilterChange: (v: string) => void;
  divisionOptions: { value: string; label: string }[];
  departmentFilter: string;
  onDepartmentFilterChange: (v: string) => void;
  departmentOptions: { value: string; label: string }[];
  orgFiltersLoading?: boolean;
  totals: Totals;
  filteredCount: number;
  totalCount: number;
  statusKind?: PayrollRunStatusKind;
  statusLabel?: string;
  draftSaving?: boolean;
  saveDraftDisabled?: boolean;
  onSaveDraft?: () => void;
  onResetDraft?: () => void;
  onDownloadPreviewExcel?: () => void;
  onExportMonthlySummary?: () => void;
  onDownloadBankLetter?: (format: BankLetterFormat) => void;
  /** Extra download control (e.g. employee+payroll Excel with month/quarter pickers). */
  employeePayrollExportSlot?: ReactNode;
  bankLetterLoading?: boolean;
  exportDisabled?: boolean;
  resetDisabled?: boolean;
  children?: ReactNode;
};

export function PayrollPreviewToolbar({
  runMonth,
  runYear,
  onMonthChange,
  onYearChange,
  periodName,
  running,
  generateDisabled,
  generateLabel,
  showGenerate = true,
  extraActions,
  search,
  onSearchChange,
  divisionFilter,
  onDivisionFilterChange,
  divisionOptions,
  departmentFilter,
  onDepartmentFilterChange,
  departmentOptions,
  orgFiltersLoading,
  totals,
  filteredCount,
  totalCount,
  statusKind = "calculated",
  statusLabel,
  draftSaving,
  saveDraftDisabled,
  onSaveDraft,
  onResetDraft,
  onDownloadPreviewExcel,
  onExportMonthlySummary,
  onDownloadBankLetter,
  employeePayrollExportSlot,
  bankLetterLoading,
  exportDisabled,
  resetDisabled,
  children,
}: Props) {
  const [bankLetterOpen, setBankLetterOpen] = useState(false);
  const bankLetterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bankLetterOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!bankLetterRef.current?.contains(e.target as Node)) {
        setBankLetterOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBankLetterOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bankLetterOpen]);

  const monthOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
    value: String(m).padStart(2, "0"),
    label: MONTHS[m - 1],
  }));

  const statusClass =
    statusKind === "audit"
      ? "bg-violet-50 text-violet-950"
      : statusKind === "finalized"
      ? "bg-emerald-50 text-emerald-900"
      : statusKind === "unsaved"
        ? "bg-amber-50 text-amber-950"
        : statusKind === "draft"
          ? "bg-sky-50 text-sky-900"
          : "bg-slate-100 text-slate-700";

  const bankLetterDisabled = running || exportDisabled || bankLetterLoading;

  return (
    <div className="shrink-0 border-b border-brand-border bg-white px-3 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label="Month" value={runMonth} onChange={onMonthChange} options={monthOptions} className="w-28" />
          <div>
            <label className="label-field mb-1 text-[11px]">Year</label>
            <input
              type="number"
              min={2020}
              max={2030}
              value={runYear}
              onChange={(e) => onYearChange(e.target.value)}
              className="input-field w-24"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {periodName ? <span className="truncate text-[13px] font-semibold text-slate-800">{periodName}</span> : null}
            {showGenerate ? (
              <Button type="submit" size="sm" loading={running} disabled={running || generateDisabled || draftSaving}>
                {generateLabel}
              </Button>
            ) : null}
            {extraActions}
            {onSaveDraft ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={draftSaving}
                disabled={running || draftSaving || saveDraftDisabled}
                onClick={onSaveDraft}
              >
                Save Draft
              </Button>
            ) : null}
            {onDownloadPreviewExcel ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={running || exportDisabled}
                onClick={onDownloadPreviewExcel}
              >
                Download Preview Excel
              </Button>
            ) : null}
            {onExportMonthlySummary ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={running || exportDisabled}
                onClick={onExportMonthlySummary}
                title="Extract Monthly Payroll Summary"
                aria-label="Extract Monthly Payroll Summary"
              >
                Extract
              </Button>
            ) : null}
            {onDownloadBankLetter ? (
              <div className="relative" ref={bankLetterRef}>
                <button
                  type="button"
                  disabled={bankLetterDisabled}
                  onClick={() => setBankLetterOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={bankLetterOpen}
                  title="Download bank letter"
                  className={cn(
                    "btn btn-outline btn-sm !rounded-lg inline-flex items-center gap-1.5",
                    bankLetterDisabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {bankLetterLoading ? (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  ) : null}
                  Bank Letter
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-slate-500 transition-transform duration-150",
                      bankLetterOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {bankLetterOpen && !bankLetterDisabled ? (
                  <div
                    role="menu"
                    aria-label="Bank letter format"
                    className="absolute left-0 top-[calc(100%+6px)] z-[90] w-64 overflow-hidden rounded-xl border border-slate-200/90 bg-white py-1.5 shadow-[0_12px_28px_-8px_rgba(15,23,42,0.18)] ring-1 ring-black/5"
                  >
                    <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Choose format
                    </p>
                    {BANK_LETTER_FORMAT_OPTIONS.map(({ value, label, hint, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                        onClick={() => {
                          setBankLetterOpen(false);
                          onDownloadBankLetter(value);
                        }}
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-slate-800">{label}</span>
                          <span className="block text-[11px] text-slate-500">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {employeePayrollExportSlot}
            {onResetDraft ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={running || draftSaving || resetDisabled}
                onClick={onResetDraft}
              >
                Reset to Calculation
              </Button>
            ) : null}
          </div>
        </div>

        {statusLabel ? (
          <p className={`w-fit rounded-md px-2.5 py-1 text-[12px] font-medium ${statusClass}`}>{statusLabel}</p>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Division"
            value={divisionFilter}
            onChange={onDivisionFilterChange}
            options={divisionOptions}
            loading={orgFiltersLoading}
            placeholder="All divisions"
            searchable
            className="w-44"
          />
          <SelectField
            label="Department"
            value={departmentFilter}
            onChange={onDepartmentFilterChange}
            options={departmentOptions}
            loading={orgFiltersLoading}
            placeholder={divisionFilter ? "All in division" : "All departments"}
            searchable
            className="w-48"
          />
          <div className="relative min-w-[180px] flex-1 max-w-md">
            <label className="label-field">Employee</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search employee…"
                className="input-field w-full pl-8"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="metric-chip bg-slate-100 text-slate-700">
              {filteredCount}/{totalCount} · {totals.employees} emp
            </span>
            <span className="metric-chip bg-emerald-50 text-emerald-900">Gross {fmtIn(totals.gross)}</span>
            <span className="metric-chip bg-rose-50 text-rose-900">Ded {fmtIn(totals.deductions)}</span>
            <span className="metric-chip bg-sky-50 font-semibold text-sky-900">Net {fmtIn(totals.net)}</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
