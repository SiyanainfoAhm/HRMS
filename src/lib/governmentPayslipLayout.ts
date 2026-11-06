import { daCpfOf } from "./daCpf";
import { roundMoney } from "./money";
import { PAYROLL_LABELS } from "./payrollLabels";
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

/** A stored field key is immutable once it has employee values, so it is safe as a historical reference. */
function historicalFieldLabel(key: string, configuredLabel?: string): string {
  const configured = configuredLabel?.trim();
  return configured || `${titleFromFieldKey(key)} (${key})`;
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
    const shown = new Set<string>();
    const configured = fieldMetas
      .filter((m) => m.showInSalarySlip && payslipFieldMatchesGroup(m, group))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((m) => {
        shown.add(m.fieldKey);
        return [historicalFieldLabel(m.fieldKey, m.fieldLabel), roundMoney(Number(obj[m.fieldKey] ?? 0) || 0)] as [string, number];
      });

    // Definitions may be deactivated or deleted after a payroll is saved.  Do
    // not let current configuration erase a historical payment from its slip.
    const historical = Object.entries(obj)
      .filter(([key, value]) => !shown.has(key) && Number(value) !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [historicalFieldLabel(key), roundMoney(Number(value) || 0)] as [string, number]);

    return [...configured, ...historical];
  }

  const out: [string, number][] = [];
  for (const [key, val] of Object.entries(obj)) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) continue;
    out.push([historicalFieldLabel(key), n]);
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
    [PAYROLL_LABELS.daArrears, gnum(gov, "da_arrears_paid")],
    [PAYROLL_LABELS.transportArrears, gnum(gov, "transport_arrears_paid")],
    // Gross arrear already contains the DA and transport arrear lines above; show
    // only the remainder so the printed lines add up to Gross (same rule as the
    // sheet totals: totalArrearsPaid in payrollArrearCalc.ts).
    [PAYROLL_LABELS.grossArrears, Math.max(0, gnum(gov, "gross_arrear") - gnum(gov, "da_arrears_paid") - gnum(gov, "transport_arrears_paid"))],
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
    ["DA CPF", daCpfOf(gov)], // = CPF Arr; shown once so the printed lines add up to Total Deductions
    ["VPF", gnum(gov, "vpf_amount")],
    ["Post Office", gnum(gov, "post_office_amount")],
    ["Credit Society", gnum(gov, "credit_society_amount")],
    ["Electricity", gnum(gov, "electricity_amount")],
    ["Water", gnum(gov, "water_amount")],
    ["Mess", gnum(gov, "mess_amount")],
    ["Bank Recovery", gnum(gov, "loan_recovery_amount") || gnum(gov, "horticulture_amount")],
    ["Welfare", gnum(gov, "welfare_amount")],
  ];
  const quarterRent = gnum(gov, "quarter_rent_amount");
  if (quarterRent > 0 || Boolean((gov as { has_quarter?: boolean }).has_quarter)) {
    base.push(["Quarter Rent", quarterRent]);
  }
  base.push(["Other", gnum(gov, "other_deduction_amount")]);
  // Lines that count toward Total Deductions must also be printed. These are
  // shown only when present so a normal slip keeps its familiar layout.
  for (const [label, key] of [
    ["PF Loan", "pf_loan_amount"],
    ["Std. Licence Fee", "std_licence_fee_amount"],
    ["Vehicle Charge", "veh_charge_amount"],
    ["HPL", "hpl_amount"],
    ["EOL", "eol_amount"],
  ] as const) {
    const amount = gnum(gov, key);
    if (amount > 0) base.push([label, amount]);
  }
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
