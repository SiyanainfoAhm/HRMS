/**
 * Government payslip: T-account style (earnings left, deductions right) and period title.
 * Matches typical state govt pay slip ordering (see earnings / deductions sequence).
 */

export type GovernmentMonthlySlip = Record<string, number | string | null | undefined>;

const MONTHS_UPPER = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

/** e.g. `PAY SLIP FOR APRIL 2026` from payroll period start `YYYY-MM-DD`. */
export function governmentPayslipPeriodTitle(periodStart: string): string {
  if (!periodStart || periodStart.length < 7) return "PAY SLIP";
  const y = periodStart.slice(0, 4);
  const mi = parseInt(periodStart.slice(5, 7), 10);
  const m = Math.max(1, Math.min(12, Number.isFinite(mi) ? mi : 1));
  return `PAY SLIP FOR ${MONTHS_UPPER[m - 1]} ${y}`;
}

function gnum(gov: GovernmentMonthlySlip, key: string): number {
  const v = gov[key];
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function titleFromFieldKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function customSnapshotPairs(
  gov: GovernmentMonthlySlip,
  column: "custom_earnings" | "custom_deductions",
  fieldMetas?: PayslipFieldMeta[],
): [string, number][] {
  const raw = gov[column];
  let obj: Record<string, unknown> = {};
  if (raw != null && raw !== "") {
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        obj = {};
      }
    } else if (typeof raw === "object") {
      obj = raw as Record<string, unknown>;
    }
  }

  const group: "earnings" | "deductions" = column === "custom_earnings" ? "earnings" : "deductions";
  if (fieldMetas?.length) {
    return fieldMetas
      .filter((m) => m.showInSalarySlip && payslipFieldMatchesGroup(m, group))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((m) => [m.fieldLabel, Math.round(Number(obj[m.fieldKey] ?? 0) || 0)] as [string, number]);
  }

  const out: [string, number][] = [];
  for (const [key, val] of Object.entries(obj)) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) continue;
    out.push([titleFromFieldKey(key), n]);
  }
  return out;
}

export type PayslipFieldMeta = {
  fieldKey: string;
  fieldLabel: string;
  fieldGroup: string;
  showInSalarySlip: boolean;
  displayOrder: number;
};

function payslipFieldMatchesGroup(meta: PayslipFieldMeta, group: "earnings" | "deductions"): boolean {
  if (group === "earnings") return meta.fieldGroup === "earnings";
  return meta.fieldGroup === "deductions" || meta.fieldGroup === "statutory";
}

export type GovernmentTAccountRow = {
  earningLabel: string;
  earningPaid: number | null;
  deductionLabel: string;
  deductionAmount: number | null;
};

/** Earnings lines in display order (paid column for the month). */
export function governmentPayslipEarningPairs(
  gov: GovernmentMonthlySlip,
  fieldMetas?: PayslipFieldMeta[],
): [string, number][] {
  const base: [string, number][] = [
    ["Basic", gnum(gov, "basic_paid")],
    ["SP. Pay", gnum(gov, "sp_pay_paid")],
    ["DA", gnum(gov, "da_paid")],
    ["Transport", gnum(gov, "transport_paid")],
    ["HRA", gnum(gov, "hra_paid")],
    ["Medical", gnum(gov, "medical_paid")],
    ["Extra Work Allowance", gnum(gov, "extra_work_allowance_paid")],
    ["Night Allowance", gnum(gov, "night_allowance_paid")],
    ["Uniform Allowance", gnum(gov, "uniform_allowance_paid")],
    ["Education Allowance", gnum(gov, "education_allowance_paid")],
    ["DA Arrears", gnum(gov, "da_arrears_paid")],
    ["Transport Arrears", gnum(gov, "transport_arrears_paid")],
    ["Encashment", gnum(gov, "encashment_paid")],
    ["Encashment DA", gnum(gov, "encashment_da_paid")],
  ];
  return [...base, ...customSnapshotPairs(gov, "custom_earnings", fieldMetas)];
}

/** Deduction lines in display order. */
export function governmentPayslipDeductionPairs(
  gov: GovernmentMonthlySlip,
  fieldMetas?: PayslipFieldMeta[],
): [string, number][] {
  const base: [string, number][] = [
    ["Income Tax", gnum(gov, "income_tax_amount")],
    ["P.Tax", gnum(gov, "pt_amount")],
    ["LIC", gnum(gov, "lic_amount")],
    ["CPF", gnum(gov, "cpf_amount")],
    ["DA CPF", gnum(gov, "da_cpf_amount")],
    ["CPF on DA/Transport Arrears", gnum(gov, "cpf_arrear")],
    ["VPF", gnum(gov, "vpf_amount")],
    ["Post Office", gnum(gov, "post_office_amount")],
    ["Credit Society", gnum(gov, "credit_society_amount")],
    ["Electricity", gnum(gov, "electricity_amount")],
    ["Water", gnum(gov, "water_amount")],
    ["Mess", gnum(gov, "mess_amount")],
    ["Bank Recovery", gnum(gov, "loan_recovery_amount") || gnum(gov, "horticulture_amount")],
    ["Welfare", gnum(gov, "welfare_amount")],
    ["Other", gnum(gov, "other_deduction_amount")],
  ];
  return [...base, ...customSnapshotPairs(gov, "custom_deductions", fieldMetas)];
}

/** Pairs earning and deduction rows for a 4-column T-account body. */
export function governmentPayslipTAccountRows(
  gov: GovernmentMonthlySlip,
  fieldMetas?: PayslipFieldMeta[],
): GovernmentTAccountRow[] {
  const left = governmentPayslipEarningPairs(gov, fieldMetas);
  const right = governmentPayslipDeductionPairs(gov, fieldMetas);
  const len = Math.max(left.length, right.length);
  const out: GovernmentTAccountRow[] = [];
  for (let i = 0; i < len; i++) {
    const L = left[i];
    const R = right[i];
    out.push({
      earningLabel: L?.[0] ?? "",
      earningPaid: L ? L[1] : null,
      deductionLabel: R?.[0] ?? "",
      deductionAmount: R ? R[1] : null,
    });
  }
  return out;
}
