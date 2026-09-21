"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { fmtIn } from "./payrollRunPreviewShared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BANK_LETTER_FORMAT_OPTIONS = [
  { value: "docx", label: "Word (.docx)" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "pdf", label: "PDF (.pdf)" },
] as const;

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
  const [bankLetterFormat, setBankLetterFormat] = useState<BankLetterFormat>("docx");

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
              <div className="inline-flex flex-wrap items-end gap-1.5">
                <SelectField
                  label="Bank Letter"
                  value={bankLetterFormat}
                  onChange={(v) => setBankLetterFormat(v as BankLetterFormat)}
                  options={[...BANK_LETTER_FORMAT_OPTIONS]}
                  disabled={running || exportDisabled || bankLetterLoading}
                  className="w-40"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={bankLetterLoading}
                  disabled={running || exportDisabled || bankLetterLoading}
                  onClick={() => onDownloadBankLetter(bankLetterFormat)}
                  title="Download bank letter in the selected format"
                  aria-label="Download Bank Letter"
                >
                  Download
                </Button>
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
