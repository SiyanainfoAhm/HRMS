"use client";

import { formatMoney, roundMoney } from "@/lib/money";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { ReactNode } from "react";
import type { GovernmentPreviewMonthly } from "./GovernmentRunPreviewTable";
import { PAYROLL_LABELS } from "@/lib/payrollLabels";

/**
 * `arrearField` marks the arrears lines that are edited through the arrear path
 * (grossArrear/netArrear are not sheet earning keys, so `govEarning_<key>` would be ignored).
 * `memo` lines are derived, shown for information and never added to totals.
 */
export type GovPreviewLine<K> = { key: K; label: string; fieldKey?: string; arrearField?: string; memo?: boolean };

export const GOV_PREVIEW_EARNING_FIELDS: GovPreviewLine<keyof GovernmentPreviewMonthly>[] = [
  { key: "basicPaid", label: "Basic", fieldKey: "gross_basic" },
  { key: "spPayPaid", label: "Special Pay", fieldKey: "sp_pay" },
  { key: "daPaid", label: "DA", fieldKey: "da" },
  { key: "transportPaid", label: "Transport", fieldKey: "transport" },
  { key: "hraPaid", label: "HRA", fieldKey: "hra" },
  { key: "medicalPaid", label: "Medical", fieldKey: "medical" },
  { key: "extraWorkAllowancePaid", label: "EWA", fieldKey: "extra_work_allowance" },
  { key: "nightAllowancePaid", label: "N. All.", fieldKey: "night_allowance" },
  { key: "uniformAllowancePaid", label: "Uniform", fieldKey: "uniform_allowance" },
  { key: "educationAllowancePaid", label: "Education", fieldKey: "education_allowance" },
  { key: "daArrearsPaid", label: PAYROLL_LABELS.daArrears, fieldKey: "da_arrears" },
  { key: "transportArrearsPaid", label: PAYROLL_LABELS.transportArrears, fieldKey: "transport_arrears" },
  { key: "encashmentPaid", label: "Encash." },
  { key: "grossArrear", label: PAYROLL_LABELS.grossArrears, fieldKey: "gross_arrears", arrearField: "grossArrear" },
  { key: "netArrear", label: PAYROLL_LABELS.netArrears, fieldKey: "net_arrears", arrearField: "netArrear", memo: true },
];

/** CPF Arr is stored on the monthly row (cpfArrear), not inside `deductions`, so it is rendered after this list. */
export const GOV_PREVIEW_DEDUCTION_FIELDS: GovPreviewLine<keyof GovernmentPreviewMonthly["deductions"]>[] = [
  { key: "incomeTax", label: "Inc. tax", fieldKey: "income_tax" },
  { key: "pt", label: "Professional Tax", fieldKey: "professional_tax" },
  { key: "lic", label: "LIC", fieldKey: "lic" },
  { key: "cpf", label: "CPF", fieldKey: "cpf" },
  { key: "daCpf", label: "DA CPF", fieldKey: "da_cpf" },
  { key: "vpf", label: "VPF", fieldKey: "vpf" },
  { key: "pfLoan", label: "PF Loan" },
  { key: "postOffice", label: "Post off.", fieldKey: "post_office" },
  { key: "creditSociety", label: "Cr. society", fieldKey: "credit_society" },
  { key: "electricity", label: "Electricity", fieldKey: "electricity" },
  { key: "water", label: "Water", fieldKey: "water" },
  { key: "mess", label: "Mess", fieldKey: "mess" },
  { key: "loanRecovery", label: "Bank Recovery", fieldKey: "loan_recovery" },
  { key: "welfare", label: "Welfare", fieldKey: "welfare" },
  { key: "hpl", label: "HPL", fieldKey: "hpl" },
  { key: "eol", label: "EOL", fieldKey: "eol" },
  { key: "vehCharge", label: "Veh. chg." },
  { key: "quarterRent", label: "Quarter Rent", fieldKey: "quarter_rent" },
  { key: "other", label: "Other", fieldKey: "other_deduction" },
];

/** CPF Arr deduction line (cpfArrear on the monthly row). */
export const GOV_PREVIEW_CPF_ARREAR_LINE = { key: "cpfArrear", label: PAYROLL_LABELS.cpfArrears, fieldKey: "cpf_arrears", arrearField: "cpfArrear" } as const;

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
}: {
  label: string;
  readOnly: boolean;
  value: number;
  onChange: (n: number) => void;
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
    <div className="flex w-[6.875rem] min-w-[6.875rem] shrink-0 flex-col items-center gap-0.5">
      <span className="w-full truncate text-center text-[9px] font-medium uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {readOnly ? (
        <span className="payroll-amount-value">{fmtIn(value)}</span>
      ) : (
        <MoneyInput value={value} onChange={onChange} className={payrollAmountInputClass} />
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
