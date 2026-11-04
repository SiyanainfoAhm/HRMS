"use client";

import { formatMoney, roundMoney } from "@/lib/money";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { ReactNode } from "react";
import type { GovernmentPreviewMonthly } from "./GovernmentRunPreviewTable";
import { PAYROLL_LABELS } from "@/lib/payrollLabels";

import {
  RUN_PAYROLL_CPF_ARREAR_LINE,
  RUN_PAYROLL_DEDUCTION_LINES,
  RUN_PAYROLL_EARNING_LINES,
  type RunPayrollLine,
} from "@/lib/runPayrollFields";

/** The field lists live in lib/runPayrollFields so the Excel export is built from the very same configuration. */
export type GovPreviewLine<K> = RunPayrollLine & { key: K };

export const GOV_PREVIEW_EARNING_FIELDS = RUN_PAYROLL_EARNING_LINES as readonly GovPreviewLine<keyof GovernmentPreviewMonthly>[];
export const GOV_PREVIEW_DEDUCTION_FIELDS = RUN_PAYROLL_DEDUCTION_LINES as readonly GovPreviewLine<keyof GovernmentPreviewMonthly["deductions"]>[];
export const GOV_PREVIEW_CPF_ARREAR_LINE = RUN_PAYROLL_CPF_ARREAR_LINE;

export const payrollAmountInputClass = "payroll-amount-input";
export const payrollDaysInputClass = "payroll-days-input";
/** @deprecated Use payrollAmountInputClass */
export const inpWide = payrollAmountInputClass;

export function d(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly["deductions"]): number {
  const value = Number(m?.deductions?.[k] ?? 0);
  return Number.isFinite(value) ? roundMoney(value) : 0;
}

export function v(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly): number {
  const value = Number((m as Record<string, unknown>)?.[k as string] ?? 0);
  return Number.isFinite(value) ? roundMoney(value) : 0;
}

export function fmtIn(n: number): string {
  return formatMoney(n);
}

function lookupDynamicFieldAmount(
  bag: Record<string, number> | null | undefined,
  fieldKey: string,
): number | undefined {
  if (!bag) return undefined;
  const direct = bag[fieldKey];
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);
  // Legacy drafts may have camelCased dynamic keys (special_allowance → specialAllowance).
  const camelKey = fieldKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camelKey !== fieldKey) {
    const camel = bag[camelKey];
    if (camel != null && Number.isFinite(Number(camel))) return Number(camel);
  }
  return undefined;
}

export function customFieldAmount(
  g: GovernmentPreviewMonthly | null | undefined,
  recalc: { customEarnings?: Record<string, number>; customDeductions?: Record<string, number> } | null | undefined,
  fieldKey: string,
  group: "earnings" | "deductions",
): number {
  const gRecord = g as Record<string, unknown> | null | undefined;
  const earningsBag =
    g?.customEarnings ?? (gRecord?.custom_earnings as Record<string, number> | undefined);
  const deductionsBag =
    g?.customDeductions ?? (gRecord?.custom_deductions as Record<string, number> | undefined);
  const bag = group === "earnings" ? earningsBag : deductionsBag;
  const fromComputed = lookupDynamicFieldAmount(bag, fieldKey);
  if (fromComputed != null) {
    return Math.round(fromComputed * 100) / 100;
  }
  const recalcBag = group === "earnings" ? recalc?.customEarnings : recalc?.customDeductions;
  const fromRecalc = lookupDynamicFieldAmount(recalcBag, fieldKey);
  return Math.round((fromRecalc ?? 0) * 100) / 100;
}

export function FieldChip({
  label,
  readOnly,
  value,
  onChange,
  mirrorHint,
  overrideHint,
}: {
  label: string;
  readOnly: boolean;
  value: number;
  onChange: (n: number) => void;
  /** Set when the amount was typed by hand instead of coming from the system (visible marker). */
  overrideHint?: string;
  /** Set for read-only mirrors of the Arrears (UNPAID) section: never rendered as an input. */
  mirrorHint?: string;
}) {
  if (mirrorHint) {
    return (
      <div
        className="flex w-[6.875rem] min-w-[6.875rem] shrink-0 flex-col items-center gap-0.5"
        data-arrear-mirror="true"
      >
        <span className="w-full truncate text-center text-[9px] font-medium uppercase tracking-wide text-slate-600">
          {label}
        </span>
        <span
          className="payroll-amount-value w-full rounded border border-dashed border-slate-300 bg-slate-50 text-slate-700"
          aria-readonly="true"
        >
          {fmtIn(value)}
        </span>
        <span className="w-full truncate text-center text-[8px] italic text-slate-500">{mirrorHint}</span>
      </div>
    );
  }
  return (
    <div
      className={`flex w-[6.875rem] min-w-[6.875rem] shrink-0 flex-col items-center gap-0.5${
        overrideHint ? " rounded bg-amber-50 ring-1 ring-amber-400" : ""
      }`}
      data-manual-override={overrideHint ? "true" : undefined}
      title={overrideHint}
    >
      <span className="w-full truncate text-center text-[9px] font-medium uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {readOnly ? (
        <span className="payroll-amount-value">{fmtIn(value)}</span>
      ) : (
        <MoneyInput value={value} onChange={onChange} className={payrollAmountInputClass} />
      )}
      {overrideHint ? (
        <span className="w-full truncate text-center text-[8px] font-semibold uppercase text-amber-800">{overrideHint}</span>
      ) : null}
    </div>
  );
}

export function PayrollSectionRow({
  title,
  titleClassName,
  children,
}: {
  title: string;
  titleClassName: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-max">
      <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${titleClassName}`}>{title}</p>
      <div className="flex flex-nowrap gap-1.5 rounded-lg border border-slate-200/90 bg-white/90 p-1.5">{children}</div>
    </section>
  );
}
