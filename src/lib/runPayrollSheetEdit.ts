/**
 * Run Payroll sheet edits: after initial calculation, monetary fields are an
 * editable entry sheet. Only aggregate totals recalculate — never full payroll
 * recompute that would overwrite other components.
 */
import type {
  GovernmentDeductionDefaults,
  GovernmentEarningPaidOverrides,
} from "@/lib/governmentPayroll";
import { sumCustomBagForTotal, type PayrollFieldDefinition } from "@/lib/payrollFieldTypes";
import { hasOwn, parseAmountOrZero } from "@/lib/effectivePayrollValue";
import type { GovRecalcPayload } from "@/lib/govRunPayrollCompute";

/**
 * Editable Run Payroll monthly snapshot.
 * Canonical compute (`GovernmentMonthlyComputed`) mirrors quarter rent at both
 * `deductions.quarterRent` and top-level `quarterRent` / `quarter_rent`.
 */
export type GovernmentMonthlySheetState = Record<string, unknown> & {
  deductions?: Partial<GovernmentDeductionDefaults> & Record<string, unknown>;
  quarterRent?: number;
  quarter_rent?: number;
  totalEarnings?: number;
  totalDeductions?: number;
  netSalary?: number;
};

export const SHEET_EARNING_KEYS = [
  "basicPaid",
  "spPayPaid",
  "daPaid",
  "transportPaid",
  "hraPaid",
  "medicalPaid",
  "extraWorkAllowancePaid",
  "nightAllowancePaid",
  "uniformAllowancePaid",
  "educationAllowancePaid",
  "daArrearsPaid",
  "transportArrearsPaid",
  "encashmentPaid",
  "encashmentDaPaid",
] as const;

export type SheetEarningKey = (typeof SHEET_EARNING_KEYS)[number];

export const SHEET_DEDUCTION_KEYS = [
  "incomeTax",
  "pt",
  "lic",
  "cpf",
  "daCpf",
  "vpf",
  "pfLoan",
  "postOffice",
  "creditSociety",
  "stdLicenceFee",
  "electricity",
  "water",
  "mess",
  "loanRecovery",
  "welfare",
  "hpl",
  "eol",
  "vehCharge",
  "other",
  "quarterRent",
] as const;

export type SheetDeductionKey = (typeof SHEET_DEDUCTION_KEYS)[number];

export const SHEET_ARREAR_KEYS = [
  "daArrear",
  "transportArrear",
  "grossArrear",
  "cpfArrear",
  "netArrear",
] as const;

export type SheetArrearKey = (typeof SHEET_ARREAR_KEYS)[number];

function roundRupees(n: number): number {
  return Math.round(Number.isFinite(n) ? n : 0);
}

function amount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, roundRupees(n)) : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Sum current earning paid lines + custom earnings included in totals. */
export function sumSheetEarnings(
  gm: Record<string, unknown>,
  payrollFieldDefs?: PayrollFieldDefinition[],
): number {
  let sum = 0;
  for (const key of SHEET_EARNING_KEYS) {
    sum += amount(gm[key]);
  }
  const custom = asRecord(gm.customEarnings ?? gm.custom_earnings) as Record<string, number>;
  sum += sumCustomBagForTotal(custom, payrollFieldDefs, "earnings");
  return roundRupees(sum);
}

/** Sum current deduction lines + custom deductions included in totals. */
export function sumSheetDeductions(
  gm: Record<string, unknown>,
  payrollFieldDefs?: PayrollFieldDefinition[],
): number {
  const ded = asRecord(gm.deductions);
  let sum = 0;
  for (const key of SHEET_DEDUCTION_KEYS) {
    sum += amount(ded[key]);
  }
  const custom = asRecord(gm.customDeductions ?? gm.custom_deductions) as Record<string, number>;
  sum += sumCustomBagForTotal(custom, payrollFieldDefs, "deductions");
  return roundRupees(sum);
}

/**
 * Recalculate totalEarnings / totalDeductions / netSalary from CURRENT sheet values.
 * Does not recompute component formulas.
 */
