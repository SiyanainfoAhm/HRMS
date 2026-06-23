"use client";

import type { ReactNode } from "react";
import { fmtIn } from "./payrollRunPreviewShared";

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
  totals,
  filteredCount,
  totalCount,
  children,
}: Props) {
  return (
    <div className="sticky top-0 z-30 -mx-1 border-b border-slate-200/80 bg-white/90 px-1 py-3 shadow-sm backdrop-blur-md sm:mx-0 sm:rounded-t-xl sm:px-0">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Month</label>
            <select
              value={runMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>
                  {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Year</label>
            <input
              type="number"
              min={2020}
              max={2030}
              value={runYear}
              onChange={(e) => onYearChange(e.target.value)}
              className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {periodName ? <span className="truncate text-base font-semibold text-slate-800">{periodName}</span> : null}
            <button
              type="submit"
              className={`btn btn-primary ${generateDisabled ? "cursor-not-allowed opacity-50" : ""}`}
              disabled={running || generateDisabled}
            >
              {running ? "Generating..." : generateLabel}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Search employee</label>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Name or email…"
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-700">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
              {totals.employees} employee{totals.employees === 1 ? "" : "s"} · {filteredCount} / {totalCount} shown
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-900">
              Σ Gross {fmtIn(totals.gross)}
            </span>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-900">
              Σ Ded {fmtIn(totals.deductions)}
            </span>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-900">
              Σ Net {fmtIn(totals.net)}
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
