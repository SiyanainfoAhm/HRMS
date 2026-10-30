export type AuditRecord = {
  eventId: string;
  timestamp: string | null;
  actor: string | null;
  actorRole: string | null;
  action: string;
  outcome: string;
  employee: string | null;
  payrollYear: number | null;
  payrollMonth: number | null;
  payrollPeriodId?: string | null;
  payrollRunId?: string | null;
  requestId?: string | null;
  fieldChanged?: string | null;
  changedFieldNames?: string[];
  changedFields?: unknown;
  previousValue?: unknown;
  newValue?: unknown;
  details?: unknown;
};

const ACTION_LABELS: Record<string, string> = {
  "payroll.generated.amended": "Payroll Amended",
  "payroll.excel.exported": "Excel Downloaded",
  "auth.login": "User Login",
  "user.created": "User Created",
  "user.access.changed": "User Access Updated",
  "employee.created": "Employee Added",
  "employee.updated": "Employee Updated",
  "payroll.draft.saved": "Draft Saved",
  "payroll.draft.discarded": "Reset to Calculation",
  "payroll.generated": "Payroll Generated",
  "payroll.reset": "Payroll Reset",
  "payroll_master.changed": "Payroll Master Updated",
  "payslip.generated": "Payslip Generated",
  "payslip.viewed": "Payslip Viewed",
  "payroll.configuration.changed": "Payroll Configuration Updated",
};

const FIELD_LABELS: Record<string, string> = {
  eolDays: "EOL Days", hplDays: "HPL Days", payDays: "Payable Days", paidDays: "Payable Days",
  basicPaid: "Basic Pay", daPaid: "Dearness Allowance", hraPaid: "House Rent Allowance",
  medicalPaid: "Medical Allowance", cpf: "CPF", mess: "Mess Deduction", creditSociety: "Credit Society",
  electricity: "Electricity Deduction", electricityUnitsConsumed: "Electricity Units",
  totalEarnings: "Gross Earnings", totalDeductions: "Total Deductions", netSalary: "Net Salary",
  leaveRemarks: "Leave Remarks", remarks: "Remarks", eolReferenceMonth: "EOL Reference Month",
  hplReferenceMonth: "HPL Reference Month", month: "Payroll Month", year: "Payroll Year",
  arrears: "Arrears", incomeTax: "Income Tax", professionalTax: "Professional Tax",
  otherDeductions: "Other Deductions", otherEarnings: "Other Earnings", nightAllowance: "Night Allowance",
  quarterRent: "Quarter Rent", waterCharges: "Water Charges", electricityCharges: "Electricity Deduction",
  gross: "Gross Earnings", deductions: "Total Deductions", net: "Net Salary", employeeCode: "Employee Code",
  default_da_percent: "Default DA Percentage", default_hra_percent: "Default HRA Percentage",
  transport_allowance_level_9_plus: "Transport Allowance (Pay Level 9+)",
  transport_allowance_level_3_8: "Transport Allowance (Pay Levels 3–8)",
  transport_allowance_level_1_2: "Transport Allowance (Pay Levels 1–2)",
  transport_allowance_level_1_2_enhanced: "Enhanced Transport Allowance (Pay Levels 1–2)",
  transport_allowance_basic_threshold: "Transport Basic Pay Threshold",
  transport_allowance_high_min_level: "High Transport Band Minimum Level",
  transport_allowance_mid_min_level: "Mid Transport Band Minimum Level",
  default_increment_percentage: "Default Increment Percentage", increment_month: "Increment Month",
  effective_start_date: "Increment Effective Date", field_label: "Payroll Field Name",
  field_group: "Payroll Field Group", is_active: "Active",
};

const MONEY_FIELDS = /(?:basic|daPaid|hra|medical|cpf|mess|creditSociety|electricity|earnings|deductions|salary|arrears|tax|allowance|rent|charges|gross|^net$)/i;
const DAY_FIELDS = /days?/i;
const MONTH_FIELDS = /month/i;