export function recalculateGovernmentSheetTotals(
  gm: GovernmentMonthlySheetState,
  payrollFieldDefs?: PayrollFieldDefinition[],
): GovernmentMonthlySheetState {
  const totalEarnings = sumSheetEarnings(gm, payrollFieldDefs);
  const totalDeductions = sumSheetDeductions(gm, payrollFieldDefs);
  const netSalary = roundRupees(totalEarnings - totalDeductions);
  const ded = asRecord(gm.deductions);
  const quarterRent = hasOwn(ded, "quarterRent") ? amount(ded.quarterRent) : amount(gm.quarterRent);
  return {
    ...gm,
    ...(hasOwn(ded, "quarterRent") || gm.quarterRent !== undefined || gm.quarter_rent !== undefined
      ? { quarterRent, quarter_rent: quarterRent }
      : {}),
    totalEarnings,
    totalDeductions,
    netSalary,
    total_earnings: totalEarnings,
    total_deductions: totalDeductions,
    net_salary: netSalary,
  };
}

/** Mirror every current paid earning into earningPaidOverrides (freeze sheet). */
export function freezeEarningOverridesFromGm(
  gm: Record<string, unknown>,
  existing?: GovernmentEarningPaidOverrides | null,
): GovernmentEarningPaidOverrides {
  const out: GovernmentEarningPaidOverrides = { ...(existing ?? {}) };
  for (const key of SHEET_EARNING_KEYS) {
    out[key] = amount(gm[key]);
  }
  return out;
}

/** Mirror every current deduction into deductionDefaults + statutory override flags. */
export function freezeDeductionDefaultsFromGm(
  gm: Record<string, unknown>,
  existing?: GovernmentDeductionDefaults | null,
): GovernmentDeductionDefaults {
  const ded = asRecord(gm.deductions);
  const base = { ...(existing ?? {}) } as GovernmentDeductionDefaults;
  for (const key of SHEET_DEDUCTION_KEYS) {
    (base as Record<string, number>)[key] = amount(ded[key] ?? (base as Record<string, number>)[key]);
  }
  return base;
}

/** Merge Master deduction defaults with explicit monthly paid overrides (0 is valid). */
export function mergeDeductionDefaultsWithPaidOverrides(
  masterDefaults: GovernmentDeductionDefaults | null | undefined,
  paidOverrides: Partial<GovernmentDeductionDefaults> | null | undefined,
): GovernmentDeductionDefaults {
  const base = { ...(masterDefaults ?? {}) } as GovernmentDeductionDefaults;
  if (!paidOverrides) return base;
  for (const key of SHEET_DEDUCTION_KEYS) {
    if (hasOwn(paidOverrides, key)) {
      const v = Number((paidOverrides as Record<string, number>)[key]);
      if (Number.isFinite(v)) (base as Record<string, number>)[key] = Math.max(0, Math.round(v));
    }
  }
  return base;
}

/**
 * Patch governmentMonthly.deductions: Master baseline, then paid overrides.
 * Keeps top-level quarterRent / quarter_rent in sync with deductions.quarterRent
 * (canonical GovernmentMonthlyComputed mirrors rent at both places).
 */
export function applyDeductionPaidOverridesToGm(
  gm: GovernmentMonthlySheetState,
  masterDefaults: GovernmentDeductionDefaults | null | undefined,
  paidOverrides: Partial<GovernmentDeductionDefaults> | null | undefined,
): GovernmentMonthlySheetState {
  const merged = mergeDeductionDefaultsWithPaidOverrides(masterDefaults, paidOverrides);
  const next: GovernmentMonthlySheetState = {
    ...gm,
    deductions: { ...asRecord(gm.deductions), ...merged },
  };
  if (hasOwn(merged, "quarterRent")) {
    next.quarterRent = merged.quarterRent;
    next.quarter_rent = merged.quarterRent;
  }
  return recalculateGovernmentSheetTotals(next);
}

export type GovernmentSheetRow = {
  employeeUserId: string;
  payDays: number;
  unpaidLeaveDays?: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  takeHome: number;
  tds?: number;
  profTax?: number;
  pfEmployee?: number;
  incentive?: number;
  prBonus?: number;
  reimbursement?: number;
  daArrear?: number;
  transportArrear?: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
  governmentMonthly?: unknown;
  govRecalc?: GovRecalcPayload | null;
};

