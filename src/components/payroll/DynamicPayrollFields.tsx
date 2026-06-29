"use client";

import { DatePickerField } from "@/components/ui/DatePickerField";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import type { PayrollFieldDefinition, PayrollFieldGroup } from "@/lib/payrollFieldTypes";

type Props = {
  fields: PayrollFieldDefinition[];
  group: PayrollFieldGroup;
  values: Record<string, string>;
  errors?: Record<string, string>;
  onChange: (key: string, value: string) => void;
  showInPayrollMaster?: boolean;
};

export function DynamicPayrollFields({
  fields,
  group,
  values,
  errors = {},
  onChange,
  showInPayrollMaster = true,
}: Props) {
  const visible = fields
    .filter((f) => f.fieldGroup === group && f.isActive && !f.isSystem)
    .filter((f) => (showInPayrollMaster ? f.showInPayrollMaster : f.showInRunPayroll))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  if (visible.length === 0) return null;

  return (
    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom fields</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((field) => {
          const err = errors[field.fieldKey];
          const val = values[field.fieldKey] ?? field.defaultValue ?? "";
          const invalid = Boolean(err);

          if (field.fieldType === "dropdown") {
            return (
              <FormField key={field.id} label={field.fieldLabel} required={field.isRequired} error={err}>
                <SelectField
                  label=""
                  value={val}
                  onChange={(v) => onChange(field.fieldKey, v)}
                  options={[
                    { value: "", label: "—" },
                    ...(field.dropdownOptions ?? []).map((o) => ({ value: o, label: o })),
                  ]}
                />
              </FormField>
            );
          }

          if (field.fieldType === "date") {
            return (
              <FormField key={field.id} label={field.fieldLabel} required={field.isRequired} error={err}>
                <DatePickerField value={val} onChange={(v) => onChange(field.fieldKey, v)} />
              </FormField>
            );
          }

          return (
            <FormField key={field.id} label={field.fieldLabel} required={field.isRequired} error={err}>
              <Input
                type={field.fieldType === "text" ? "text" : "number"}
                step={field.fieldType === "percentage" ? "0.01" : "1"}
                value={val}
                className={invalid ? "border-red-500" : undefined}
                onChange={(e) => onChange(field.fieldKey, e.target.value)}
              />
            </FormField>
          );
        })}
      </div>
    </div>
  );
}
