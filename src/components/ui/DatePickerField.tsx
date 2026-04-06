"use client";

import { dateToYmdIST, istTodayYmd, ymdToNoonIST } from "@/lib/istCalendar";
import { enIN } from "date-fns/locale/en-IN";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatDdMmYyyy(ymd: string): string {
  if (!isYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export type DatePickerFieldProps = {
  value: string;
  onChange: (next: string) => void;
  /** Inclusive min date (YYYY-MM-DD) */
  min?: string;
  /** Inclusive max date (YYYY-MM-DD) */
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  placeholder?: string;
  /** Extra classes on the outer wrapper (e.g. w-full) */
  className?: string;
  /** Show Clear / Today in footer */
  showQuickActions?: boolean;
};

export function DatePickerField({
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  id,
  placeholder = "dd-mm-yyyy",
  className = "",
  showQuickActions = true,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.max(r.width, 288);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = r.bottom + 6;
    const estH = 360;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 6);
    setCoords({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  const selected = value && isYmd(value) ? ymdToNoonIST(value) : undefined;

  const disabledMatcher = (date: Date) => {
    const ymd = dateToYmdIST(date);
    if (min && isYmd(min) && ymd < min) return true;
    if (max && isYmd(max) && ymd > max) return true;
    return false;
  };

  const defaultMonth = selected ?? ymdToNoonIST(istTodayYmd());

  const triggerClass =
    "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm " +
    "focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 " +
    (disabled ? "cursor-not-allowed bg-slate-50 text-slate-500" : "text-slate-900 hover:border-slate-400");

  const panel =
    typeof document !== "undefined" &&
    open &&
    coords &&
    createPortal(
      <div
        ref={panelRef}
        className="rdp-theme fixed z-[9999] max-h-[min(420px,calc(100vh-16px))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/40 ring-1 ring-slate-900/5"
        style={{ top: coords.top, left: coords.left, minWidth: coords.width }}
        role="dialog"
        aria-label="Choose date"
      >
        <div className="flex justify-center">
          <DayPicker
            mode="single"
            locale={enIN}
            selected={selected}
            onSelect={(d) => {
              if (d) onChange(dateToYmdIST(d));
              setOpen(false);
            }}
            disabled={disabledMatcher}
            defaultMonth={defaultMonth}
            showOutsideDays
          />
        </div>
        {showQuickActions && (
          <div className="mt-2 flex items-center justify-center gap-4 border-t border-slate-100 pt-2">
            {!required && (
              <button
                type="button"
                className="text-xs font-medium text-slate-600 hover:text-emerald-800"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="text-xs font-medium text-emerald-700 hover:underline"
              onClick={() => {
                const t = istTodayYmd();
                if (min && t < min) return;
                if (max && t > max) return;
                onChange(t);
                setOpen(false);
              }}
            >
              Today
            </button>
          </div>
        )}
      </div>,
      document.body
    );

  return (
    <div className={`relative w-full ${className}`}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => !disabled && setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className={value ? "tabular-nums" : "text-slate-400"}>{value ? formatDdMmYyyy(value) : placeholder}</span>
        <CalendarIcon className="shrink-0 text-slate-400" />
      </button>
      {panel}
    </div>
  );
}