function syncRowAggregatesFromGm<T extends GovernmentSheetRow>(
  row: T,
  gm: Record<string, unknown>,
): T {
  const totalEarnings = amount(gm.totalEarnings ?? gm.total_earnings);
  const totalDeductions = amount(gm.totalDeductions ?? gm.total_deductions);
  const netSalary = amount(gm.netSalary ?? gm.net_salary);
  const ded = asRecord(gm.deductions);
  const incentive = amount(row.incentive);
  const prBonus = amount(row.prBonus);
  const reimbursement = amount(row.reimbursement);
  return {
    ...row,
    governmentMonthly: gm,
    grossPay: totalEarnings,
    deductions: totalDeductions,
    netPay: netSalary,
    tds: amount(ded.incomeTax),
    profTax: amount(ded.pt),
    pfEmployee: roundRupees(amount(ded.cpf) + amount(ded.daCpf) + amount(ded.vpf)),
    takeHome: roundRupees(netSalary + incentive + prBonus + reimbursement),
  };
}

/**
 * Apply one monetary sheet edit and recalculate totals only.
 * Marks the field as overridden; freezes sibling components so later leave/day
 * recomputes (if any) can honour overrides via govRecalc.
 */
export function applyGovernmentSheetMonetaryEdit<T extends GovernmentSheetRow>(
  row: T,
  field: string,
  rawValue: number | string,
  opts?: { payrollFieldDefs?: PayrollFieldDefinition[] },
): T {
  if (!row.govRecalc) return row;
  const gm0 = asRecord(row.governmentMonthly);
  if (!Object.keys(gm0).length && !hasOwn(gm0, "basicPaid")) {
    // No sheet yet — caller should full-compute first.
    return row;
  }

  const value = parseAmountOrZero(rawValue);
  const gr0 = row.govRecalc;
  let gm: GovernmentMonthlySheetState = { ...gm0 };
  let gr: GovRecalcPayload = { ...gr0 };
  let daArrear = amount(row.daArrear ?? gm.daArrearsPaid ?? gm.da_arrears_paid);
  let transportArrear = amount(row.transportArrear ?? gm.transportArrearsPaid ?? gm.transport_arrears_paid);
  let grossArrear = amount(row.grossArrear ?? gm.grossArrear ?? gm.gross_arrear);
  let cpfArrear = amount(row.cpfArrear ?? gm.cpfArrear ?? gm.cpf_arrear);
  let netArrear = amount(row.netArrear ?? gm.netArrear ?? gm.net_arrear);

  if (field.startsWith("govEarning_")) {
    const key = field.slice("govEarning_".length) as SheetEarningKey;
    if (!(SHEET_EARNING_KEYS as readonly string[]).includes(key)) return row;
    gm[key] = value;
    // Keep actual mirrors in sync for payslip display where used.
    const actualKey = key.replace(/Paid$/, "Actual");
    if (actualKey !== key && hasOwn(gm, actualKey)) {
      gm[actualKey] = value;
    }
    gr = {
      ...gr,
      earningPaidOverrides: {
        ...(gr.earningPaidOverrides ?? {}),
        [key]: value,
      },
      ...(key === "nightAllowancePaid" ? { nightAllowanceManualOverride: true } : {}),
    };
  } else if (field.startsWith("govDeduction_")) {
    const key = field.slice("govDeduction_".length) as SheetDeductionKey;
    if (!(SHEET_DEDUCTION_KEYS as readonly string[]).includes(key)) return row;
    const ded = { ...asRecord(gm.deductions), [key]: value };
    gm = { ...gm, deductions: ded };
    if (key === "quarterRent") {
      gm.quarterRent = value;
      gm.quarter_rent = value;
    }
    gr = {
      ...gr,
      // Keep Master-seeded deductionDefaults intact; paid overrides win at compute time.
      deductionPaidOverrides: {
        ...(gr.deductionPaidOverrides ?? {}),
        [key]: value,
      },
      ...(key === "cpf" ? { cpfManualOverride: true } : {}),
      ...(key === "hpl" ? { hplDeductionManualOverride: true } : {}),
      ...(key === "eol" ? { eolDeductionManualOverride: true } : {}),
      ...(key === "electricity" ? { electricityManualOverride: true } : {}),
      ...(key === "quarterRent" ? { quarterRentManualOverride: true, quarterRent: value } : {}),
    };
  } else if (field.startsWith("govCustom_")) {
    const key = field.slice("govCustom_".length);
    const customEarnings = {
      ...asRecord(gm.customEarnings ?? gm.custom_earnings),
      [key]: value,
    };
    gm = { ...gm, customEarnings, custom_earnings: customEarnings };
    gr = {
      ...gr,
      customEarnings: customEarnings as Record<string, number>,
    };
  } else if (field.startsWith("govCustomDeduction_")) {
    const key = field.slice("govCustomDeduction_".length);
    const customDeductions = {
      ...asRecord(gm.customDeductions ?? gm.custom_deductions),
      [key]: value,
    };
    gm = { ...gm, customDeductions, custom_deductions: customDeductions };
    gr = {
      ...gr,
      customDeductions: customDeductions as Record<string, number>,
    };
  } else if ((SHEET_ARREAR_KEYS as readonly string[]).includes(field)) {
    const arrearKey = field as SheetArrearKey;
    const next = {
      daArrear,
      transportArrear,
      grossArrear,
      cpfArrear,
      netArrear,
      [arrearKey]: value,
    };
    if (arrearKey === "daArrear" || arrearKey === "transportArrear") {
      const prevAuto = amount(row.grossArrear) === amount(row.daArrear) + amount(row.transportArrear);
      if (prevAuto) {
        next.grossArrear = roundRupees(next.daArrear + next.transportArrear);
      }
    }
    if (arrearKey === "grossArrear" || arrearKey === "cpfArrear") {
      const prevAutoNet =
        amount(row.netArrear) === Math.max(0, amount(row.grossArrear) - amount(row.cpfArrear));
      if (prevAutoNet) {
        next.netArrear = Math.max(0, roundRupees(next.grossArrear - next.cpfArrear));
      }
    }
    daArrear = next.daArrear;
    transportArrear = next.transportArrear;
    grossArrear = next.grossArrear;
    cpfArrear = next.cpfArrear;
    netArrear = next.netArrear;
    gm = {
      ...gm,
      daArrearsPaid: daArrear,
      transportArrearsPaid: transportArrear,
      da_arrears_paid: daArrear,
      transport_arrears_paid: transportArrear,
      grossArrear,
      cpfArrear,
      netArrear,
      gross_arrear: grossArrear,
      cpf_arrear: cpfArrear,
      net_arrear: netArrear,
    };
    // Arrear edits are sheet-only; do not freeze earnings/deductions or force CPF override.
    gr = { ...gr };
  } else {
    return row;
  }

  gm = recalculateGovernmentSheetTotals(gm, opts?.payrollFieldDefs);
  const nextRow = syncRowAggregatesFromGm(
    {
      ...row,
      govRecalc: gr,
      daArrear,
      transportArrear,
      grossArrear,
      cpfArrear,
      netArrear,
    },
    gm,
  );
  return nextRow;
}

