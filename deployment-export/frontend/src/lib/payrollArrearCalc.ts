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
  const cpfArrear = grossArrear * cpfRate;
  const netArrear = grossArrear - cpfArrear;

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

/** Merge backend-computed arrear totals into a government monthly compute snapshot. */
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
  const daA = Number(arrear?.daArrear) || 0;
  const trA = Number(arrear?.transportArrear) || 0;
  const cpfA = Number(arrear?.cpfArrear) || 0;
  const grossA = Number(arrear?.grossArrear) || daA + trA;
  const netA = Number(arrear?.netArrear) || grossA - cpfA;

  if (Math.abs(grossA) < 0.001) {
    return {
      ...comp,
      grossArrear: 0,
      cpfArrear: 0,
      netArrear: 0,
    };
  }

  const totalEarnings = Number(comp.totalEarnings) + grossA;
  const totalDeductions = Number(comp.totalDeductions) + cpfA;
  const netSalary = Number(comp.netSalary) + netA;

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
