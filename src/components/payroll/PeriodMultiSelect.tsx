"use client";

import { useMemo, useState } from "react";
import {
  currentFiscalYearMonths,
  filterPeriods,
  groupByYear,
  lastMonths,
  selectionSummary,
  type ReportPeriod,
} from "@/lib/periodReport";

type Props = {
  periods: ReportPeriod[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/**
 * Searchable, scrollable multi-select of months that have a generated run (month + year, any number,
 * across years) with quick options. Draft-only months are never in `periods`, so they cannot be picked.
 */
export function PeriodMultiSelect({ periods, selected, onChange, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterPeriods(periods, query), [periods, query]);
  const groups = useMemo(() => groupByYear(shown), [shown]);
  const chosen = useMemo(() => new Set(selected), [selected]);

  const toggle = (ym: string) => onChange(chosen.has(ym) ? selected.filter((x) => x !== ym) : [...selected, ym]);
  const addAll = (list: string[]) => onChange([...new Set([...selected, ...list])]);
  const quick = "rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={quick} disabled={disabled} onClick={() => onChange(currentFiscalYearMonths(periods))}>
          This FY
        </button>
        <button type="button" className={quick} disabled={disabled} onClick={() => onChange(lastMonths(periods, 3))}>
          Last 3 months
        </button>
        <button type="button" className={quick} disabled={disabled} onClick={() => addAll(shown.map((p) => p.ym))}>
          {query.trim() ? "Select shown" : "Select all"}
        </button>
        <button type="button" className={quick} disabled={disabled || selected.length === 0} onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <input
        type="search"
        aria-label="Search months"
        placeholder="Search month or year (e.g. Sep 2026)"
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200" role="group" aria-label="Payroll months">
        {periods.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">No generated payroll months yet.</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">No month matches “{query}”.</p>
        ) : (
          groups.map((g) => (
            <div key={g.year}>
              <p className="sticky top-0 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.year}</p>
              {g.periods.map((p) => (
                <label key={p.ym} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={chosen.has(p.ym)} disabled={disabled} onChange={() => toggle(p.ym)} />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {selectionSummary(selected, periods)}
      </p>
    </div>
  );
}