/** Whether this field should use the sheet (totals-only) path. */
export function isGovernmentSheetMonetaryField(field: string): boolean {
  if (field.startsWith("govEarning_")) {
    return (SHEET_EARNING_KEYS as readonly string[]).includes(field.slice("govEarning_".length));
  }
  if (field.startsWith("govDeduction_")) {
    return (SHEET_DEDUCTION_KEYS as readonly string[]).includes(field.slice("govDeduction_".length));
  }
  if (field.startsWith("govCustom_") || field.startsWith("govCustomDeduction_")) return true;
  return (SHEET_ARREAR_KEYS as readonly string[]).includes(field);
}

/** Calculation-driver fields that must full-recalculate and clear monetary overrides. */
export function isGovernmentCalculationDriverField(field: string): boolean {
  return (
    field === "payDays" ||
    field === "unpaidLeaveDays" ||
    field === "hplDays" ||
    field === "eolDays" ||
    field === "eolReferenceMonth" ||
    field === "eolReferenceYear" ||
    field === "hplReferenceMonth" ||
    field === "hplReferenceYear" ||
    field === "electricityUnitsConsumed" ||
    field === "nightHours" ||
    field === "nightAllowanceRate"
  );
}

/**
 * Clear monthly monetary overrides so the next full payroll calculation can
 * replace Basic/CPF/Water/etc. with freshly calculated values.
 * Keeps Master-seeded deductionDefaults and HPL/EOL day/reference inputs.
 */
export function clearMonetaryOverridesFromGovRecalc(gr: GovRecalcPayload): GovRecalcPayload {
  return {
    ...gr,
    earningPaidOverrides: undefined,
    deductionPaidOverrides: undefined,
    cpfManualOverride: false,
    hplDeductionManualOverride: false,
    eolDeductionManualOverride: false,
    electricityManualOverride: false,
    quarterRentManualOverride: false,
    nightAllowanceManualOverride: false,
  };
}
