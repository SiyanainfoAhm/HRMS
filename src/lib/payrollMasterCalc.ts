/**
 * Payroll master preview calculations (aligned with PayrollCalculationService.php).
 */

import {
  calculateCpfFromBasis,
  isCpfEmployeeCustomMode,
  resolveEffectiveCpfConfigForMaster,
  resolveMasterCpfBasisAmount,
} from "./payrollCpfCalculation";
import { sumCustomBagForTotal, type PayrollFieldDefinition } from "./payrollFieldTypes";
import {
  DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  deriveTransportSlab,
  getTransportBaseByPayLevel,
  type TransportAllowanceSettings,
} from "./transportAllowanceSettings";

export const DEFAULT_DA_PERCENT = 53;
export const DEFAULT_HRA_PERCENT = 30;
export const DEFAULT_MEDICAL = 3000;
export const DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS = 0.12;

export {
  DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  deriveTransportSlab,
  getTransportBaseByPayLevel,
  type TransportAllowanceSettings,
};

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
  /** When true, honour `totalEarnings` as an explicit override. Default: derive from components. */
  useStoredTotalEarnings?: boolean;
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
  cpfCalculationModeOverride?: "percentage" | "fixed_amount" | string;
  cpfFixedAmountOverride?: number | string | null;
  companyCpfPercentage?: number | string;
  companyCpfBasisFieldKeys?: string[];
  companyCpfCalculationMode?: "percentage" | "fixed_amount" | string;
  companyCpfFixedAmount?: number | string;
  customEarnings?: Record<string, number>;
  customDeductions?: Record<string, number>;
  hasQuarter?: boolean;
  quarterId?: string | null;
  quarterRent?: number;
  payrollFieldDefs?: import("./payrollFieldTypes").PayrollFieldDefinition[];
  /** Institute Transport Allowance settings (from Settings → Institute). */
  transportSettings?: TransportAllowanceSettings;
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
  cpfBasisAmount: number;
  cpfEffective: number;
};