export function actionLabel(action: string, outcome?: string): string {
  if (action === "auth.login" && outcome === "failed") return "Failed Login Attempt";
  return ACTION_LABELS[action] ?? (action.split(/[._-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") || "Activity");
}

export function fieldLabel(field: string): string {
  const leaf = field.split(/[.\\/]/).filter(Boolean).pop() ?? field;
  return FIELD_LABELS[field] ?? FIELD_LABELS[leaf] ?? leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function safeValue(value: unknown, field = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (/units/i.test(field)) return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)} ${value === 1 ? "unit" : "units"}`;
    if (MONEY_FIELDS.test(field)) return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
    if (DAY_FIELDS.test(field)) return `${value} ${value === 1 ? "day" : "days"}`;
    if (MONTH_FIELDS.test(field) && value >= 1 && value <= 12) return new Intl.DateTimeFormat("en-IN", { month: "long" }).format(new Date(2026, value - 1, 1));
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
  }
  if (Array.isArray(value)) return value.length ? value.map((item) => safeValue(item)).join(", ") : "None";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !/password|token|secret|credential/i.test(key));
    return entries.length ? entries.map(([key, item]) => `${fieldLabel(key)}: ${safeValue(item, key)}`).join(" · ") : "—";
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
    }
    if (MONTH_FIELDS.test(field) && /^\d{4}-\d{2}$/.test(value)) {
      const [year, month] = value.split("-").map(Number);
      return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
    }
    return value;
  }
  return "—";
}

export type AuditChange = { field: string; label: string; before: unknown; after: unknown; difference?: number };

function isIdentifierField(field: string): boolean {
  const normalized = field.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "id" || normalized.endsWith("id") || normalized.endsWith("uuid");
}

function isUuidValue(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type ActivityFilters = { search: string; action: string; actor: string; employee: string; period: string; from: string; to: string; category: string; outcome: string };

export function buildActivityLogQueryParams(filters: ActivityFilters, page: number, perPage: number): URLSearchParams {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.action) params.set("action", filters.action);
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  if (filters.employee.trim()) params.set("employee", filters.employee.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.category) params.set("category", filters.category);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.period) { const [year, month] = filters.period.split("-"); if (year) params.set("year", year); if (month) params.set("month", String(Number(month))); }
  return params;
}

export function auditChanges(event: AuditRecord, showUnchanged = false): AuditChange[] {
  const raw = Array.isArray(event.changedFields) ? event.changedFields : [];
  const displayLabel = (field: string) => {
    const parts = field.split(/[.\\/]/).filter(Boolean);
    return fieldLabel(parts[parts.length - 1] ?? field);
  };
  let changes: AuditChange[] = raw.flatMap((item): AuditChange[] => {
    if (typeof item === "string") {
      const hasBefore = event.previousValue && typeof event.previousValue === "object" && item in (event.previousValue as object);
      const hasAfter = event.newValue && typeof event.newValue === "object" && item in (event.newValue as object);
      if (!hasBefore && !hasAfter) return [];
      return [{ field: item, label: displayLabel(item), before: hasBefore ? (event.previousValue as Record<string, unknown>)[item] : null, after: hasAfter ? (event.newValue as Record<string, unknown>)[item] : null }];
    }
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const field = typeof row.field === "string" ? row.field : typeof row.key === "string" ? row.key : "";
    if (!field) return [];
    const before = row.before ?? row.previousValue ?? null;
    const after = row.after ?? row.newValue ?? null;
    return [{ field, label: typeof row.label === "string" ? row.label : displayLabel(field), before, after }];
  });
  if (!changes.length && event.previousValue && event.newValue && typeof event.previousValue === "object" && typeof event.newValue === "object") {
    const before = event.previousValue as Record<string, unknown>;
    const after = event.newValue as Record<string, unknown>;
    changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].map((field) => ({ field, label: displayLabel(field), before: before[field], after: after[field] }));
  }
  changes = changes.filter((change) => !isIdentifierField(change.field) && !isUuidValue(change.before) && !isUuidValue(change.after));
  changes = changes.filter((change) => showUnchanged || JSON.stringify(change.before) !== JSON.stringify(change.after));
  return changes.map((change) => ({ ...change, difference: typeof change.before === "number" && typeof change.after === "number" ? change.after - change.before : undefined }));
}

export function changeClassification(event: AuditRecord): { direct: string[]; recalculated: string[] } | null {
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : null;
  if (details?.changeClassificationSource !== "payroll-ui" || !Array.isArray(details.directEditedFields) || !Array.isArray(details.recalculatedFields)) return null;
  return {
    direct: details.directEditedFields.filter((field): field is string => typeof field === "string"),
    recalculated: details.recalculatedFields.filter((field): field is string => typeof field === "string"),
  };
}

export function eventSummary(event: AuditRecord, changes = auditChanges(event)): string {
  const classification = changeClassification(event);
  if (event.action === "auth.login") return event.outcome === "failed" ? "A login attempt was rejected." : "The user signed in successfully.";
  if (event.action === "payroll.generated.amended" && changes.length) {
    if (classification && classification.direct.length) {
      const field = fieldLabel(classification.direct[0]);
      const change = changes.find((item) => item.field === classification.direct[0]);
      return `Payroll was amended. ${field}${change ? ` changed from ${safeValue(change.before, change.field)} to ${safeValue(change.after, change.field)}` : " was edited"}; related payroll values were recalculated.`;
    }
    return `Payroll amendment recorded with ${changes.length} changed ${changes.length === 1 ? "field" : "fields"}.`;
  }
  return `${actionLabel(event.action, event.outcome)}${event.employee ? ` for ${event.employee}` : ""}${event.outcome === "failed" ? " did not complete." : " completed."}`;
}

export function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function payrollMonth(year: number | null, month: number | null): string {
  if (!year || !month) return "—";
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}
