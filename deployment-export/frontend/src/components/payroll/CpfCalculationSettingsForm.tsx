"use client";

import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { cpfFormulaPreview, type CpfCalculationMode } from "@/lib/payrollCpfCalculation";
import type { PayrollFieldDefinition } from "@/lib/payrollFieldTypes";

type Props = {
  earningFields: PayrollFieldDefinition[];
  cpfPercentage: string;
  cpfBasisKeys: string[];
  cpfCalculationMode?: CpfCalculationMode;
  cpfFixedAmount?: string;
  electricityUnitRate?: string;
  onCpfPercentageChange: (value: string) => void;
  onToggleBasisKey: (key: string) => void;
  onCpfCalculationModeChange?: (mode: CpfCalculationMode) => void;
  onCpfFixedAmountChange?: (value: string) => void;
  onElectricityUnitRateChange?: (value: string) => void;
  useCompanyDefault?: boolean;
  onUseCompanyDefaultChange?: (value: boolean) => void;
  companyPreview?: string;
  cpfAmountPreview?: number;
  cpfBasisAmountPreview?: number;
  showElectricityRate?: boolean;
  disabled?: boolean;
  idPrefix?: string;
};

export function CpfCalculationSettingsForm({
  earningFields,
  cpfPercentage,
  cpfBasisKeys,
  cpfCalculationMode = "percentage",
  cpfFixedAmount = "0",
  electricityUnitRate = "0",
  onCpfPercentageChange,
  onToggleBasisKey,
  onCpfCalculationModeChange,
  onCpfFixedAmountChange,
  onElectricityUnitRateChange,
  useCompanyDefault = false,
  onUseCompanyDefaultChange,
  companyPreview,
  cpfAmountPreview,
  cpfBasisAmountPreview,
  showElectricityRate = false,
  disabled = false,
  idPrefix = "cpf",
}: Props) {
  const mode = cpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage";
  const labels = cpfBasisKeys.map((k) => earningFields.find((f) => f.fieldKey === k)?.fieldLabel ?? k);
  const preview = cpfFormulaPreview(
    labels,
    parseFloat(cpfPercentage) || 0,
    mode,
    parseFloat(cpfFixedAmount) || 0,
  );
  const showEmployeeFields = !useCompanyDefault || !onUseCompanyDefaultChange;
  const showPercentageFields = mode === "percentage";

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

      {showEmployeeFields || !onUseCompanyDefaultChange ? (
        <>
          {onCpfCalculationModeChange ? (
            <FormField label="CPF calculation mode" htmlFor={`${idPrefix}-mode`}>
              <select
                id={`${idPrefix}-mode`}
                className="input-field"
                disabled={disabled}
                value={mode}
                onChange={(e) =>
                  onCpfCalculationModeChange(e.target.value === "fixed_amount" ? "fixed_amount" : "percentage")
                }
              >
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed Amount</option>
              </select>
            </FormField>
          ) : null}

          {showPercentageFields ? (
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
                  {cpfBasisAmountPreview != null && mode === "percentage" ? (
                    <p className="mt-1 text-xs tabular-nums text-slate-600">
                      CPF basis: ₹{cpfBasisAmountPreview.toLocaleString("en-IN")}
                    </p>
                  ) : null}
                  {cpfAmountPreview != null ? (
                    <p className="mt-2 text-sm tabular-nums text-slate-700">
                      Calculated CPF: <span className="font-semibold text-slate-900">₹{cpfAmountPreview.toLocaleString("en-IN")}</span>
                    </p>
                  ) : null}
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
                      const basisDisabled = disabled || (useCompanyDefault && Boolean(onUseCompanyDefaultChange));
                      return (
                        <label
                          key={f.fieldKey}
                          className={cn(
                            "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                            selected
                              ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                            basisDisabled && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={selected}
                            disabled={basisDisabled}
                            onChange={() => {
                              if (!basisDisabled) onToggleBasisKey(f.fieldKey);
                            }}
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
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Fixed CPF amount (₹)" htmlFor={`${idPrefix}-fixed`}>
                <Input
                  id={`${idPrefix}-fixed`}
                  type="number"
                  min={0}
                  step="1"
                  value={cpfFixedAmount}
                  disabled={disabled}
                  onChange={(e) => onCpfFixedAmountChange?.(e.target.value)}
                />
              </FormField>
              <div className="flex flex-col justify-end rounded-lg border border-brand-border bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Formula preview</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{preview}</p>
                {cpfAmountPreview != null ? (
                  <p className="mt-2 text-sm tabular-nums text-slate-700">
                    Calculated CPF: <span className="font-semibold text-slate-900">₹{cpfAmountPreview.toLocaleString("en-IN")}</span>
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}

      {showElectricityRate && onElectricityUnitRateChange ? (
        <FormField label="Electricity unit rate (₹)" htmlFor={`${idPrefix}-elec-rate`}>
          <Input
            id={`${idPrefix}-elec-rate`}
            type="number"
            min={0}
            step="0.01"
            value={electricityUnitRate}
            disabled={disabled}
            onChange={(e) => onElectricityUnitRateChange(e.target.value)}
          />
        </FormField>
      ) : null}
    </div>
  );
}
