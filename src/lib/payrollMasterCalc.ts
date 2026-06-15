/**
 * Payroll master preview calculations (aligned with PayrollCalculationService.php).
 */

export const DEFAULT_DA_PERCENT = 53;
export const DEFAULT_HRA_PERCENT = 30;
export const DEFAULT_MEDICAL = 3000;
export const DEFAULT_TRANSPORT_DA_PERCENT = 48.06;
export const DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS = 0.12;

export type PayrollMasterPreviewInput = {
  payLevel?: number | string;
  grossBasicPay?: number | string;
  daPercent?: number | string;
  hraPercent?: number | string;
  medical?: number | string;
  transportDaPercent?: number | string;
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
  horticulture?: number | string;
  vehicleCharge?: number | string;
  otherDeduction?: number | string;
  advance?: number | string;
  cpfDefault?: number | string;
  daCpf?: number | string;
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

export function deriveTransportSlab(payLevel: number, grossBasic: number): { group: string; base: number } {
  if (payLevel >= 9) return { group: "LEVEL_9_ABOVE", base: 7200 };
  if (payLevel >= 3) return { group: "LEVEL_3_8", base: 3600 };
  if (grossBasic >= 24200) return { group: "LEVEL_1_2_HIGH", base: 3600 };
  return { group: "LEVEL_1_2", base: 1350 };
}

export function computePayrollMasterPreview(input: PayrollMasterPreviewInput): PayrollMasterPreview {
  const payLevel = Math.max(1, Math.floor(num(input.payLevel, 1)));
  const grossBasic = Math.max(0, num(input.grossBasicPay, 0));
  const daPercent = num(input.daPercent, DEFAULT_DA_PERCENT);
  const hraPercent = num(input.hraPercent, DEFAULT_HRA_PERCENT);
  const medical = num(input.medical, DEFAULT_MEDICAL);
  const transportDaPercent = num(input.transportDaPercent, DEFAULT_TRANSPORT_DA_PERCENT);

  const slab = deriveTransportSlab(payLevel, grossBasic);
  const transportDa = roundRupees(slab.base * transportDaPercent / 100);
  const transportTotal = roundRupees(slab.base + transportDa);

  const daAmount = roundRupees(grossBasic * daPercent / 100);
  const hraAmount = roundRupees(grossBasic * hraPercent / 100);
  const totalEarnings = roundRupees(grossBasic + daAmount + hraAmount + medical + transportTotal);

  const cpfDefault = num(input.cpfDefault, 0);
  const cpfEffective =
    cpfDefault > 0 ? roundRupees(cpfDefault) : roundRupees(totalEarnings * DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS);

  const daCpf = roundRupees(num(input.daCpf, 0));
  const professionalTax = roundRupees(num(input.professionalTax, 200));
  const incomeTax = roundRupees(num(input.incomeTax, 0));
  const lic = roundRupees(num(input.lic, 0));
  const mess = roundRupees(num(input.mess, 0));
  const welfare = roundRupees(num(input.welfare, 0));
  const vpf = roundRupees(num(input.vpf, 0));
  const pfLoan = roundRupees(num(input.pfLoan, 0));
  const postOffice = roundRupees(num(input.postOffice, 0));
  const creditSociety = roundRupees(num(input.creditSociety, 0));
  const standardLicenceFee = roundRupees(num(input.standardLicenceFee, 0));
  const electricity = roundRupees(num(input.electricity, 0));
  const water = roundRupees(num(input.water, 0));
  const horticulture = roundRupees(num(input.horticulture, 0));
  const vehicleCharge = roundRupees(num(input.vehicleCharge, 0));
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
      horticulture +
      welfare +
      vehicleCharge +
      otherDeduction +
      advance,
  );

  const takeHome = roundRupees(totalEarnings - totalDeductions);

  return {
    daAmount,
    hraAmount,
    transportBase: slab.base,
    transportDa,
    transportTotal,
    totalEarnings,
    totalDeductions,
    takeHome,
    cpfEffective,
  };
}
