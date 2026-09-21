import {
  calculateCpfFromBasis,
  DEFAULT_CPF_BASIS_KEYS,
  DEFAULT_CPF_PERCENTAGE,
  type CpfCalculationConfig,
  type CpfCalculationMode,
  runPayrollBasisAmountsFromComputed,
} from "./payrollCpfCalculation";
import type { PayrollConfig } from "./payrollFieldTypes";
import { sumCustomBagForTotal } from "./payrollFieldTypes";
import {
  computeEolHplDeductions,
  applyProportionalEarningsCut,
  applyBasicDaEarningsCut,
  isSamePayrollReferencePeriod,
  type EolHplReferenceSalary,
} from "./hplEolDeductions";
import { DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING, resolveNightAllowanceAmount } from "./nightAllowanceCalculation";
import { masterRecordToDeductionDefaults } from "./masterRunPayrollMapping";
import {
  calculateElectricityBill,
  type ElectricityBillBreakdown,
  type ElectricityTariffConfig,
} from "./electricityTariffCalculation";

import {
  DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  deriveTransportSlab,
  getTransportBaseByPayLevel,
  type TransportAllowanceSettings,
} from "./transportAllowanceSettings";

export type TransportSlab = { transportSlabGroup: string; transportBase: number };

export {
  DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  getTransportBaseByPayLevel,
  type TransportAllowanceSettings,
};

export function deriveTransportSlabFromLevel(
  level: number | null | undefined,
  grossBasicPay = 0,
  settings: TransportAllowanceSettings = DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
): TransportSlab {
  if (level == null || !Number.isFinite(Number(level))) {
    throw new Error("government_pay_level is required for government payroll");
  }
  const lv = Math.floor(Number(level));
  if (lv < 1) throw new Error("government_pay_level must be at least 1");
  const slab = deriveTransportSlab(lv, grossBasicPay, settings);
  return { transportSlabGroup: slab.group, transportBase: slab.base };
}

export type GovernmentDeductionDefaults = {
  incomeTax: number;
  pt: number;
  lic: number;
  cpf: number;
  daCpf: number;
  vpf: number;
  pfLoan: number;
  postOffice: number;
  creditSociety: number;
  stdLicenceFee: number;
  electricity: number;
  water: number;
  mess: number;
  loanRecovery: number;
  welfare: number;
  hpl: number;
  eol: number;
  vehCharge: number;
  other: number;
  quarterRent: number;
};

export type GovernmentOptionalMonthlyEarnings = {
  spPay?: number;
  extraWorkAllowance?: number;
  nightAllowance?: number;
  uniformAllowance?: number;
  educationAllowance?: number;
  daArrears?: number;
  transportArrears?: number;
  encashment?: number;
  encashmentDa?: number;
};

/** Admin overrides for paid-month amounts (Run Payroll preview / one-off run). When a key is set, it replaces the computed paid value for that line. */
export type GovernmentEarningPaidOverrides = Partial<{
  basicPaid: number;
  spPayPaid: number;
  daPaid: number;
  transportPaid: number;
  hraPaid: number;
  medicalPaid: number;
  extraWorkAllowancePaid: number;
  nightAllowancePaid: number;
  uniformAllowancePaid: number;
  educationAllowancePaid: number;
  daArrearsPaid: number;
  transportArrearsPaid: number;
  encashmentPaid: number;
  encashmentDaPaid: number;
}>;

export function governmentMonthlyExtras(
  gr: {
    customEarnings?: Record<string, number>;
    customDeductions?: Record<string, number>;
    hasQuarter?: boolean;
    has_quarter?: boolean;
    quarterRent?: number;
    quarter_rent?: number;
  },
  payrollConfig?: PayrollConfig | null,
): Pick<
  GovernmentMonthlyInput,
  "cpfConfig" | "customEarnings" | "customDeductions" | "payrollFieldDefs" | "hasQuarter" | "quarterRent"
> {
  const cs = payrollConfig?.calculationSettings;
  return {
    cpfConfig: cs
      ? {
          cpfPercentage: cs.cpfPercentage ?? DEFAULT_CPF_PERCENTAGE,
          cpfBasisFieldKeys: cs.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS,
          cpfCalculationMode: cs.cpfCalculationMode ?? "percentage",
          cpfFixedAmount: cs.cpfFixedAmount ?? 0,
        }
      : undefined,
    customEarnings: gr.customEarnings ?? {},
    customDeductions: gr.customDeductions ?? {},
    payrollFieldDefs: payrollConfig?.fields,
    hasQuarter: Boolean(gr.hasQuarter ?? gr.has_quarter),
    quarterRent: (() => {
      const raw = gr.quarterRent ?? gr.quarter_rent;
      if (raw === null || raw === undefined) return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    })(),
  };
}

