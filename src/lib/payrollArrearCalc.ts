/** Excel-style DA + transport DA arrear math (mirrors PayrollArrearService). */

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
  const oldDa = Math.round((basic * oldDaPercent) / 100);
  const newDa = Math.round((basic * newDaPercent) / 100);
  const daArrear = newDa - oldDa;

  const oldTrpt = Math.round(transportBase + (transportBase * oldDaPercent) / 100);
  const newTrpt = Math.round(transportBase + (transportBase * newDaPercent) / 100);
  const transportArrear = newTrpt - oldTrpt;

  const grossArrear = daArrear + transportArrear;
  const cpfArrear = Math.round(grossArrear * cpfRate * 100) / 100;
  const netArrear = Math.round((grossArrear - cpfArrear) * 100) / 100;

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

function r2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
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
  const grossA = presentNumber(arrear?.grossArrear) ?? r2(daA + trA);
  // Net Arrears is a derived memo (Gross Arrears - CPF Arr). A passed-in value is
  // never trusted: UI rows default it to 0, which used to be stored next to a
  // positive Gross Arrears (CIRT-07).
  const netA = r2(Math.max(0, grossA - cpfA));

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

  // DA and transport arrears are their own earning lines; a gross arrear larger
  // than their sum is the remainder recorded only as gross.
  const supplemental = Math.max(0, r2(grossA - (daA + trA)));
  const totalEarnings = r2(baseEarnings + daA + trA + supplemental);
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
 * Total arrears paid in a month. Gross arrear is the aggregate that already
 * contains DA + transport arrear, so only the part not covered by those two
 * lines is added (same rule as the sheet totals and the PHP PayrollTotals).
 */
export function totalArrearsPaid(daArrear: unknown, transportArrear: unknown, grossArrear: unknown): number {
  const nonNegative = (v: unknown) => Math.max(0, r2(presentNumber(v) ?? 0));
  const da = nonNegative(daArrear);
  const tr = nonNegative(transportArrear);
  const gross = nonNegative(grossArrear);
  return r2(da + tr + Math.max(0, r2(gross - (da + tr))));
}