function roundRupees(n: number): number {
  return Math.round(n);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function computePayrollMasterPreview(input: PayrollMasterPreviewInput): PayrollMasterPreview {
  const payLevel = Math.max(1, Math.floor(num(input.payLevel, 1)));
  const grossBasic = Math.max(0, input.grossBasicPay === "" ? 0 : num(input.grossBasicPay, 0));
  const daPercent = num(input.daPercent, DEFAULT_DA_PERCENT);
  const hraPercent = num(input.hraPercent, DEFAULT_HRA_PERCENT);
  // Empty medical while typing → 0 for live totals (do not snap to DEFAULT_MEDICAL mid-edit).
  const medical =
    input.medical === "" ? 0 : Math.max(0, num(input.medical, DEFAULT_MEDICAL));

  const transportSettings = input.transportSettings ?? DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS;
  const slab = deriveTransportSlab(payLevel, grossBasic, transportSettings);
  let transportBase = slab.base;
  let transportDa = roundRupees(transportBase * daPercent / 100);
  let transportTotal = roundRupees(transportBase + transportDa);

  let daAmount = roundRupees(grossBasic * daPercent / 100);
  let hraAmount = roundRupees(grossBasic * hraPercent / 100);

  const hasQuarter = Boolean(input.hasQuarter || input.quarterId);
  if (hasQuarter) {
    hraAmount = 0;
  }

  if (input.daAmount !== undefined && input.daAmount !== null) {
    // Empty while typing → 0 for live totals (do not keep a stale prior amount).
    daAmount = input.daAmount === "" ? 0 : Math.max(0, roundRupees(num(input.daAmount, 0)));
  }
  if (input.hraAmount !== undefined && input.hraAmount !== null) {
    hraAmount = input.hraAmount === "" ? 0 : Math.max(0, roundRupees(num(input.hraAmount, 0)));
  }
  if (input.transportBase !== undefined && input.transportBase !== null) {
    transportBase =
      input.transportBase === "" ? 0 : Math.max(0, roundRupees(num(input.transportBase, 0)));
  }
  if (input.transportDa !== undefined && input.transportDa !== null) {
    transportDa =
      input.transportDa === "" ? 0 : Math.max(0, roundRupees(num(input.transportDa, 0)));
  }
  if (input.transportTotal !== undefined && input.transportTotal !== null) {
    // Explicit 0 / empty-while-editing must NOT fall back to slab.
    transportTotal =
      input.transportTotal === "" ? 0 : Math.max(0, roundRupees(num(input.transportTotal, 0)));
  } else {
    transportTotal = roundRupees(transportBase + transportDa);
  }

  // Always derive Total Earnings from CURRENT components (never a stale stored total).
  let totalEarnings = roundRupees(grossBasic + daAmount + hraAmount + medical + transportTotal);
  const customEarningsTotal = sumCustomBagForTotal(
    input.customEarnings ?? {},
    input.payrollFieldDefs,
    "earnings",
  );
  totalEarnings = roundRupees(totalEarnings + customEarningsTotal);
  // Optional explicit override only when caller opts in (manual Total Earnings edit).
  if (
    input.useStoredTotalEarnings &&
    input.totalEarnings !== undefined &&
    input.totalEarnings !== null &&
    input.totalEarnings !== ""
  ) {
    totalEarnings = Math.max(0, roundRupees(num(input.totalEarnings, totalEarnings)));
  }

  const cpfDefault = num(input.cpfDefault, 0);
  const cpfConfig = resolveEffectiveCpfConfigForMaster({
    cpfUseCompanySettings: input.cpfUseCompanySettings,
    cpfPercentageOverride: input.cpfPercentageOverride,
    cpfBasisFieldKeysOverride: input.cpfBasisFieldKeysOverride,
    cpfCalculationModeOverride: input.cpfCalculationModeOverride,
    cpfFixedAmountOverride: input.cpfFixedAmountOverride,
    companyCpfPercentage: input.companyCpfPercentage,
    companyCpfBasisFieldKeys: input.companyCpfBasisFieldKeys,
    companyCpfCalculationMode: input.companyCpfCalculationMode,
    companyCpfFixedAmount: input.companyCpfFixedAmount,
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
    cpfConfig.cpfCalculationMode ?? "percentage",
    cpfConfig.cpfFixedAmount ?? 0,
    { strictBasis: isCpfEmployeeCustomMode(input.cpfUseCompanySettings) },
  );

  const daCpf = roundRupees(num(input.daCpf, 0));
  // Empty PT while typing → 0 for live totals (do not snap to 200 mid-edit).
  const professionalTax =
    input.professionalTax === ""
      ? 0
      : roundRupees(num(input.professionalTax, input.professionalTax === undefined ? 200 : 0));
  const incomeTax = input.incomeTax === "" ? 0 : roundRupees(num(input.incomeTax, 0));
  const lic = input.lic === "" ? 0 : roundRupees(num(input.lic, 0));
  const mess = input.mess === "" ? 0 : roundRupees(num(input.mess, 0));
  const welfare = input.welfare === "" ? 0 : roundRupees(num(input.welfare, 0));
  const vpf = input.vpf === "" ? 0 : roundRupees(num(input.vpf, 0));
  const pfLoan = input.pfLoan === "" ? 0 : roundRupees(num(input.pfLoan, 0));
  const postOffice = input.postOffice === "" ? 0 : roundRupees(num(input.postOffice, 0));
  const creditSociety = input.creditSociety === "" ? 0 : roundRupees(num(input.creditSociety, 0));
  const standardLicenceFee =
    input.standardLicenceFee === "" ? 0 : roundRupees(num(input.standardLicenceFee, 0));
  const electricity = input.electricity === "" ? 0 : roundRupees(num(input.electricity, 0));
  const water = input.water === "" ? 0 : roundRupees(num(input.water, 0));
  const loanRecovery = input.loanRecovery === "" ? 0 : roundRupees(num(input.loanRecovery, 0));
  const vehicleCharge = input.vehicleCharge === "" ? 0 : roundRupees(num(input.vehicleCharge, 0));
  const otherDeduction = input.otherDeduction === "" ? 0 : roundRupees(num(input.otherDeduction, 0));
  const advance = input.advance === "" ? 0 : roundRupees(num(input.advance, 0));

  const customDeductionsTotal = sumCustomBagForTotal(
    input.customDeductions ?? {},
    input.payrollFieldDefs,
    "deductions",
  );
  const quarterRentDeduction = hasQuarter ? roundRupees(num(input.quarterRent, 0)) : 0;

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
      advance +
      quarterRentDeduction +
      customDeductionsTotal,
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
    cpfBasisAmount,
    cpfEffective,
  };
}

/** Live Payroll Master summary — always derived from current form components. */
export function calculatePayrollMasterSummary(
  input: PayrollMasterPreviewInput,
): Pick<
  PayrollMasterPreview,
  "totalEarnings" | "totalDeductions" | "takeHome" | "cpfEffective" | "cpfBasisAmount" | "transportTotal"
> {
  const preview = computePayrollMasterPreview({
    ...input,
    useStoredTotalEarnings: false,
  });
  return {
    totalEarnings: preview.totalEarnings,
    totalDeductions: preview.totalDeductions,
    takeHome: preview.takeHome,
    cpfEffective: preview.cpfEffective,
    cpfBasisAmount: preview.cpfBasisAmount,
    transportTotal: preview.transportTotal,
  };
}

/** Derive formula-driven earning fields (DA/HRA/transport slab) without applying stored totals. */
export function deriveEarningFieldValues(
  input: PayrollMasterPreviewInput,
): Pick<
  PayrollMasterPreview,
  "daAmount" | "hraAmount" | "transportBase" | "transportDa" | "transportTotal" | "totalEarnings"
> {
  const preview = computePayrollMasterPreview({
    payLevel: input.payLevel,
    grossBasicPay: input.grossBasicPay,
    daPercent: input.daPercent,
    hraPercent: input.hraPercent,
    medical: input.medical,
    hasQuarter: input.hasQuarter,
    quarterId: input.quarterId,
    customEarnings: input.customEarnings,
    payrollFieldDefs: input.payrollFieldDefs,
    transportSettings: input.transportSettings,
  });
  return {
    daAmount: preview.daAmount,
    hraAmount: preview.hraAmount,
    transportBase: preview.transportBase,
    transportDa: preview.transportDa,
    transportTotal: preview.transportTotal,
    totalEarnings: preview.totalEarnings,
  };
}
