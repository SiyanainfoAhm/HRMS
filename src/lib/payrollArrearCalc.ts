/** Excel-style DA + transport DA arrear math (mirrors PayrollArrearService). */
import { percentOf, roundMoney } from "./money";

export type ArrearMonthCalc = {
  basic: number;
  transportBase: number;
  oldDaPercent: number;
  newDaPercent: number;
  oldDaAmount: number;
  newDaAmount: number;
  daArrear: number;
  oldTransportAmount: number;
  newTransportAmount: number;
  transportArrear: number;
  grossArrear: number;
  cpfRate: number;
  cpfArrear: number;
  netArrear: number;
};

export function calculateMonthDaArrear(
  basic: number,
  transportBase: number,
  oldDaPercent: number,
  newDaPercent: number,
  cpfRate = 0.12,
): ArrearMonthCalc {
  const oldDa = percentOf(basic, oldDaPercent);
  const newDa = percentOf(basic, newDaPercent);
  const daArrear = newDa - oldDa;

  const oldTrpt = roundMoney(transportBase + percentOf(transportBase, oldDaPercent));
  const newTrpt = roundMoney(transportBase + percentOf(transportBase, newDaPercent));
  const transportArrear = newTrpt - oldTrpt;

  const grossArrear = daArrear + transportArrear;
  const cpfArrear = percentOf(grossArrear, cpfRate * 100);
  const netArrear = roundMoney(grossArrear - cpfArrear);

  return {
    basic,
    transportBase,
    oldDaPercent,
    newDaPercent,
    oldDaAmount: oldDa,
    newDaAmount: newDa,
    daArrear,
    oldTransportAmount: oldTrpt,
    newTransportAmount: newTrpt,
    transportArrear,
    grossArrear,
    cpfRate: cpfRate * 100,
    cpfArrear,
    netArrear,
  };
}

/** Arrear amounts follow the money rule (whole rupees). */
function r2(n: number): number {
  return roundMoney(n);
}

/**
 * THE arrears chain (mirror: PayrollTotals::arrearChain in PHP, shared fixture
 * backend/tests/fixtures/arrear_chain_cases.json). DA, TR and CPF Arrears are the inputs;
 * Gross Arrears = DA + TR and Net Arrears = Gross - CPF Arrears are always derived, never typed.
 * Gross Arrears is already inside the DA and TR earning lines, so it is a memo (never added again);
 * Net Arrears is a memo too (Net Pay = Gross - Total Deductions, which holds CPF Arr once).
 */
export function arrearChain(da: unknown, tr: unknown, cpf: unknown): { grossArrear: number; netArrear: number } {
  const n = (v: unknown) => r2(Number.isFinite(Number(v)) ? Number(v) : 0);
  const grossArrear = r2(n(da) + n(tr));
  return { grossArrear, netArrear: r2(grossArrear - n(cpf)) };
}

/** A present number (including an entered 0); undefined for null/blank/NaN. */
function presentNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Merge arrear totals into a government monthly compute snapshot.
 *
 * Idempotent: whatever arrear the snapshot already carries (DA/TR lines fed back
 * through the compute engine, gross-only arrear, CPF arrear) is removed before
 * the given arrear is added, so recomputing a row never counts arrears twice.
 * An entered 0 is a value, not "missing".
 */
export function applyAutoArrearsToGovernmentMonthly<T extends Record<string, unknown>>(
  comp: T,
  arrear: {
    daArrear?: number;
    transportArrear?: number;
    cpfArrear?: number;
    grossArrear?: number;
    netArrear?: number;
  } | null | undefined,
): T & { grossArrear: number; cpfArrear: number; netArrear: number } {
  const daA = presentNumber(arrear?.daArrear) ?? 0;
  const trA = presentNumber(arrear?.transportArrear) ?? 0;
  const cpfA = presentNumber(arrear?.cpfArrear) ?? 0;
  // Gross Arrears = DA + TR and Net Arrears = Gross - CPF Arr, always derived (a passed-in gross/net is ignored).
  const { grossArrear: grossA, netArrear: netA } = arrearChain(daA, trA, cpfA);

  // Arrear already inside the snapshot totals.
  const daIn = presentNumber(comp.daArrearsPaid) ?? 0;
  const trIn = presentNumber(comp.transportArrearsPaid) ?? 0;
  const grossIn = presentNumber(comp.grossArrear) ?? 0;
  const cpfIn = presentNumber(comp.cpfArrear) ?? 0;
  const suppIn = Math.max(0, r2(grossIn - (daIn + trIn)));
  const baseEarnings = r2((presentNumber(comp.totalEarnings) ?? 0) - daIn - trIn - suppIn);
  const baseDeductions = r2((presentNumber(comp.totalDeductions) ?? 0) - cpfIn);

  if (Math.abs(grossA) < 0.001 && Math.abs(cpfA) < 0.001 && daA === 0 && trA === 0) {
    const netSalary = r2(baseEarnings - baseDeductions);
    return {
      ...comp,
      daArrearsPaid: 0,
      daArrearsActual: 0,
      transportArrearsPaid: 0,
      transportArrearsActual: 0,
      grossArrear: 0,
      cpfArrear: 0,
      netArrear: 0,
      totalEarnings: baseEarnings,
      totalDeductions: baseDeductions,
      netSalary,
    };
  }

  // DA and transport arrears are the only arrear earning lines; Gross Arrears is their sum, counted once.
  const totalEarnings = r2(baseEarnings + daA + trA);
  const totalDeductions = r2(baseDeductions + cpfA);
  const netSalary = r2(totalEarnings - totalDeductions);

  return {
    ...comp,
    daArrearsPaid: daA,
    daArrearsActual: daA,
    transportArrearsPaid: trA,
    transportArrearsActual: trA,
    grossArrear: grossA,
    cpfArrear: cpfA,
    netArrear: netA,
    totalEarnings,
    totalDeductions,
    netSalary,
  };
}

/**
 * Total arrears paid in a month = Gross Arrears = DA + TR (the chain above). The gross argument is kept for
 * old callers and ignored: Gross Arrears is never an independent amount.
 */
export function totalArrearsPaid(daArrear: unknown, transportArrear: unknown, _grossArrear?: unknown): number {
  const nonNegative = (v: unknown) => Math.max(0, r2(presentNumber(v) ?? 0));
  return r2(nonNegative(daArrear) + nonNegative(transportArrear));
}
