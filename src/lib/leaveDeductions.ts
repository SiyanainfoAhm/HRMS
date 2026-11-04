/**
 * HPL / EOL salary deductions per the CIRT leave calculation (Ref ADM:Gen:1521).
 *
 * Every leave line is calculated on its own leave month (that month's gross Basic, DA rate in force for
 * that month, calendar days of that month) and the lines are summed. Basic is cut first; DA, HRA and
 * Medical are derived from the Basic cut, never from one combined amount that is split afterwards.
 *
 *  HPL: Basic = ROUND(GBasic x days x 0.5 / dim)   DA = ROUND(Basic cut x DA%)   (HRA, Medical, Transport untouched)
 *  EOL: Basic = ROUND(GBasic x days / dim)         DA = ROUND(Basic cut x DA%)
 *       HRA   = ROUND(Basic cut x HRA%)            Medical = ROUND(Medical x days / dim)   (Transport untouched)
 *
 * Rounding is the project's whole-rupee rule (money.ts), applied once per line.
 */

import { percentOf, proportion, roundMoney, sumMoney } from "./money";

export type LeaveType = "HPL" | "EOL";

/** One leave entry: what kind, which month it is charged against, how many days. */
export type LeaveLine = {
  type: LeaveType;
  month: number;
  year: number;
  days: number;
  /** Gross Basic of the leave month. Missing = not resolved yet (current month uses the run's Basic). */
  grossBasic?: number;
  /** DA % in force for the leave month after revisions. Missing = not resolved yet. */
  daPercent?: number;
  /** Calendar days of the leave month (derived from month/year when absent). */
  daysInMonth?: number;
  warning?: string;
};

export type LeaveCutContext = {
  runMonth: number;
  runYear: number;
  /** The run month's gross Basic, DA %, HRA %, fixed Medical: used for lines of the run month and for unresolved lines. */
  grossBasic: number;
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
};

export type LeaveLineCut = {
  type: LeaveType;
  month: number;
  year: number;
  days: number;
  grossBasic: number;
  daPercent: number;
  daysInMonth: number;
  basic: number;
  da: number;
  hra: number;
  medical: number;
  warning?: string;
};

export type LeaveCutTotals = {
  lines: LeaveLineCut[];
  hplDays: number;
  eolDays: number;
  /** Total taken off Basic / DA / HRA / Medical over all lines. */
  basic: number;
  da: number;
  hra: number;
  medical: number;
  /** HPL adjustment = HPL Basic + DA cut; EOL adjustment = EOL Basic + DA + HRA + Medical cut. */
  hplAdjustment: number;
  eolAdjustment: number;
};