export type GovernmentMonthlyInput = {
  grossBasic: number;
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
  /** From cirt_users.government_pay_level */
  payLevel: number;
  daysInMonth: number;
  unpaidDays: number;
  /** Half-pay leave days — deducted using reference month salary basis. */
  hplDays?: number;
  /** Extra ordinary leave days — deducted using reference month salary basis. */
  eolDays?: number;
  eolReferenceMonth?: number;
  eolReferenceYear?: number;
  hplReferenceMonth?: number;
  hplReferenceYear?: number;
  eolReferenceSalary?: EolHplReferenceSalary;
  hplReferenceSalary?: EolHplReferenceSalary;
  eolReferenceDaysInMonth?: number;
  hplReferenceDaysInMonth?: number;
  eolReferenceWarning?: string;
  hplReferenceWarning?: string;
  eolDeductionManualOverride?: boolean;
  hplDeductionManualOverride?: boolean;
  electricityUnitsConsumed?: number;
  electricityUnitRate?: number;
  electricityManualOverride?: boolean;
  /** Effective-dated progressive tariff (preferred over flat unit rate). */
  electricityTariff?: ElectricityTariffConfig | null;
  electricityApplicable?: boolean;
  electricityMode?: "unit_based" | "manual_fixed";
  nightHours?: number;
  nightAllowanceRate?: number;
  nightAllowanceBasicCeiling?: number;
  nightAllowanceManualOverride?: boolean;
  nightAllowanceSlabNo?: number | null;
  nightAllowanceWarning?: string;
  quarterRentManualOverride?: boolean;
  /** When true, use deductionDefaults.cpf (incl. 0) instead of recalculating from CPF config. */
  cpfManualOverride?: boolean;
  runMonth?: number;
  runYear?: number;
  deductionDefaults: GovernmentDeductionDefaults;
  /** Manual / variable earning heads (actual = paid) */
  optionalEarnings?: GovernmentOptionalMonthlyEarnings;
  /** Replace specific paid lines (e.g. admin adjustments before finalize). */
  earningPaidOverrides?: GovernmentEarningPaidOverrides;
  /** Company CPF configuration from Settings */
  cpfConfig?: CpfCalculationConfig;
  /** Institute Transport Allowance settings from Settings → Institute. */
  transportSettings?: TransportAllowanceSettings;
  /** Custom earning field values (non-system) */
  customEarnings?: Record<string, number>;
  /** Custom deduction field values (non-system) */
  customDeductions?: Record<string, number>;
  /** Employee has official quarter — HRA is not applicable */
  hasQuarter?: boolean;
  quarterRent?: number;
  /** Active payroll field definitions for include-in-total rules */
  payrollFieldDefs?: import("./payrollFieldTypes").PayrollFieldDefinition[];
};

function roundRupees(n: number): number {
  return Math.round(Number(n) || 0);
}

/**
 * When payroll master does not set `cpf_default`, employee CPF is taken as this
 * fraction of total monthly earnings (Basic+DA+HRA+Medical+TA+allowances), matching
 * common state government payslip practice (e.g. 12% of gross earnings column).
 */
export const GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS = 0.12;

/** LWP adjustment on basic, DA, HRA, medical only. */
export function paidAfterUnpaidDays(actual: number, daysInMonth: number, unpaidDays: number): number {
  const dim = Math.max(1, Math.floor(daysInMonth));
  const u = Math.max(0, Math.min(unpaidDays, dim));
  return roundRupees(actual - (actual / dim) * u);
}

