"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { istTodayYmd } from "@/lib/istCalendar";
import {
  MAX_YEAR,
  MIN_YEAR,
  MONTH_SHORT,
  formatMonthLabel,
  isValidYm,
  makeYm,
  monthDisabledReason,
  type MonthRules,
} from "@/lib/dateInputs";
import { PickerPopover } from "@/components/ui/PickerPopover";

export type MonthInputProps = {
  /** "YYYY-MM", or "" when empty (same value contract as the native month input). */
  value: string;
  onChange: (next: string) => void;
  /** Inclusive bounds, "YYYY-MM". */
  min?: string;
  max?: string;
  /** Only these months can be picked (e.g. months that have generated payroll). Others are disabled with a reason. */
  available?: readonly string[] | null;
  unavailableReason?: string;
  disabled?: boolean;
  required?: boolean;
  /** Optional field: shows "Optional" as the placeholder. */
  optional?: boolean;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  invalid?: boolean;
  className?: string;
};

function CalendarIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

const navBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-40";

export function MonthInput({
  value, onChange, min, max, available, unavailableReason, disabled, required, optional, placeholder, id, invalid, className,
  "aria-label": ariaLabel,
}: MonthInputProps) {
  const autoId = useId();
  const triggerId = id ?? `month-${autoId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const todayYm = istTodayYmd().slice(0, 7);
  const [year, setYear] = useState(() => Number((isValidYm(value) ? value : todayYm).slice(0, 4)));
  const [active, setActive] = useState(0);

  const rules: MonthRules = useMemo(() => ({ min, max, available, unavailableReason }), [min, max, available, unavailableReason]);
  const reasonFor = useCallback((ym: string) => monthDisabledReason(ym, rules), [rules]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /** Opening shows the selected (or current) year and puts focus on that month. */
  function openPopup() {
    const base = isValidYm(value) ? value : todayYm;
    setYear(Number(base.slice(0, 4)));
    setActive(Number(base.slice(5, 7)) - 1);
    setOpen(true);
  }

  useEffect(() => {
    if (open) cellRefs.current[active]?.focus();
  }, [open, active, year]);

  const label = formatMonthLabel(value);
  const emptyText = placeholder ?? (optional ? "Optional" : "Select month");
  const canClear = Boolean(value) && !required && !disabled;
  const minYear = Math.max(MIN_YEAR, min && isValidYm(min) ? Number(min.slice(0, 4)) : MIN_YEAR);
  const maxYear = Math.min(MAX_YEAR, max && isValidYm(max) ? Number(max.slice(0, 4)) : MAX_YEAR);

  function pick(ym: string) {
    if (reasonFor(ym)) return;
    onChange(ym);
    close();
  }

  function onGridKey(e: React.KeyboardEvent) {
    const move = (to: number) => {
      e.preventDefault();
      if (to < 0) { if (year > minYear) { setYear(year - 1); setActive(12 + to); } return; }
      if (to > 11) { if (year < maxYear) { setYear(year + 1); setActive(to - 12); } return; }
      setActive(to);
    };
    switch (e.key) {
      case "ArrowLeft": return move(active - 1);
      case "ArrowRight": return move(active + 1);
      case "ArrowUp": return move(active - 4);
      case "ArrowDown": return move(active + 4);
      case "Home": return move(active - (active % 4));
      case "End": return move(active - (active % 4) + 3);
      case "PageUp": e.preventDefault(); if (year > minYear) setYear(year - 1); return;
      case "PageDown": e.preventDefault(); if (year < maxYear) setYear(year + 1); return;
    }
  }

  const todayReason = reasonFor(todayYm);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${label || emptyText}` : undefined}
        data-invalid={invalid || undefined}
        onClick={() => (open ? close(false) : openPopup())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); openPopup(); }
        }}
        className={cn(
          "input-field flex items-center justify-between gap-2 text-left",
          canClear ? "pr-16" : "pr-3",
          disabled ? "cursor-not-allowed bg-slate-50 text-slate-500" : "hover:border-slate-400",
          invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/20",
        )}
      >
        <span className={cn("truncate", !label && "text-slate-400")}>{label || emptyText}</span>
        {canClear ? null : <CalendarIcon />}
      </button>
      {canClear ? (
        <>
          <button
            type="button"
            aria-label={`Clear ${ariaLabel ?? "month"}`}
            title="Clear"
            onClick={() => { onChange(""); triggerRef.current?.focus(); }}
            className="absolute right-8 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"><CalendarIcon /></span>
        </>
      ) : null}

      <PickerPopover open={open} anchorRef={triggerRef} onClose={() => close(true)} label="Choose month" estimatedHeight={300}>
        <div className="mb-2 flex items-center justify-between">
          <button type="button" className={navBtn} aria-label="Previous year" disabled={year <= minYear} onClick={() => setYear(year - 1)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-sm font-semibold tabular-nums text-slate-800" aria-live="polite">{year}</span>
          <button type="button" className={navBtn} aria-label="Next year" disabled={year >= maxYear} onClick={() => setYear(year + 1)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
        <div role="group" aria-label={`Months of ${year}`} className="grid grid-cols-4 gap-1.5" onKeyDown={onGridKey}>
          {MONTH_SHORT.map((name, i) => {
            const ym = makeYm(year, i + 1);
            const reason = reasonFor(ym);
            const selected = ym === value;
            return (
              <button
                key={ym}
                ref={(el) => { cellRefs.current[i] = el; }}
                type="button"
                tabIndex={active === i ? 0 : -1}
                aria-pressed={selected}
                aria-disabled={reason ? true : undefined}
                disabled={Boolean(reason)}
                title={reason ?? (ym === todayYm ? "This month" : undefined)}
                onClick={() => pick(ym)}
                className={cn(
                  "h-10 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
                  reason
                    ? "cursor-not-allowed text-slate-300"
                    : selected
                      ? "bg-brand-blue text-white"
                      : "text-slate-800 hover:bg-slate-100",
                  ym === todayYm && !selected && !reason && "ring-1 ring-slate-300",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
          {required ? <span /> : (
            <button type="button" className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => { onChange(""); close(); }}>
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={Boolean(todayReason)}
            title={todayReason ?? undefined}
            className="rounded-lg px-2 py-1 text-sm font-medium text-brand-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            onClick={() => pick(todayYm)}
          >
            This month
          </button>
        </div>
      </PickerPopover>
    </div>
  );
}