export function daysInMonthOf(year: number, month: number): number {
  const y = Math.max(1, Math.floor(Number(year) || 1));
  const m = Math.min(12, Math.max(1, Math.floor(Number(month) || 1)));
  return new Date(y, m, 0).getDate();
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Why a leave line cannot be saved, or null when it is fine: days must be a whole number from 1 up to the days of
 * its month. Used by the editor (message under the field) and by Save Draft (blocks the save).
 */
export function leaveLineError(line: Pick<LeaveLine, "month" | "year" | "days">): string | null {
  const dim = daysInMonthOf(line.year, line.month);
  const days = Number(line.days);
  if (!Number.isFinite(days) || !(days > 0)) return `Enter days (1–${dim})`;
  if (days > dim) return `At most ${dim} days in ${MONTH_NAMES[line.month - 1] ?? line.month} ${line.year}`;
  return null;
}

/** HPL: half a day's Basic per HPL day. */
export const HPL_DAY_FACTOR = 0.5;

export function computeLeaveLineCut(line: LeaveLine, ctx: LeaveCutContext): LeaveLineCut {
  const month = Math.min(12, Math.max(1, Math.floor(Number(line.month) || ctx.runMonth)));
  const year = Math.floor(Number(line.year) || ctx.runYear);
  const dim = Math.max(1, Math.floor(Number(line.daysInMonth) || daysInMonthOf(year, month)));
  // Leave cannot exceed the days of the month it is charged against.
  const days = Math.min(dim, Math.max(0, Math.floor(Number(line.days) || 0)));
  const isRunMonth = month === ctx.runMonth && year === ctx.runYear;
  const resolved = line.grossBasic != null && line.daPercent != null;
  const grossBasic = Math.max(0, roundMoney(Number(isRunMonth ? ctx.grossBasic : (line.grossBasic ?? ctx.grossBasic)) || 0));
  const daPercent = Number(isRunMonth ? ctx.daPercent : (line.daPercent ?? ctx.daPercent)) || 0;
  const warning = line.warning ?? (!isRunMonth && !resolved
    ? `Basic / DA rate for ${String(month).padStart(2, "0")}/${year} not loaded; the run month's values are used.`
    : undefined);

  const basic = line.type === "HPL"
    ? proportion(grossBasic, days * HPL_DAY_FACTOR, dim)
    : proportion(grossBasic, days, dim);
  const da = percentOf(basic, daPercent);
  const eol = line.type === "EOL";
  return {
    type: line.type, month, year, days, grossBasic, daPercent, daysInMonth: dim,
    basic, da,
    hra: eol ? percentOf(basic, ctx.hraPercent) : 0,
    medical: eol ? proportion(Math.max(0, roundMoney(ctx.medicalFixed)), days, dim) : 0,
    warning,
  };
}

export function computeLeaveCuts(lines: readonly LeaveLine[], ctx: LeaveCutContext): LeaveCutTotals {
  const cuts = lines.filter((l) => (Number(l.days) || 0) > 0).map((l) => computeLeaveLineCut(l, ctx));
  const sum = (pick: (c: LeaveLineCut) => number, type?: LeaveType) =>
    sumMoney(...cuts.filter((c) => !type || c.type === type).map(pick));
  const days = (type: LeaveType) => cuts.filter((c) => c.type === type).reduce((s, c) => s + c.days, 0);
  return {
    lines: cuts,
    hplDays: days("HPL"),
    eolDays: days("EOL"),
    basic: sum((c) => c.basic),
    da: sum((c) => c.da),
    hra: sum((c) => c.hra),
    medical: sum((c) => c.medical),
    hplAdjustment: sum((c) => c.basic + c.da, "HPL"),
    eolAdjustment: sum((c) => c.basic + c.da + c.hra + c.medical, "EOL"),
  };
}

/**
 * The leave lines of a Run Payroll row. A stored `leaveLines` list wins; otherwise the old single-month
 * fields (hplDays + hplReference*, eolDays + eolReference*) become one line each, so rows saved before
 * leave lines existed keep working. Lines with 0 days are dropped.
 */
export function normalizeLeaveLines(
  gr: {
    leaveLines?: readonly LeaveLine[] | null;
    hplDays?: number;
    eolDays?: number;
    hplReferenceMonth?: number;
    hplReferenceYear?: number;
    eolReferenceMonth?: number;
    eolReferenceYear?: number;
    hplReferenceSalary?: { basic: number } | null;
    eolReferenceSalary?: { basic: number } | null;
    hplReferenceDaysInMonth?: number;
    eolReferenceDaysInMonth?: number;
  },
  runMonth: number,
  runYear: number,
): LeaveLine[] {
  if (Array.isArray(gr.leaveLines)) {
    return gr.leaveLines
      .map((l) => ({ ...l, type: (l.type === "EOL" ? "EOL" : "HPL") as LeaveType, days: Math.max(0, Math.floor(Number(l.days) || 0)) }))
      .filter((l) => l.days > 0);
  }
  const out: LeaveLine[] = [];
  const legacy = (type: LeaveType): void => {
    const hpl = type === "HPL";
    const days = Math.max(0, Math.floor(Number(hpl ? gr.hplDays : gr.eolDays) || 0));
    if (days <= 0) return;
    const month = Math.floor(Number(hpl ? gr.hplReferenceMonth : gr.eolReferenceMonth) || runMonth);
    const year = Math.floor(Number(hpl ? gr.hplReferenceYear : gr.eolReferenceYear) || runYear);
    const ref = hpl ? gr.hplReferenceSalary : gr.eolReferenceSalary;
    out.push({
      type, month, year, days,
      ...(ref && Number(ref.basic) > 0 ? { grossBasic: Number(ref.basic) } : {}),
      daysInMonth: Number(hpl ? gr.hplReferenceDaysInMonth : gr.eolReferenceDaysInMonth) || daysInMonthOf(year, month),
    });
  };
  legacy("HPL");
  legacy("EOL");
  return out;
}
