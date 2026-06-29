export const RETIRED_PAYROLL_FIELD_KEYS = new Set([
  "pf_loan",
  "standard_licence_fee",
  "vehicle_charge",
]);

export type PayrollFieldGroup = "basic" | "earnings" | "statutory" | "deductions" | "bank";

export type PayrollFieldDefinition = {
  id: string;
  fieldLabel: string;
  fieldKey: string;
  fieldGroup: PayrollFieldGroup | string;
  fieldType: string;
  calculationType: string;
  defaultValue?: string | null;
  dropdownOptions?: string[];
  isRequired: boolean;
  showInPayrollMaster: boolean;
  showInRunPayroll: boolean;
  showInSalarySlip: boolean;
  includeInTotalEarnings: boolean;
  includeInTotalDeductions: boolean;
  isSystem: boolean;
  isActive: boolean;
  displayOrder: number;
};

export type PayrollCalculationSettings = {
  cpfPercentage: number;
  cpfBasisFieldKeys: string[];
  cpfFormulaPreview?: string;
};

export type PayrollConfig = {
  fields: PayrollFieldDefinition[];
  calculationSettings: PayrollCalculationSettings;
};

export const FIELD_GROUPS: { value: PayrollFieldGroup; label: string }[] = [
  { value: "basic", label: "Basic Details" },
  { value: "earnings", label: "Earnings" },
  { value: "statutory", label: "Statutory" },
  { value: "deductions", label: "Deductions" },
  { value: "bank", label: "Bank Details" },
];

export const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "percentage", label: "Percentage" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
];

export const CALCULATION_TYPES = [
  { value: "manual_entry", label: "Manual Entry" },
  { value: "fixed_amount", label: "Fixed Amount" },
  { value: "percentage_based", label: "Percentage Based" },
  { value: "formula_based", label: "Formula Based" },
];

export function fieldKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "field";
}

export function earningFieldsForCpfBasis(fields: PayrollFieldDefinition[]): PayrollFieldDefinition[] {
  return fields.filter((f) => f.fieldGroup === "earnings" && f.isActive);
}

function titleFromFieldKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function savedCustomBag(
  g: Record<string, unknown> | null | undefined,
  group: "earnings" | "deductions",
): Record<string, number> {
  if (!g) return {};
  const raw =
    group === "earnings"
      ? g.customEarnings ?? g.custom_earnings
      : g.customDeductions ?? g.custom_deductions;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(val);
    if (Number.isFinite(n) && Math.round(n) !== 0) out[key] = Math.round(n);
  }
  return out;
}

/** Include saved custom field values in run preview when payroll was already generated. */
export function customRunFieldsForPreview(
  allFields: PayrollFieldDefinition[],
  savedRows: Array<{ governmentMonthly?: unknown }>,
  group: "earnings" | "deductions",
): PayrollFieldDefinition[] {
  const base = allFields
    .filter((f) => f.isActive && !f.isSystem && f.showInRunPayroll && f.fieldGroup === group)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const known = new Set(base.map((f) => f.fieldKey));
  const extras: PayrollFieldDefinition[] = [];

  for (const row of savedRows) {
    const bag = savedCustomBag(row.governmentMonthly as Record<string, unknown> | null | undefined, group);
    for (const key of Object.keys(bag)) {
      if (known.has(key)) continue;
      known.add(key);
      const def = allFields.find((f) => f.fieldKey === key);
      extras.push(
        def ?? {
          id: `saved-${group}-${key}`,
          fieldLabel: titleFromFieldKey(key),
          fieldKey: key,
          fieldGroup: group,
          fieldType: "number",
          calculationType: "manual_entry",
          isRequired: false,
          showInPayrollMaster: false,
          showInRunPayroll: true,
          showInSalarySlip: true,
          includeInTotalEarnings: group === "earnings",
          includeInTotalDeductions: group === "deductions",
          isSystem: false,
          isActive: true,
          displayOrder: 999,
        },
      );
    }
  }

  return [...base, ...extras].sort((a, b) => a.displayOrder - b.displayOrder);
}
