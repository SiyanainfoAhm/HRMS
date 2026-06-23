"use client";

import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { fmtIn } from "./payrollRunPreviewShared";

type Props = {
  displayName: string;
  email?: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  gross: number;
  deductions: number;
  net: number;
  showScrollButtons: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
  onResetScroll: () => void;
};

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900";

export function PayrollEmployeeCardHeader({
  displayName,
  email,
  expanded,
  onToggleExpand,
  gross,
  deductions,
  net,
  showScrollButtons,
  onScrollLeft,
  onScrollRight,
  onResetScroll,
}: Props) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4 sm:py-2.5">
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-slate-900 hover:text-sky-800"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        )}
        <span className="truncate" title={email || undefined}>
          {displayName}
        </span>
      </button>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums text-slate-600">
        <span>
          Gross <span className="font-medium text-slate-800">{fmtIn(gross)}</span>
        </span>
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <span>
          Ded <span className="font-medium text-slate-800">{fmtIn(deductions)}</span>
        </span>
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <span>
          Net <span className="font-semibold text-slate-900">{fmtIn(net)}</span>
        </span>
      </div>

      {showScrollButtons ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={onScrollLeft} className={iconBtn} aria-label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={onScrollRight} className={iconBtn} aria-label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onResetScroll}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 shadow-sm hover:bg-slate-50"
            aria-label="Reset scroll position"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      ) : null}
    </header>
  );
}
