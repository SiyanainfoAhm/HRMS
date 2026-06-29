/**
 * Payroll master preview calculations (aligned with PayrollCalculationService.php).
 */

import {
  calculateCpfFromBasis,
  resolveEffectiveCpfConfigForMaster,
  resolveMasterCpfBasisAmount,
} from "./payrollCpfCalculation";

export const DEFAULT_DA_PERCENT = 53;
export const DEFAULT_HRA_PERCENT = 30;
export const DEFAULT_MEDICAL = 3000;
export const DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS = 0.12;

export type PayrollMasterPreviewInput = {
  payLevel?: number | string;
  grossBasicPay?: number | string;
  daPercent?: number | string;
  hraPercent?: number | string;
  medical?: number | string;
  daAmount?: number | string;
  hraAmount?: number | string;
  transportBase?: number | string;
  transportDa?: number | string;
  transportTotal?: number | string;
  totalEarnings?: number | string;
  professionalTax?: number | string;
  incomeTax?: number | string;
  lic?: number | string;
  mess?: number | string;
  welfare?: number | string;
  vpf?: number | string;
  pfLoan?: number | string;
  postOffice?: number | string;
  creditSociety?: number | string;
  standardLicenceFee?: number | string;
  electricity?: number | string;
  water?: number | string;
  loanRecovery?: number | string;
  vehicleCharge?: number | string;
  otherDeduction?: number | string;
  advance?: number | string;
  cpfDefault?: number | string;
  daCpf?: number | string;
  cpfUseCompanySettings?: boolean;
  cpfPercentageOverride?: number | string | null;
  cpfBasisFieldKeysOverride?: string[];
  companyCpfPercentage?: number | string;
  companyCpfBasisFieldKeys?: string[];
  customEarnings?: Record<string, number>;
};

export type PayrollMasterPreview = {
  daAmount: number;
  hraAmount: number;
  transportBase: number;
  transportDa: number;
  transportTotal: number;
  totalEarnings: number;
  totalDeductions: number;
  takeHome: number;
  cpfEffective: number;
};

function roundRupees(n: number): number {
  return Math.round(n);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Government transport allowance base by pay level (levels 1–2: 1350, 3–8: 3600, 9+: 7200). */
export function getTransportBaseByPayLevel(payLevel: number): number {
  const lv = Math.max(0, Math.floor(Number(payLevel) || 0));
  if (lv >= 9) return 7200;
  if (lv >= 3) return 3600;
  if (lv >= 1) return 1350;
  return 0;
}

export function deriveTransportSlab(payLevel: number): { group: string; base: number } {
  const base = getTransportBaseByPayLevel(payLevel);
  if (payLevel >= 9) return { group: "LEVEL_9_ABOVE", base };
  if (payLevel >= 3) return { group: "LEVEL_3_8", base };
  if (payLevel >= 1) return { group: "LEVEL_1_2", base };
  return { group: "UNKNOWN", base: 0 };
}

export function computePayrollMasterPreview(input: PayrollMasterPreviewInput): PayrollMasterPreview {
  const payLevel = Math.max(1, Math.floor(num(input.payLevel, 1)));
  const grossBasic = Math.max(0, num(input.grossBasicPay, 0));
  const daPercent = num(input.daPercent, DEFAULT_DA_PERCENT);
  const hraPercent = num(input.hraPercent, DEFAULT_HRA_PERCENT);
  const medical = num(input.medical, DEFAULT_MEDICAL);

  const slab = deriveTransportSlab(payLevel);
  let transportBase = slab.base;
  let transportDa = roundRupees(transportBase * daPercent / 100);
  let transportTotal = roundRupees(transportBase + transportDa);

  let daAmount = roundRupees(grossBasic * daPercent / 100);
  let hraAmount = roundRupees(grossBasic * hraPercent / 100);

  if (input.daAmount !== undefined && input.daAmount !== "") {
    daAmount = roundRupees(num(input.daAmount, daAmount));
  }
  if (input.hraAmount !== undefined && input.hraAmount !== "") {
    hraAmount = roundRupees(num(input.hraAmount, hraAmount));
  }
  if (input.transportBase !== undefined && input.transportBase !== "") {
    transportBase = roundRupees(num(input.transportBase, transportBase));
  }
  if (input.transportDa !== undefined && input.transportDa !== "") {
    transportDa = roundRupees(num(input.transportDa, transportDa));
  }
  if (input.transportTotal !== undefined && input.transportTotal !== "") {
    transportTotal = roundRupees(num(input.transportTotal, transportTotal));
  } else {
    transportTotal = roundRupees(transportBase + transportDa);
  }

  let totalEarnings = roundRupees(grossBasic + daAmount + hraAmount + medical + transportTotal);
  if (input.totalEarnings !== undefined && input.totalEarnings !== "") {
    totalEarnings = roundRupees(num(input.totalEarnings, totalEarnings));
  }

  const cpfDefault = num(input.cpfDefault, 0);
  const cpfConfig = resolveEffectiveCpfConfigForMaster({
    cpfUseCompanySettings: input.cpfUseCompanySettings,
    cpfPercentageOverride: input.cpfPercentageOverride,
    cpfBasisFieldKeysOverride: input.cpfBasisFieldKeysOverride,
    companyCpfPercentage: input.companyCpfPercentage,
    companyCpfBasisFieldKeys: input.companyCpfBasisFieldKeys,
  });
  const cpfBasisAmount = resolveMasterCpfBasisAmount(
    {
      gross_basic_pay: grossBasic,
      da_amount: daAmount,
      hra_amount: hraAmount,
      medical,
      transport_total: transportTotal,
    },
    cpfConfig.cpfBasisFieldKeys,
    input.customEarnings ?? {},
  );
  const cpfEffective = calculateCpfFromBasis(
    cpfDefault,
    cpfBasisAmount,
    cpfConfig.cpfPercentage,
    totalEarnings,
  );

  const daCpf = roundRupees(num(input.daCpf, 0));
  const professionalTax = roundRupees(num(input.professionalTax, 200));
  const incomeTax = roundRupees(num(input.incomeTax, 0));
  const lic = roundRupees(num(input.lic, 0));
  const mess = roundRupees(num(input.mess, 0));
  const welfare = roundRupees(num(input.welfare, 0));
  const vpf = roundRupees(num(input.vpf, 0));
  const pfLoan = 0;
  const postOffice = roundRupees(num(input.postOffice, 0));
  const creditSociety = roundRupees(num(input.creditSociety, 0));
  const standardLicenceFee = 0;
  const electricity = roundRupees(num(input.electricity, 0));
  const water = roundRupees(num(input.water, 0));
  const loanRecovery = roundRupees(num(input.loanRecovery, 0));
  const vehicleCharge = 0;
  const otherDeduction = roundRupees(num(input.otherDeduction, 0));
  const advance = roundRupees(num(input.advance, 0));

  const totalDeductions = roundRupees(
    incomeTax +
      professionalTax +
      lic +
      cpfEffective +
      daCpf +
      vpf +
      pfLoan +
      postOffice +
      creditSociety +
      standardLicenceFee +
      electricity +
      water +
      mess +
      loanRecovery +
      welfare +
      vehicleCharge +
      otherDeduction +
      advance,
  );

  const takeHome = roundRupees(totalEarnings - totalDeductions);

  return {
    daAmount,
    hraAmount,
    transportBase,
    transportDa,
    transportTotal,
    totalEarnings,
    totalDeductions,
    takeHome,
    cpfEffective,
  };
}
