"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { fmtIn } from "./payrollRunPreviewShared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Totals = {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
};

type Props = {
  runMonth: string;
  runYear: string;
  onMonthChange: (v: string) => void;
  onYearChange: (v: string) => void;
  periodName?: string;
  running: boolean;
  generateDisabled: boolean;
  generateLabel: string;
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
  children,
}: Props) {
  const monthOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
    value: String(m).padStart(2, "0"),
    label: MONTHS[m - 1],
  }));

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
            <Button type="submit" size="sm" loading={running} disabled={running || generateDisabled}>
              {generateLabel}
            </Button>
          </div>
        </div>

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
