"use client";

import type { ReactNode } from "react";
import type { GovernmentPreviewMonthly } from "./GovernmentRunPreviewTable";

export const GOV_PREVIEW_EARNING_FIELDS: { key: keyof GovernmentPreviewMonthly; label: string }[] = [
  { key: "basicPaid", label: "Basic" },
  { key: "spPayPaid", label: "SP" },
  { key: "daPaid", label: "DA" },
  { key: "transportPaid", label: "Transport" },
  { key: "hraPaid", label: "HRA" },
  { key: "medicalPaid", label: "Medical" },
  { key: "extraWorkAllowancePaid", label: "EWA" },
  { key: "nightAllowancePaid", label: "N. All." },
  { key: "uniformAllowancePaid", label: "Uniform" },
  { key: "educationAllowancePaid", label: "Education" },
  { key: "daArrearsPaid", label: "DA arr." },
  { key: "transportArrearsPaid", label: "Tr. arr." },
  { key: "encashmentPaid", label: "Encash." },
  { key: "encashmentDaPaid", label: "Enc. DA" },
];

export const GOV_PREVIEW_DEDUCTION_FIELDS: { key: keyof GovernmentPreviewMonthly["deductions"]; label: string }[] = [
  { key: "incomeTax", label: "Inc. tax" },
  { key: "pt", label: "Professional Tax" },
  { key: "lic", label: "LIC" },
  { key: "cpf", label: "CPF" },
  { key: "daCpf", label: "DA CPF" },
  { key: "vpf", label: "VPF" },
  { key: "postOffice", label: "Post off." },
  { key: "creditSociety", label: "Cr. society" },
  { key: "electricity", label: "Electricity" },
  { key: "water", label: "Water" },
  { key: "mess", label: "Mess" },
  { key: "loanRecovery", label: "Bank Recovery" },
  { key: "welfare", label: "Welfare" },
  { key: "quarterRent", label: "Quarter Rent" },
  { key: "other", label: "Other" },
];

export const payrollAmountInputClass = "payroll-amount-input";
export const payrollDaysInputClass = "payroll-days-input";
/** @deprecated Use payrollAmountInputClass */
export const inpWide = payrollAmountInputClass;

export function d(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly["deductions"]): number {
  return Math.round(Number(m?.deductions?.[k] ?? 0));
}

export function v(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly): number {
  return Math.round(Number((m as Record<string, unknown>)?.[k as string] ?? 0));
}

export function fmtIn(n: number): string {
  return n.toLocaleString("en-IN");
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
  const fromComputed = bag?.[fieldKey];
  if (fromComputed != null && Number.isFinite(Number(fromComputed))) {
    return Math.round(Number(fromComputed));
  }
  const recalcBag = group === "earnings" ? recalc?.customEarnings : recalc?.customDeductions;
  return Math.round(Number(recalcBag?.[fieldKey] ?? 0) || 0);
}

export function FieldChip({
  label,
  readOnly,
  value,
  onChange,
}: {
  label: string;
  readOnly: boolean;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex w-[6.875rem] min-w-[6.875rem] shrink-0 flex-col items-center gap-0.5">
      <span className="w-full truncate text-center text-[9px] font-medium uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {readOnly ? (
        <span className="payroll-amount-value">{fmtIn(value)}</span>
      ) : (
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={payrollAmountInputClass}
        />
      )}
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
