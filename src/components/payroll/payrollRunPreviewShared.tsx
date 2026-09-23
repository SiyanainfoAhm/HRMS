"use client";

import type { ReactNode } from "react";
import type { GovernmentPreviewMonthly } from "./GovernmentRunPreviewTable";

export const GOV_PREVIEW_EARNING_FIELDS: { key: keyof GovernmentPreviewMonthly; label: string; fieldKey?: string }[] = [
  { key: "basicPaid", label: "Basic", fieldKey: "gross_basic" },
  { key: "spPayPaid", label: "SP", fieldKey: "sp_pay" },
  { key: "daPaid", label: "DA", fieldKey: "da" },
  { key: "transportPaid", label: "Transport", fieldKey: "transport" },
  { key: "hraPaid", label: "HRA", fieldKey: "hra" },
  { key: "medicalPaid", label: "Medical", fieldKey: "medical" },
  { key: "extraWorkAllowancePaid", label: "EWA", fieldKey: "extra_work_allowance" },
  { key: "nightAllowancePaid", label: "N. All.", fieldKey: "night_allowance" },
  { key: "uniformAllowancePaid", label: "Uniform", fieldKey: "uniform_allowance" },
  { key: "educationAllowancePaid", label: "Education", fieldKey: "education_allowance" },
  { key: "daArrearsPaid", label: "DA arr.", fieldKey: "da_arrears" },
  { key: "transportArrearsPaid", label: "Tr. arr.", fieldKey: "transport_arrears" },
  { key: "encashmentPaid", label: "Encash." },
  { key: "encashmentDaPaid", label: "Enc. DA" },
];

export const GOV_PREVIEW_DEDUCTION_FIELDS: { key: keyof GovernmentPreviewMonthly["deductions"]; label: string; fieldKey?: string }[] = [
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
    return Math.round(fromComputed);
  }
  const recalcBag = group === "earnings" ? recalc?.customEarnings : recalc?.customDeductions;
  const fromRecalc = lookupDynamicFieldAmount(recalcBag, fieldKey);
  return Math.round(fromRecalc ?? 0);
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
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
          }}
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
