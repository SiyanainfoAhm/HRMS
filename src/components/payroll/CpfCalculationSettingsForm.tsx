"use client";

import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { cpfFormulaPreview } from "@/lib/payrollCpfCalculation";
import type { PayrollFieldDefinition } from "@/lib/payrollFieldTypes";

type Props = {
  earningFields: PayrollFieldDefinition[];
  cpfPercentage: string;
  cpfBasisKeys: string[];
  onCpfPercentageChange: (value: string) => void;
  onToggleBasisKey: (key: string) => void;
  useCompanyDefault?: boolean;
  onUseCompanyDefaultChange?: (value: boolean) => void;
  companyPreview?: string;
  disabled?: boolean;
  idPrefix?: string;
};

export function CpfCalculationSettingsForm({
  earningFields,
  cpfPercentage,
  cpfBasisKeys,
  onCpfPercentageChange,
  onToggleBasisKey,
  useCompanyDefault = false,
  onUseCompanyDefaultChange,
  companyPreview,
  disabled = false,
  idPrefix = "cpf",
}: Props) {
  const labels = cpfBasisKeys.map((k) => earningFields.find((f) => f.fieldKey === k)?.fieldLabel ?? k);
  const preview = cpfFormulaPreview(labels, parseFloat(cpfPercentage) || 0);
  const showEmployeeFields = !useCompanyDefault || !onUseCompanyDefaultChange;

  return (
    <div className="space-y-4">
      {onUseCompanyDefaultChange ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">Calculation source</p>
          <div className="flex flex-wrap gap-2">
            <label
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                useCompanyDefault
                  ? "border-brand-navy bg-brand-navy text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                checked={useCompanyDefault}
                disabled={disabled}
                onChange={() => onUseCompanyDefaultChange(true)}
              />
              Use institute default
            </label>
            <label
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                !useCompanyDefault
                  ? "border-brand-navy bg-brand-navy text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                checked={!useCompanyDefault}
                disabled={disabled}
                onChange={() => onUseCompanyDefaultChange(false)}
              />
              Custom for this employee
            </label>
          </div>
          {useCompanyDefault && companyPreview ? (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium text-slate-800">Institute formula:</span> {companyPreview}
            </p>
          ) : null}
        </div>
      ) : null}

      {showEmployeeFields ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="PF / CPF Percentage" htmlFor={`${idPrefix}-pct`}>
              <Input
                id={`${idPrefix}-pct`}
                type="number"
                min={0}
                step="0.01"
                value={cpfPercentage}
                disabled={disabled}
                onChange={(e) => onCpfPercentageChange(e.target.value)}
              />
            </FormField>
            <div className="flex flex-col justify-end rounded-lg border border-brand-border bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Formula preview</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{preview}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">PF / CPF calculation basis</p>
            <p className="mb-3 text-xs text-slate-500">Select earning components included in the CPF base.</p>
            {earningFields.length === 0 ? (
              <p className="text-sm text-slate-500">No active earning fields configured.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {earningFields.map((f) => {
                  const selected = cpfBasisKeys.includes(f.fieldKey);
                  return (
                    <label
                      key={f.fieldKey}
                      className={cn(
                        "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        selected
                          ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => onToggleBasisKey(f.fieldKey)}
                      />
                      {f.fieldLabel}
                    </label>
                  );
                })}
              </div>
            )}
            {cpfBasisKeys.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                Select at least one earning field for PF/CPF calculation.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
