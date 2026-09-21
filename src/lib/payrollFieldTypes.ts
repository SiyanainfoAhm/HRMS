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
  cpfCalculationMode?: "percentage" | "fixed_amount";
  cpfFixedAmount?: number;
  electricityUnitRate?: number;
  nightAllowanceBasicCeiling?: number;
};

export type ElectricityTariffConfigDto = {
  id?: string | null;
  effectiveFrom?: string | null;
  sthirAakar: number;
  vahanAakarPerUnit: number;
  fuelCharge: number;
  dutyPercentage: number;
  slabs: Array<{
    fromUnit: number;
    toUnit: number | null;
    ratePerUnit: number;
    sortOrder?: number;
  }>;
  isActive?: boolean;
};

export type PayrollConfig = {
  fields: PayrollFieldDefinition[];
  calculationSettings: PayrollCalculationSettings;
  nightAllowanceRates?: Array<{
    id: string;
    slabNo: number;
    payLevel: number;
    ratePerHour: number;
    label?: string;
    isActive?: boolean;
  }>;
  /** Tariff effective for the selected Run Payroll month (when provided by API). */
  electricityTariff?: ElectricityTariffConfigDto | null;
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

/**
 * Normalize dynamic field_key variants to snake_case.
 * specialAllowance / SpecialAllowance → special_allowance
 */
export function canonicalizeDynamicFieldKey(key: string): string {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("_")) return trimmed.toLowerCase();
  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Collapse camelCase aliases of the same field_key into one snake_case entry
 * so Save Draft / generated payroll never shows or totals Special Allowance twice.
 */
export function normalizeDynamicFieldBag(
  bag: Record<string, unknown> | null | undefined,
  knownFieldKeys?: Iterable<string>,
): Record<string, number> {
  if (!bag || typeof bag !== "object") return {};
  const knownList = knownFieldKeys ? [...knownFieldKeys] : [];
  const aliases: Record<string, number> = {};
  const preferred: Record<string, number> = {};

  for (const [key, val] of Object.entries(bag)) {
    const n = Number(val);
    if (!Number.isFinite(n)) continue;
    const snake = canonicalizeDynamicFieldKey(key);
    const knownMatch = knownList.find(
      (k) => k === key || k === snake || canonicalizeDynamicFieldKey(k) === snake,
    );
    const canonical = knownMatch ?? snake;
    const rounded = Math.round(n);
    if (key === canonical || key.includes("_")) {
      preferred[canonical] = rounded;
    } else {
      aliases[canonical] = rounded;
    }
  }

  return { ...aliases, ...preferred };
}

function savedCustomBag(
  g: Record<string, unknown> | null | undefined,
  group: "earnings" | "deductions",
  knownFieldKeys?: Iterable<string>,
): Record<string, number> {
  if (!g) return {};
  const raw =
    group === "earnings"
      ? g.customEarnings ?? g.custom_earnings
      : g.customDeductions ?? g.custom_deductions;
  if (!raw || typeof raw !== "object") return {};
  return normalizeDynamicFieldBag(raw as Record<string, unknown>, knownFieldKeys);
}

function fieldMatchesRunGroup(field: PayrollFieldDefinition, group: "earnings" | "deductions"): boolean {
  if (group === "earnings") return field.fieldGroup === "earnings";
  return field.fieldGroup === "deductions" || field.fieldGroup === "statutory";
}

/** Include saved custom field values in run preview when payroll was already generated. */
export function customRunFieldsForPreview(
  allFields: PayrollFieldDefinition[],
  savedRows: Array<{ governmentMonthly?: unknown }>,
  group: "earnings" | "deductions",
): PayrollFieldDefinition[] {
  const base = allFields
    .filter((f) => f.isActive && !f.isSystem && f.showInRunPayroll && fieldMatchesRunGroup(f, group))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const known = new Set(base.map((f) => f.fieldKey));
  const knownCanonical = new Set([...known].map(canonicalizeDynamicFieldKey));
  const extras: PayrollFieldDefinition[] = [];
  const knownKeys = allFields.map((f) => f.fieldKey);

  for (const row of savedRows) {
    const bag = savedCustomBag(
      row.governmentMonthly as Record<string, unknown> | null | undefined,
      group,
      knownKeys,
    );
    for (const key of Object.keys(bag)) {
      if (Math.round(Number(bag[key])) === 0) continue;
      if (known.has(key) || knownCanonical.has(canonicalizeDynamicFieldKey(key))) continue;
      const def =
        allFields.find((f) => f.fieldKey === key) ??
        allFields.find((f) => canonicalizeDynamicFieldKey(f.fieldKey) === canonicalizeDynamicFieldKey(key));
      if (def) {
        if (known.has(def.fieldKey)) continue;
        known.add(def.fieldKey);
        knownCanonical.add(canonicalizeDynamicFieldKey(def.fieldKey));
        extras.push(def);
        continue;
      }
      known.add(key);
      knownCanonical.add(canonicalizeDynamicFieldKey(key));
      extras.push({
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
      });
    }
  }

  return [...base, ...extras].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Sum custom field amounts included in payroll totals (earnings or deductions). */
export function sumCustomBagForTotal(
  bag: Record<string, number>,
  fields: PayrollFieldDefinition[] | undefined,
  group: "earnings" | "deductions",
): number {
  const normalized = normalizeDynamicFieldBag(bag, fields?.map((f) => f.fieldKey));
  let sum = 0;
  for (const [key, val] of Object.entries(normalized)) {
    const n = Number(val);
    if (!Number.isFinite(n)) continue;
    const def =
      fields?.find((f) => f.fieldKey === key) ??
      fields?.find((f) => canonicalizeDynamicFieldKey(f.fieldKey) === canonicalizeDynamicFieldKey(key));
    if (def) {
      if (group === "earnings" && !def.includeInTotalEarnings) continue;
      if (group === "deductions" && !def.includeInTotalDeductions) continue;
    }
    sum += n;
  }
  return Math.round(sum);
}

export function customNumericBagFromValues(
  values: Record<string, string>,
  fields: PayrollFieldDefinition[],
  group: "earnings" | "deductions",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of fields) {
    if (!field.isActive || field.isSystem || !fieldMatchesRunGroup(field, group)) continue;
    const raw = values[field.fieldKey];
    if (raw == null || raw === "") continue;
    const n = parseFloat(raw);
    if (Number.isFinite(n)) out[field.fieldKey] = n;
  }
  return out;
}

export function customNumericBagForTotalFromValues(
  values: Record<string, string>,
  fields: PayrollFieldDefinition[],
  group: "earnings" | "deductions",
): Record<string, number> {
  const bag = customNumericBagFromValues(values, fields, group);
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(bag)) {
    const def = fields.find((f) => f.fieldKey === key);
    if (group === "earnings" && def && !def.includeInTotalEarnings) continue;
    if (group === "deductions" && def && !def.includeInTotalDeductions) continue;
    out[key] = val;
  }
  return out;
}
