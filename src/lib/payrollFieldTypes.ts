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
