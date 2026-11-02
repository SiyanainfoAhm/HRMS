"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { istTodayYmd } from "@/lib/istCalendar";
import {
  MONTH_LONG,
  WEEKDAY_SHORT,
  addDays,
  addMonthsToYmd,
  calendarWeeks,
  checkYmdInRange,
  clampYmd,
  formatDmy,
  isValidYmd,
  maskDmyInput,
  parseDmy,
  rangeMessage,
} from "@/lib/dateInputs";
import { PickerPopover } from "@/components/ui/PickerPopover";

export type DateInputProps = {
  /** "YYYY-MM-DD", or "" when empty (same value contract as the native date input). */
  value: string;
  onChange: (next: string) => void;
  /** Inclusive bounds, "YYYY-MM-DD". */
  min?: string;
  max?: string;
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

const navBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-40";

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function DateInput({
  value, onChange, min, max, disabled, required, optional, placeholder, id, invalid, className, "aria-label": ariaLabel,
}: DateInputProps) {
  const autoId = useId();
  const inputId = id ?? `date-${autoId}`;
  const errId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDmy(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [focusDay, setFocusDay] = useState("");
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const base = isValidYmd(value) ? value : istTodayYmd();
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });
  const today = istTodayYmd();

  // The text mirrors the value unless the user is mid-edit (then it is the draft they are typing).
  const shown = editing ? draft : formatDmy(value);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) inputRef.current?.focus();
  }, []);

  /** Opening shows the selected (or today's) month and puts focus on that day. */
  function openPopup() {
    const base = clampYmd(isValidYmd(value) ? value : today, min, max);
    setView({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });
    setFocusDay(base);
    setOpen(true);
  }

  useEffect(() => {
    if (open && focusDay) dayRefs.current.get(focusDay)?.focus();
  }, [open, focusDay, view]);

  const weeks = useMemo(() => calendarWeeks(view.y, view.m), [view]);

  /** Commits typed text. Returns true when it was accepted (or cleared). */
  function commit(text: string): boolean {
    const parsed = parseDmy(text);
    if (!parsed.ok) {
      if (parsed.reason === "empty") {
        setError("");
        if (required) return false;
        if (value !== "") onChange("");
        return true;
      }
      setError(parsed.reason === "incomplete" ? "Enter the date as DD/MM/YYYY" : "Not a valid date");
      return false;
    }
    const range = checkYmdInRange(parsed.ymd, min, max);
    if (range !== "ok") {
      setError(rangeMessage(range, min, max));
      return false;
    }
    setError("");
    if (parsed.ymd !== value) onChange(parsed.ymd);
    return true;
  }

  function pick(ymd: string) {
    if (checkYmdInRange(ymd, min, max) !== "ok") return;
    setError("");
    setEditing(false);
    setDraft(formatDmy(ymd));
    if (ymd !== value) onChange(ymd);
    close();
  }

  function onDayKey(e: React.KeyboardEvent) {
    const step = (next: string) => {
      e.preventDefault();
      const c = clampYmd(next, min, max);
      setView({ y: Number(c.slice(0, 4)), m: Number(c.slice(5, 7)) });
      setFocusDay(c);
    };
    const f = focusDay;
    switch (e.key) {
      case "ArrowLeft": return step(addDays(f, -1));
      case "ArrowRight": return step(addDays(f, 1));
      case "ArrowUp": return step(addDays(f, -7));
      case "ArrowDown": return step(addDays(f, 7));
      case "Home": return step(addDays(f, -new Date(`${f}T00:00:00Z`).getUTCDay()));
      case "End": return step(addDays(f, 6 - new Date(`${f}T00:00:00Z`).getUTCDay()));
      case "PageUp": return step(addMonthsToYmd(f, e.shiftKey ? -12 : -1));
      case "PageDown": return step(addMonthsToYmd(f, e.shiftKey ? 12 : 1));
    }
  }

  const canClear = Boolean(value) && !required && !disabled;
  const emptyText = placeholder ?? (optional ? "Optional" : "Select date");
  const shift = (delta: number) => {
    const c = clampYmd(addMonthsToYmd(focusDay || `${view.y}-${String(view.m).padStart(2, "0")}-01`, delta), min, max);
    setView({ y: Number(c.slice(0, 4)), m: Number(c.slice(5, 7)) });
    setFocusDay(c);
  };
  const todayDisabled = checkYmdInRange(today, min, max) !== "ok";
  const prevMonthEnd = addDays(`${view.y}-${String(view.m).padStart(2, "0")}-01`, -1);
  const nextMonthStart = addMonthsToYmd(`${view.y}-${String(view.m).padStart(2, "0")}-01`, 1);

  return (
    <div className={cn("relative", className)}>
      <div ref={anchorRef} className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          required={required}
          placeholder={emptyText}
          aria-label={ariaLabel}
          aria-invalid={invalid || Boolean(error) || undefined}
          aria-describedby={error ? errId : undefined}
          maxLength={10}
          value={shown}
          onFocus={() => { setDraft(formatDmy(value)); setEditing(true); }}
          onChange={(e) => {
            const masked = maskDmyInput(e.target.value);
            setDraft(masked);
            setError("");
            // Complete, valid, in-range dates apply immediately; anything else waits for Enter/blur.
            if (masked.length === 10) commit(masked);
          }}
          onBlur={() => {
            const accepted = commit(draft);
            setEditing(false); // rejected text never stays in the field: it falls back to the stored value
            if (!accepted) setDraft(formatDmy(value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (commit(draft)) { e.preventDefault(); } }
            if (e.key === "ArrowDown") { e.preventDefault(); openPopup(); }
          }}
          className={cn(
            "input-field pr-[4.25rem]",
            disabled && "cursor-not-allowed bg-slate-50 text-slate-500",
            (invalid || error) && "border-red-400 focus:border-red-500 focus:ring-red-500/20",
          )}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {canClear ? (
            <button
              type="button"
              aria-label={`Clear ${ariaLabel ?? "date"}`}
              title="Clear"
              onClick={() => { setError(""); setDraft(""); onChange(""); inputRef.current?.focus(); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Open calendar${ariaLabel ? ` for ${ariaLabel}` : ""}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => (open ? close(false) : openPopup())}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarIcon />
          </button>
        </div>
      </div>
      {error ? (
        <p id={errId} role="alert" className="mt-1 text-[11px] text-red-600">{error}</p>
      ) : null}

      <PickerPopover open={open} anchorRef={anchorRef} onClose={() => close(true)} label="Choose date" estimatedHeight={400}>
        <div className="mb-2 flex items-center justify-between gap-1">
          <button type="button" className={navBtn} aria-label="Previous year" onClick={() => shift(-12)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 17l-5-5 5-5M11 17l-5-5 5-5" /></svg>
          </button>
          <button type="button" className={navBtn} aria-label="Previous month" disabled={Boolean(min && prevMonthEnd < min)} onClick={() => shift(-1)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="min-w-0 flex-1 text-center text-sm font-semibold text-slate-800" aria-live="polite">
            {MONTH_LONG[view.m - 1]} {view.y}
          </span>
          <button type="button" className={navBtn} aria-label="Next month" disabled={Boolean(max && nextMonthStart > max)} onClick={() => shift(1)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <button type="button" className={navBtn} aria-label="Next year" onClick={() => shift(12)}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 17l5-5-5-5M13 17l5-5-5-5" /></svg>
          </button>
        </div>
        <div role="grid" aria-label={`${MONTH_LONG[view.m - 1]} ${view.y}`} onKeyDown={onDayKey}>
          <div role="row" className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-500">
            {WEEKDAY_SHORT.map((d) => <span key={d} role="columnheader" className="py-1">{d}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div role="row" key={wi} className="grid grid-cols-7">
              {week.map((ymd, di) => {
                if (!ymd) return <span key={di} role="gridcell" className="h-9" />;
                const out = checkYmdInRange(ymd, min, max);
                const selected = ymd === value;
                return (
                  <button
                    key={ymd}
                    ref={(el) => { if (el) dayRefs.current.set(ymd, el); else dayRefs.current.delete(ymd); }}
                    role="gridcell"
                    type="button"
                    tabIndex={focusDay === ymd ? 0 : -1}
                    aria-selected={selected}
                    disabled={out !== "ok"}
                    title={out !== "ok" ? rangeMessage(out, min, max) : ymd === today ? "Today" : undefined}
                    onClick={() => pick(ymd)}
                    className={cn(
                      "mx-auto h-9 w-9 rounded-full text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
                      selected ? "bg-brand-blue font-semibold text-white" : "text-slate-800 hover:bg-slate-100",
                      ymd === today && !selected && "ring-1 ring-slate-300",
                      out !== "ok" && "cursor-not-allowed text-slate-300 hover:bg-transparent",
                    )}
                  >
                    {Number(ymd.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
          {required ? <span /> : (
            <button type="button" className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => { setError(""); setDraft(""); onChange(""); close(); }}>
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={todayDisabled}
            title={todayDisabled ? rangeMessage(checkYmdInRange(today, min, max), min, max) : undefined}
            className="rounded-lg px-2 py-1 text-sm font-medium text-brand-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            onClick={() => pick(today)}
          >
            Today
          </button>
        </div>
      </PickerPopover>
    </div>
  );
}