export type GovernmentMonthlyComputed = {
  transportSlab: TransportSlab;
  transportActual: number;
  transportPaid: number;
  basicActual: number;
  basicPaid: number;
  spPayActual: number;
  spPayPaid: number;
  daActual: number;
  daPaid: number;
  hraActual: number;
  hraPaid: number;
  medicalActual: number;
  medicalPaid: number;
  extraWorkAllowanceActual: number;
  extraWorkAllowancePaid: number;
  nightAllowanceActual: number;
  nightAllowancePaid: number;
  uniformAllowanceActual: number;
  uniformAllowancePaid: number;
  educationAllowanceActual: number;
  educationAllowancePaid: number;
  daArrearsActual: number;
  daArrearsPaid: number;
  transportArrearsActual: number;
  transportArrearsPaid: number;
  encashmentActual: number;
  encashmentPaid: number;
  encashmentDaActual: number;
  encashmentDaPaid: number;
  deductions: GovernmentDeductionDefaults;
  customEarnings: Record<string, number>;
  customDeductions: Record<string, number>;
  hasQuarter: boolean;
  /** Effective quarter rent (mirrors deductions.quarterRent for display / draft aliases). */
  quarterRent: number;
  /** Snake-case alias used by some draft/API payloads; same value as quarterRent when set. */
  quarter_rent?: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  hplDays?: number;
  eolDays?: number;
  eolReferenceMonth?: number;
  eolReferenceYear?: number;
  hplReferenceMonth?: number;
  hplReferenceYear?: number;
  eolBasisAmount?: number;
  hplBasisAmount?: number;
  eolReferenceWarning?: string;
  hplReferenceWarning?: string;
  electricityUnitsConsumed?: number;
  electricityUnitRate?: number;
  electricityBill?: ElectricityBillBreakdown;
  electricityTariffId?: string | null;
  electricitySthirAakar?: number;
  electricityConsumptionCharge?: number;
  electricityVahanAakar?: number;
  electricityFuelCharge?: number;
  electricityDuty?: number;
  electricityTotal?: number;
  electricityApplicable?: boolean;
  electricityMode?: "unit_based" | "manual_fixed";
  nightHours?: number;
  nightAllowanceRate?: number;
  nightAllowanceAmount?: number;
  nightAllowanceBasicCeiling?: number;
  nightAllowanceEligible?: boolean;
  nightAllowanceSlabNo?: number | null;
  nightAllowanceManualOverride?: boolean;
  nightAllowanceWarning?: string;
};

