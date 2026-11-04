"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatMoney, sumMoney } from "@/lib/money";
import {
  computeLeaveCuts,
  computeLeaveLineCut,
  daysInMonthOf,
  type LeaveCutContext,
  type LeaveLine,
  type LeaveLineCut,
  type LeaveType,
} from "@/lib/leaveDeductions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const monthLabel = (year: number, month: number) => `${MONTHS[month - 1] ?? "?"} ${year}`;

/** The payroll month and the 12 before it, plus any month a line already uses (older saved rows). */
function monthOptions(runYear: number, runMonth: number, lines: readonly LeaveLine[]) {
  const seen = new Map<string, { year: number; month: number }>();
  for (let back = 0; back <= 12; back++) {
    const idx = runYear * 12 + (runMonth - 1) - back;
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    seen.set(monthKey(year, month), { year, month });
  }
  for (const l of lines) {
    if (l.month >= 1 && l.month <= 12) seen.set(monthKey(l.year, l.month), { year: l.year, month: l.month });
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([value, { year, month }]) => ({ value, label: monthLabel(year, month) }));
}

const money = (n: number) => formatMoney(n);

/** Segmented HPL / EOL toggle. One tab stop (the selected option); arrow keys switch. */
function TypeToggle({ value, onChange, label }: { value: LeaveType; onChange: (t: LeaveType) => void; label: string }) {
  const options: LeaveType[] = ["HPL", "EOL"];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = value === "HPL" ? "EOL" : "HPL";
      onChange(next);
      const group = e.currentTarget.parentElement;
      requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
      {options.map((opt) => {
        const selected = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={onKey}
            className={cn(
              "min-w-[2.6rem] rounded px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              selected ? "bg-violet-700 text-white shadow-sm" : "text-slate-500 hover:text-slate-800",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const fieldLabel = "text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const cutCell = "text-right text-[12px] tabular-nums text-slate-800";
const selectClass = "input-field h-8 w-full min-w-[7.5rem] text-[12px]";
const daysClass = "input-field h-8 w-[76px] text-right text-[12px] tabular-nums";

/**
 * Leave deductions (HPL / EOL) of one Run Payroll row, as a section of the wide area.
 * Each line is one type + month + days. The cut columns are calculated live with the same rules the payroll
 * uses (leaveDeductions.ts); the list is sent back as JSON and the page recalculates the row from it.
 */
export function LeaveLinesEditor({
  lines,
  ctx,
  readOnly,
  manualOverride,
  fallbackTotal,
  onChange,
}: {
  lines: LeaveLine[];
  /** Run month values the cuts are calculated with. Null when the saved row has none (cuts show "—"). */
  ctx: LeaveCutContext | null;
  readOnly?: boolean;
  /** A typed HPL / EOL deduction is in use, so the calculated cuts below are not what is deducted. */
  manualOverride?: boolean;
  /** Total shown when the cuts cannot be calculated (saved rows without payroll inputs). */
  fallbackTotal?: number;
  onChange: (next: LeaveLine[]) => void;
}) {
  const runMonth = ctx?.runMonth ?? new Date().getMonth() + 1;
  const runYear = ctx?.runYear ?? new Date().getFullYear();
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [focusRow, setFocusRow] = useState<number | null>(null);

  // Rows stack into labelled cards when the section is narrow (measured on the section, not the screen).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 680));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (focusRow == null) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-leave-row="${focusRow}"] [role="radio"][tabindex="0"]`)?.focus();
    setFocusRow(null);
  }, [focusRow, lines.length]);

  const update = (index: number, patch: Partial<LeaveLine>) =>
    onChange(
      lines.map((l, i) =>
        i === index
          ? { ...l, ...patch, ...(patch.month != null || patch.year != null ? { grossBasic: undefined, daPercent: undefined, daysInMonth: undefined, warning: undefined } : {}) }
          : l,
      ),
    );
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));
  const add = () => {
    onChange([...lines, { type: "HPL", month: runMonth, year: runYear, days: 1 }]);
    setFocusRow(lines.length);
  };

  const options = monthOptions(runYear, runMonth, lines);
  const dimOf = (l: LeaveLine) => daysInMonthOf(l.year, l.month);
  const error = (l: LeaveLine): string | null => {
    const dim = dimOf(l);
    if (!(l.days > 0)) return `Enter days (1–${dim})`;
    if (l.days > dim) return `At most ${dim} days in ${monthLabel(l.year, l.month)}`;
    return null;
  };
  const dupKey = (l: LeaveLine) => `${l.type}-${monthKey(l.year, l.month)}`;
  const dupCount = new Map<string, number>();
  for (const l of lines) dupCount.set(dupKey(l), (dupCount.get(dupKey(l)) ?? 0) + 1);

  const valid = lines.filter((l) => error(l) == null);
  const cutOf = (l: LeaveLine): LeaveLineCut | null => (ctx && error(l) == null ? computeLeaveLineCut(l, ctx) : null);
  const totals = ctx ? computeLeaveCuts(valid, ctx) : null;
  const totalAmount = totals ? sumMoney(totals.basic, totals.da, totals.hra, totals.medical) : (fallbackTotal ?? 0);

  const dash = <span className="text-slate-300" aria-label="not applicable">—</span>;
  const cuts = (l: LeaveLine) => {
    const c = cutOf(l);
    const hasMedHra = l.type === "EOL";
    return {
      basic: c ? money(c.basic) : dash,
      da: c ? money(c.da) : dash,
      hra: c && hasMedHra ? money(c.hra) : dash,
      medical: c && hasMedHra ? money(c.medical) : dash,
      total: c ? <strong className="font-semibold">{money(sumMoney(c.basic, c.da, c.hra, c.medical))}</strong> : dash,
    };
  };

  const onDaysKey = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Enter" && index === lines.length - 1 && !readOnly) {
      e.preventDefault();
      add();
    }
  };

  const daysInput = (l: LeaveLine, i: number, id: string) => (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={dimOf(l)}
      step={1}
      className={cn(daysClass, error(l) && "border-rose-400 focus:border-rose-500")}
      value={l.days > 0 ? l.days : ""}
      aria-invalid={error(l) ? true : undefined}
      aria-describedby={error(l) ? `${id}-err` : undefined}
      onChange={(e) => update(i, { days: Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))) })}
      onKeyDown={(e) => onDaysKey(e, i)}
    />
  );
  const monthSelect = (l: LeaveLine, i: number, id: string) => (
    <select
      id={id}
      className={selectClass}
      value={monthKey(l.year, l.month)}
      onChange={(e) => {
        const [y, m] = e.target.value.split("-").map(Number);
        update(i, { year: y, month: m });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
  const removeButton = (i: number) => (
    <button
      type="button"
      title="Remove line"
      aria-label="Remove line"
      onClick={() => remove(i)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  );
  const notes = (l: LeaveLine, id: string) => (
    <>
      {error(l) ? <p id={`${id}-err`} className="mt-0.5 text-[10px] text-rose-600">{error(l)}</p> : null}
      {(dupCount.get(dupKey(l)) ?? 0) > 1 ? (
        <p className="mt-0.5 text-[10px] text-amber-700">Duplicate line — combine days?</p>
      ) : null}
      {l.warning ? <p className="mt-0.5 text-[10px] text-amber-700">{l.warning}</p> : null}
    </>
  );
  const basisHint = (l: LeaveLine) => {
    const c = cutOf(l);
    return c ? `Calculated on Basic ${money(c.grossBasic)}, DA ${c.daPercent}%, ${c.daysInMonth} days in ${monthLabel(c.year, c.month)}` : undefined;
  };

  const header = (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-900">Leave deductions (HPL / EOL)</p>
      {manualOverride ? (
        <span
          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
          title="A typed HPL / EOL deduction is used instead of the calculated cuts below."
        >
          Manual override in use
        </span>
      ) : null}
    </div>
  );
  const helper = (
    <p className="mb-1.5 text-[11px] text-slate-500">
      Each line uses its own month&apos;s days. HPL = half day&apos;s Basic + DA; EOL = full day&apos;s Basic + DA + HRA + Medical.
    </p>
  );

  const addButton = readOnly ? null : (
    <Button type="button" variant="secondary" size="sm" onClick={add}>
      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add leave line
    </Button>
  );

  const body =
    lines.length === 0 ? (
      <div className="flex flex-wrap items-center gap-3 py-1">
        <p className="text-[12px] text-slate-500">No leave this month</p>
        {addButton}
      </div>
    ) : (
      <>
        {compact ? (
          <div className="space-y-2">
            {lines.map((l, i) => {
              const id = `leave-${i}`;
              const c = cuts(l);
              return (
                <div key={i} data-leave-row={i} title={basisHint(l)} className="rounded-md border border-slate-200 bg-white p-2">
                  {readOnly ? (
                    <p className="text-[12px] font-medium text-slate-800">{l.type} · {monthLabel(l.year, l.month)} · {l.days} day{l.days === 1 ? "" : "s"}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className={fieldLabel}>Type</p>
                        <TypeToggle value={l.type} onChange={(t) => update(i, { type: t })} label="Leave type" />
                      </div>
                      <div className="flex justify-end">{removeButton(i)}</div>
                      <div>
                        <label htmlFor={`${id}-m`} className={fieldLabel}>Month</label>
                        {monthSelect(l, i, `${id}-m`)}
                      </div>
                      <div>
                        <label htmlFor={`${id}-d`} className={fieldLabel}>Days</label>
                        {daysInput(l, i, `${id}-d`)}
                      </div>
                    </div>
                  )}
                  {notes(l, id)}
                  <dl className="mt-2 grid grid-cols-5 gap-1 text-center">
                    {([["Basic cut", c.basic], ["DA cut", c.da], ["HRA cut", c.hra], ["Medical cut", c.medical], ["Total", c.total]] as const).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                        <dd className="text-[12px] tabular-nums text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        ) : (
          <div role="table" aria-label="Leave lines" className="overflow-x-auto">
            <div
              role="row"
              className="grid min-w-[44rem] grid-cols-[7.5rem_9.5rem_5.5rem_repeat(5,minmax(4.5rem,1fr))_2.25rem] items-end gap-x-2 border-b border-slate-200 pb-1"
            >
              <span role="columnheader" className={fieldLabel}>Type</span>
              <span role="columnheader" className={fieldLabel}>Month</span>
              <span role="columnheader" className={fieldLabel}>Days</span>
              {["Basic cut", "DA cut", "HRA cut", "Medical cut", "Total"].map((h) => (
                <span key={h} role="columnheader" className={cn(fieldLabel, "text-right")}>{h}</span>
              ))}
              <span role="columnheader" className="sr-only">Remove</span>
            </div>
            {lines.map((l, i) => {
              const id = `leave-${i}`;
              const c = cuts(l);
              return (
                <div
                  key={i}
                  role="row"
                  data-leave-row={i}
                  title={basisHint(l)}
                  className="grid min-w-[44rem] grid-cols-[7.5rem_9.5rem_5.5rem_repeat(5,minmax(4.5rem,1fr))_2.25rem] items-start gap-x-2 border-b border-slate-100 py-1.5 last:border-b-0"
                >
                  <div role="cell" className="pt-0.5">
                    {readOnly ? <span className="text-[12px] font-medium">{l.type}</span> : <TypeToggle value={l.type} onChange={(t) => update(i, { type: t })} label="Leave type" />}
                  </div>
                  <div role="cell">
                    {readOnly ? <span className="text-[12px]">{monthLabel(l.year, l.month)}</span> : monthSelect(l, i, `${id}-m`)}
                  </div>
                  <div role="cell">
                    {readOnly ? <span className="text-[12px] tabular-nums">{l.days}</span> : daysInput(l, i, `${id}-d`)}
                  </div>
                  <div role="cell" className={cn(cutCell, "pt-1.5")}>{c.basic}</div>
                  <div role="cell" className={cn(cutCell, "pt-1.5")}>{c.da}</div>
                  <div role="cell" className={cn(cutCell, "pt-1.5")}>{c.hra}</div>
                  <div role="cell" className={cn(cutCell, "pt-1.5")}>{c.medical}</div>
                  <div role="cell" className={cn(cutCell, "pt-1.5")}>{c.total}</div>
                  <div role="cell">{readOnly ? null : removeButton(i)}</div>
                  {error(l) || (dupCount.get(dupKey(l)) ?? 0) > 1 || l.warning ? (
                    <div className="col-span-full mt-0.5 flex flex-wrap gap-x-4 text-[11px]">
                      {error(l) ? <p id={`${id}-d-err`} className="text-rose-600">{error(l)}</p> : null}
                      {(dupCount.get(dupKey(l)) ?? 0) > 1 ? <p className="text-amber-700">Duplicate line — combine days?</p> : null}
                      {l.warning ? <p className="text-amber-700">{l.warning}</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
          {addButton ?? <span />}
          <p className="text-[12px] text-slate-700" data-testid="leave-total">
            <span className="font-semibold text-slate-900">Total leave deduction ₹{money(totalAmount)}</span>
            {totals ? (
              <span className="text-slate-500"> (Basic ₹{money(totals.basic)}, DA ₹{money(totals.da)}, HRA ₹{money(totals.hra)}, Medical ₹{money(totals.medical)})</span>
            ) : null}
          </p>
        </div>
      </>
    );

  return (
    <section ref={rootRef} className="w-full shrink-0 border-t border-slate-100 pt-2.5" aria-label="Leave deductions (HPL / EOL)">
      {header}
      {helper}
      <div className="rounded-lg border border-slate-200/90 bg-white/90 p-2">{body}</div>
    </section>
  );
}
