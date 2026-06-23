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
  { key: "nightAllowancePaid", label: "Night" },
  { key: "uniformAllowancePaid", label: "Uniform" },
  { key: "educationAllowancePaid", label: "Education" },
  { key: "daArrearsPaid", label: "DA arr." },
  { key: "transportArrearsPaid", label: "Tr. arr." },
  { key: "encashmentPaid", label: "Encash." },
  { key: "encashmentDaPaid", label: "Enc. DA" },
];

export const GOV_PREVIEW_DEDUCTION_FIELDS: { key: keyof GovernmentPreviewMonthly["deductions"]; label: string }[] = [
  { key: "incomeTax", label: "Inc. tax" },
  { key: "pt", label: "P. Tax" },
  { key: "lic", label: "LIC" },
  { key: "cpf", label: "CPF" },
  { key: "daCpf", label: "DA CPF" },
  { key: "vpf", label: "VPF" },
  { key: "pfLoan", label: "PF loan" },
  { key: "postOffice", label: "Post off." },
  { key: "creditSociety", label: "Cr. society" },
  { key: "stdLicenceFee", label: "Std licence" },
  { key: "electricity", label: "Electricity" },
  { key: "water", label: "Water" },
  { key: "mess", label: "Mess" },
  { key: "horticulture", label: "Horticulture" },
  { key: "welfare", label: "Welfare" },
  { key: "vehCharge", label: "Veh. chg." },
  { key: "other", label: "Other" },
];

export const inpWide =
  "w-[5.25rem] min-w-[4.75rem] max-w-[6rem] rounded-md border border-sky-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-400";

export function d(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly["deductions"]): number {
  return Math.round(Number(m?.deductions?.[k] ?? 0));
}

export function v(m: GovernmentPreviewMonthly | null | undefined, k: keyof GovernmentPreviewMonthly): number {
  return Math.round(Number((m as Record<string, unknown>)?.[k as string] ?? 0));
}

export function fmtIn(n: number): string {
  return n.toLocaleString("en-IN");
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
    <div className="flex w-[5.5rem] min-w-[5.5rem] flex-col gap-0.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-600">{label}</span>
      {readOnly ? (
        <span className="rounded border border-transparent px-2 py-1.5 text-right text-sm tabular-nums text-slate-900">
          {fmtIn(value)}
        </span>
      ) : (
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={inpWide}
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
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${titleClassName}`}>{title}</p>
      <div className="flex flex-nowrap gap-2 rounded-lg border border-slate-200/90 bg-white/90 p-2">{children}</div>
    </section>
  );
}
