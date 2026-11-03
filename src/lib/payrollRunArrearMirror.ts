import { roundMoney } from "./money";
import { arrearChain } from "./payrollArrearCalc";
/**
 * Run Payroll: the Arrears (UNPAID) section is the only editable place for the
 * statutory arrears. The same figures shown in the Earnings / Deductions rows are
 * read-only mirrors of it (one stored value, never two editable copies).
 */

export type UnpaidArrearsSource = {
  daArrear?: number | null;
  transportArrear?: number | null;
  grossArrear?: number | null;
  cpfArrear?: number | null;
  netArrear?: number | null;
  governmentMonthly?: {
    daArrearsPaid?: number | null;
    transportArrearsPaid?: number | null;
    grossArrear?: number | null;
    cpfArrear?: number | null;
    netArrear?: number | null;
  } | null;
};

export const ARREAR_MIRROR_HINT = "edit in Arrears (Unpaid)";

export function resolveUnpaidArrears(row: UnpaidArrearsSource) {
  const g = row.governmentMonthly;
  const daArrear = roundMoney(Number(row.daArrear ?? g?.daArrearsPaid ?? 0) || 0);
  const trArrear = roundMoney(Number(row.transportArrear ?? g?.transportArrearsPaid ?? 0) || 0);
  const cpfArrear = roundMoney(Number(row.cpfArrear ?? g?.cpfArrear ?? 0) || 0);
  // Gross Arrears = DA + TR and Net Arrears = Gross - CPF Arr are derived live, never read as typed values.
  return { daArrear, trArrear, cpfArrear, ...arrearChain(daArrear, trArrear, cpfArrear) };
}

/** Earnings / deductions line keys that only mirror the unpaid section. */
export type MirroredArrearKey = "daArrearsPaid" | "transportArrearsPaid" | "grossArrear" | "netArrear" | "cpfArrear";

const MIRRORED: ReadonlySet<string> = new Set<MirroredArrearKey>([
  "daArrearsPaid",
  "transportArrearsPaid",
  "grossArrear",
  "netArrear",
  "cpfArrear",
]);

export function isMirroredArrearKey(key: string): key is MirroredArrearKey {
  return MIRRORED.has(key);
}

/** Value of a mirrored line, read from the unpaid section's single source. */
export function mirroredArrearValue(row: UnpaidArrearsSource, key: MirroredArrearKey): number {
  const a = resolveUnpaidArrears(row);
  switch (key) {
    case "daArrearsPaid": return a.daArrear;
    case "transportArrearsPaid": return a.trArrear;
    case "grossArrear": return a.grossArrear;
    case "netArrear": return a.netArrear;
    case "cpfArrear": return a.cpfArrear;
  }
}

/**
 * The generic custom "Arrears" field (field_key `arrears`) is hidden on the Run
 * Payroll screen for rows where it is 0/empty and shown (editable) where it holds
 * a value, so no stored amount is ever hidden. Other custom fields always show.
 */
export function isCustomEarningVisibleOnRow(fieldKey: string, amount: number): boolean {
  if (fieldKey !== "arrears") return true;
  return Number.isFinite(amount) && amount !== 0;
}