export function computeGovernmentMonthlyPayroll(input: GovernmentMonthlyInput): GovernmentMonthlyComputed {
  const gb = Number(input.grossBasic) || 0;
  const slab = deriveTransportSlabFromLevel(
    input.payLevel,
    gb,
    input.transportSettings ?? DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  );
  const daPctForTransport = Number(input.daPercent) || 0;
  const transportDa = roundRupees((slab.transportBase * daPctForTransport) / 100);
  const transportActual = roundRupees(slab.transportBase + transportDa);
  const transportPaid = transportActual;

  const daPct = Number(input.daPercent) || 0;
  const hraPct = Number(input.hraPercent) || 0;
  const medFixed = Number(input.medicalFixed) || 0;

  const basicActual = gb;
  const daActual = roundRupees((gb * daPct) / 100);
  const hasQuarter = Boolean(input.hasQuarter);
  const hraActual = hasQuarter ? 0 : roundRupees((gb * hraPct) / 100);
  const medicalActual = medFixed;

  const dim = Math.max(1, Math.floor(input.daysInMonth));
  const unpaid = Math.max(0, Math.min(Math.floor(input.unpaidDays), dim));

  const basicPaid = paidAfterUnpaidDays(basicActual, dim, unpaid);
  const daPaid = paidAfterUnpaidDays(daActual, dim, unpaid);
  const hraPaid = paidAfterUnpaidDays(hraActual, dim, unpaid);
  const medicalPaid = paidAfterUnpaidDays(medicalActual, dim, unpaid);

  const opt = input.optionalEarnings ?? {};
  const sp = Number(opt.spPay) || 0;
  const ewa = Number(opt.extraWorkAllowance) || 0;
  const ua = Number(opt.uniformAllowance) || 0;
  const eda = Number(opt.educationAllowance) || 0;
  const daa = Number(opt.daArrears) || 0;
  const tra = Number(opt.transportArrears) || 0;
  const enc = Number(opt.encashment) || 0;
  const encDa = Number(opt.encashmentDa) || 0;

  const eo = input.earningPaidOverrides ?? {};
  const pickPaid = (computed: number, key: keyof GovernmentEarningPaidOverrides): number => {
    const v = eo[key];
    if (v != null && Number.isFinite(Number(v))) return roundRupees(Number(v));
    return computed;
  };

  const basicPaidF = pickPaid(basicPaid, "basicPaid");
  const daPaidF = pickPaid(daPaid, "daPaid");
  const hraPaidF = pickPaid(hraPaid, "hraPaid");
  const medicalPaidF = pickPaid(medicalPaid, "medicalPaid");
  const transportPaidF = pickPaid(transportPaid, "transportPaid");

  const spF = pickPaid(sp, "spPayPaid");
  const ewaF = pickPaid(ewa, "extraWorkAllowancePaid");
  const uaF = pickPaid(ua, "uniformAllowancePaid");
  const edaF = pickPaid(eda, "educationAllowancePaid");
  const daaF = pickPaid(daa, "daArrearsPaid");
  const traF = pickPaid(tra, "transportArrearsPaid");
  const encF = pickPaid(enc, "encashmentPaid");
  const encDaF = pickPaid(encDa, "encashmentDaPaid");

  const customEarnings = input.customEarnings ?? {};
  const customDeductions = input.customDeductions ?? {};
  const customEarningsTotal = sumCustomBagForTotal(customEarnings, input.payrollFieldDefs, "earnings");
  const customDeductionsTotal = sumCustomBagForTotal(customDeductions, input.payrollFieldDefs, "deductions");

  const d = input.deductionDefaults;

  const runMonth = input.runMonth ?? new Date().getMonth() + 1;
  const runYear = input.runYear ?? new Date().getFullYear();
  const eolRefMonth = input.eolReferenceMonth ?? runMonth;
  const eolRefYear = input.eolReferenceYear ?? runYear;
  const hplRefMonth = input.hplReferenceMonth ?? runMonth;
  const hplRefYear = input.hplReferenceYear ?? runYear;
  const eolIsCurrent = isSamePayrollReferencePeriod(eolRefMonth, eolRefYear, runMonth, runYear);
  const hplIsCurrent = isSamePayrollReferencePeriod(hplRefMonth, hplRefYear, runMonth, runYear);

  const fullMonthRef: EolHplReferenceSalary = {
    basic: basicActual,
    da: daActual,
    hra: hraActual,
    medical: medicalActual,
  };
  const eolRefSalary: EolHplReferenceSalary = eolIsCurrent
    ? fullMonthRef
    : (input.eolReferenceSalary ?? fullMonthRef);
  const hplRefSalary: EolHplReferenceSalary = hplIsCurrent
    ? fullMonthRef
    : (input.hplReferenceSalary ?? eolRefSalary);

  const eolLeave = computeEolHplDeductions({
    referenceSalary: eolRefSalary,
    daysInReferenceMonth: eolIsCurrent ? dim : (input.eolReferenceDaysInMonth ?? dim),
    eolDays: input.eolDays,
    hplDays: 0,
  });
  const hplLeave = computeEolHplDeductions({
    referenceSalary: hplRefSalary,
    daysInReferenceMonth: hplIsCurrent ? dim : (input.hplReferenceDaysInMonth ?? dim),
    eolDays: 0,
    hplDays: input.hplDays,
  });

  // Always reduce paid earnings for EOL/HPL (current or prior-month reference) so Basic/DA/HRA/Medical
  // show the cut in Earnings. Auto HPL/EOL deduction lines stay 0 to avoid double-counting;
  // manual HPL/EOL overrides skip the earnings cut and use the typed deduction amounts.
  let eolDeduction = input.eolDeductionManualOverride
    ? roundRupees(d.eol)
    : eolLeave.eolDeduction;
  let hplDeduction = input.hplDeductionManualOverride
    ? roundRupees(d.hpl)
    : hplLeave.hplDeduction;

  let basicOut = basicPaidF;
  let daOut = daPaidF;
  let hraOut = hraPaidF;
  let medicalOut = medicalPaidF;

  if (eolLeave.eolDays > 0 && !input.eolDeductionManualOverride) {
    const cut = applyProportionalEarningsCut(
      { basic: basicOut, da: daOut, hra: hraOut, medical: medicalOut },
      eolDeduction,
    );
    basicOut = cut.basic;
    daOut = cut.da;
    hraOut = cut.hra;
    medicalOut = cut.medical;
    eolDeduction = 0;
  }
  if (hplLeave.hplDays > 0 && !input.hplDeductionManualOverride) {
    const cut = applyBasicDaEarningsCut(
      { basic: basicOut, da: daOut, hra: hraOut, medical: medicalOut },
      hplDeduction,
    );
    basicOut = cut.basic;
    daOut = cut.da;
    hraOut = cut.hra;
    medicalOut = cut.medical;
    hplDeduction = 0;
  }

  const nightRate = Math.max(0, Number(input.nightAllowanceRate) || 0);
  const nightHours = Math.max(0, Number(input.nightHours) || 0);
  const nightCeiling = Math.max(
    0,
    Number(input.nightAllowanceBasicCeiling) || DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING,
  );
  const basicForCeiling = basicPaidF > 0 ? basicPaidF : basicActual;
  const nightResolved = resolveNightAllowanceAmount({
    hours: nightHours,
    ratePerHour: nightRate,
    basicPay: basicForCeiling,
    ceiling: nightCeiling,
    manualOverride: input.nightAllowanceManualOverride,
    manualAmount: eo.nightAllowancePaid,
    slabWarning: input.nightAllowanceWarning,
  });
  const naF = nightResolved.amount;

  // Sum order matches government payslip line sequence (Basic → DA → HRA → Medical → TA → SP Pay → others).
  const totalEarnings =
    basicOut +
    daOut +
    hraOut +
    medicalOut +
    transportPaidF +
    spF +
    ewaF +
    naF +
    uaF +
    edaF +
    daaF +
    traF +
    encF +
    encDaF +
    customEarningsTotal;

  const basisAmounts = runPayrollBasisAmountsFromComputed({
    basicPaid: basicOut,
    daPaid: daOut,
    hraPaid: hraOut,
    medicalPaid: medicalOut,
    transportPaid: transportPaidF,
    spPayPaid: spF,
    extraWorkAllowancePaid: ewaF,
    nightAllowancePaid: naF,
    uniformAllowancePaid: uaF,
    educationAllowancePaid: edaF,
    daArrearsPaid: daaF,
    transportArrearsPaid: traF,
  });

  const cpfPct = input.cpfConfig?.cpfPercentage ?? DEFAULT_CPF_PERCENTAGE;
  const cpfBasis = input.cpfConfig?.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS;
  const cpfMode: CpfCalculationMode =
    input.cpfConfig?.cpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage";
  const cpfFixedRaw = input.cpfConfig?.cpfFixedAmount;
  const cpfFixed =
    cpfFixedRaw !== undefined && cpfFixedRaw !== null
      ? Math.round(Number(cpfFixedRaw))
      : 0;
  // Prefer explicit CPF config from master resolve over stale deductionDefaults.cpf —
  // unless admin set a Run Payroll CPF override (0 is valid).
  let cpfAmount: number;
  if (input.cpfManualOverride) {
    const raw = d.cpf;
    const n = Number(raw);
    cpfAmount = Number.isFinite(n) ? Math.max(0, roundRupees(n)) : 0;
  } else if (cpfMode === "fixed_amount") {
    // Explicit fixed amount — including intentional ₹0.
    cpfAmount = Number.isFinite(cpfFixed) ? cpfFixed : 0;
  } else {
    const basisSum = cpfBasis.reduce((s, k) => {
      if (customEarnings[k] != null) return s + (Number(customEarnings[k]) || 0);
      return s + (basisAmounts[k] ?? 0);
    }, 0);
    cpfAmount = calculateCpfFromBasis(0, basisSum, cpfPct, totalEarnings, cpfMode, cpfFixed);
  }

  const unitRate = Math.max(0, Number(input.electricityUnitRate) || 0);
  const units = Math.max(0, Number(input.electricityUnitsConsumed) || 0);
  const electricityApplicable = input.electricityApplicable !== false;
  const electricityMode = input.electricityMode === "manual_fixed" ? "manual_fixed" : "unit_based";
  const electricityBill = calculateElectricityBill({
    units,
    tariff: input.electricityTariff ?? null,
    applicable: electricityApplicable,
    mode: electricityMode,
    legacyUnitRate: unitRate,
    fixedAmount: d.electricity,
    manualOverride: Boolean(input.electricityManualOverride),
    manualAmount: input.electricityManualOverride ? d.electricity : null,
  });
  const electricityAmount = electricityBill.total;

  // Priority: run/input rent → deduction default → 0. Explicit 0 stays 0.
  const quarterRentAmount = hasQuarter
    ? roundRupees(
        (() => {
          const raw = input.quarterRent ?? d.quarterRent;
          if (raw === null || raw === undefined) return 0;
          const n = Number(raw);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        })(),
      )
    : 0;

  const deductions: GovernmentDeductionDefaults = {
    incomeTax: roundRupees(d.incomeTax),
    pt: roundRupees(d.pt),
    lic: roundRupees(d.lic),
    cpf: cpfAmount,
    daCpf: roundRupees(d.daCpf),
    vpf: roundRupees(d.vpf),
    pfLoan: roundRupees(d.pfLoan),
    postOffice: roundRupees(d.postOffice),
    creditSociety: roundRupees(d.creditSociety),
    stdLicenceFee: roundRupees(d.stdLicenceFee),
    electricity: electricityAmount,
    water: roundRupees(d.water),
    mess: roundRupees(d.mess),
    loanRecovery: roundRupees(d.loanRecovery),
    welfare: roundRupees(d.welfare),
    hpl: hplDeduction,
    eol: eolDeduction,
    vehCharge: roundRupees(d.vehCharge),
    other: roundRupees(d.other),
    quarterRent: quarterRentAmount,
  };

  const totalDeductions =
    deductions.incomeTax +
    deductions.pt +
    deductions.lic +
    deductions.cpf +
    deductions.daCpf +
    deductions.vpf +
    deductions.pfLoan +
    deductions.postOffice +
    deductions.creditSociety +
    deductions.stdLicenceFee +
    deductions.electricity +
    deductions.water +
    deductions.mess +
    deductions.loanRecovery +
    deductions.welfare +
    deductions.hpl +
    deductions.eol +
    deductions.vehCharge +
    deductions.other +
    deductions.quarterRent +
    customDeductionsTotal;

  const netSalary = roundRupees(totalEarnings - totalDeductions);

  return {
    transportSlab: slab,
    transportActual,
    transportPaid: transportPaidF,
    basicActual,
    basicPaid: basicOut,
    spPayActual: spF,
    spPayPaid: spF,
    daActual,
    daPaid: daOut,
    hraActual,
    hraPaid: hraOut,
    medicalActual,
    medicalPaid: medicalOut,
    extraWorkAllowanceActual: ewaF,
    extraWorkAllowancePaid: ewaF,
    nightAllowanceActual: naF,
    nightAllowancePaid: naF,
    uniformAllowanceActual: uaF,
    uniformAllowancePaid: uaF,
    educationAllowanceActual: edaF,
    educationAllowancePaid: edaF,
    daArrearsActual: daaF,
    daArrearsPaid: daaF,
    transportArrearsActual: traF,
    transportArrearsPaid: traF,
    encashmentActual: encF,
    encashmentPaid: encF,
    encashmentDaActual: encDaF,
    encashmentDaPaid: encDaF,
    deductions,
    customEarnings,
    customDeductions,
    hasQuarter,
    quarterRent: deductions.quarterRent,
    quarter_rent: deductions.quarterRent,
    totalEarnings,
    totalDeductions,
    netSalary,
    hplDays: hplLeave.hplDays,
    eolDays: eolLeave.eolDays,
    eolReferenceMonth: eolRefMonth,
    eolReferenceYear: eolRefYear,
    hplReferenceMonth: hplRefMonth,
    hplReferenceYear: hplRefYear,
    eolBasisAmount: eolLeave.eolBasisAmount,
    hplBasisAmount: hplLeave.hplBasisAmount,
    eolReferenceWarning: input.eolReferenceWarning,
    hplReferenceWarning: input.hplReferenceWarning,
    electricityUnitsConsumed: units,
    electricityUnitRate: unitRate,
    electricityBill,
    electricityTariffId: electricityBill.tariffId,
    electricitySthirAakar: electricityBill.sthirAakar,
    electricityConsumptionCharge: electricityBill.consumptionCharge,
    electricityVahanAakar: electricityBill.vahanAakar,
    electricityFuelCharge: electricityBill.fuelCharge,
    electricityDuty: electricityBill.dutyAmount,
    electricityTotal: electricityBill.total,
    electricityApplicable,
    electricityMode,
    nightHours,
    nightAllowanceRate: nightRate,
    nightAllowanceAmount: naF,
    nightAllowanceBasicCeiling: nightResolved.ceiling,
    nightAllowanceEligible: nightResolved.eligible,
    nightAllowanceSlabNo: input.nightAllowanceSlabNo ?? null,
    nightAllowanceManualOverride: Boolean(input.nightAllowanceManualOverride && nightResolved.eligible),
    nightAllowanceWarning: nightResolved.warning ?? undefined,
  };
}

/** Reads monthly rupee defaults from payroll_master. CPF: when `cpf_default` is 0, `computeGovernmentMonthlyPayroll` applies configured basis × percentage. */
export function masterRowToDeductionDefaults(m: Record<string, unknown>): GovernmentDeductionDefaults {
  return masterRecordToDeductionDefaults(m);
}
