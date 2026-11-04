import { percentOf, percentOfCeil, proportion, roundMoney, sumMoney } from "./money";
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
import type { EolHplReferenceSalary } from "./hplEolDeductions";
import { computeLeaveCuts, normalizeLeaveLines, type LeaveLine } from "./leaveDeductions";
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
  /** Leave lines (type, month/year, days). When present they replace hplDays/eolDays + the reference months. */
  leaveLines?: LeaveLine[];
  /**
   * TR arrears that are added to the row AFTER this calculation (the Run Payroll arrear path). CPF counts them
   * (CIRT rule), so they are passed in here; when they are already in the optional earnings the larger of the two is used.
   */
  transportArrearForCpf?: number;
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
  /** "duty" = per-8-hour-duty rate (CIRT-08); anything else = legacy per-hour rate. */
  nightAllowanceRateBasis?: "duty" | "hour";
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
  return proportion(actual, dim - u, dim);
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
  /** Total taken off the paid lines for EOL (Basic + DA + HRA + Medical) / HPL (Basic + DA), all leave lines summed. */
  eolBasisAmount?: number;
  hplBasisAmount?: number;
  eolAdjustment?: number;
  hplAdjustment?: number;
  /** The leave lines the deduction was calculated from, with the resolved Basic / DA % / days per line. */
  leaveLines?: LeaveLine[];
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
  nightAllowanceRateBasis?: "duty" | "hour";
  nightAllowanceAmount?: number;
  nightAllowanceBasicCeiling?: number;
  nightAllowanceEligible?: boolean;
  nightAllowanceSlabNo?: number | null;
  nightAllowanceManualOverride?: boolean;
  nightAllowanceWarning?: string;
};

export function computeGovernmentMonthlyPayroll(input: GovernmentMonthlyInput): GovernmentMonthlyComputed {
  const gb = roundMoney(Number(input.grossBasic) || 0);
  const slab = deriveTransportSlabFromLevel(
    input.payLevel,
    gb,
    input.transportSettings ?? DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
  );
  const daPctForTransport = Number(input.daPercent) || 0;
  const transportDa = percentOf(slab.transportBase, daPctForTransport);
  const transportActual = roundMoney(slab.transportBase + transportDa);
  const transportPaid = transportActual;

  const daPct = Number(input.daPercent) || 0;
  const hraPct = Number(input.hraPercent) || 0;
  const medFixed = roundMoney(Number(input.medicalFixed) || 0);

  const basicActual = gb;
  const daActual = percentOf(gb, daPct);
  const hasQuarter = Boolean(input.hasQuarter);
  const hraActual = hasQuarter ? 0 : percentOf(gb, hraPct);
  const medicalActual = medFixed;

  const dim = Math.max(1, Math.floor(input.daysInMonth));
  const unpaid = Math.max(0, Math.min(Math.floor(input.unpaidDays), dim));

  const basicPaid = paidAfterUnpaidDays(basicActual, dim, unpaid);
  const daPaid = paidAfterUnpaidDays(daActual, dim, unpaid);
  const hraPaid = paidAfterUnpaidDays(hraActual, dim, unpaid);
  const medicalPaid = paidAfterUnpaidDays(medicalActual, dim, unpaid);

  const opt = input.optionalEarnings ?? {};
  const sp = roundMoney(Number(opt.spPay) || 0);
  const ewa = roundMoney(Number(opt.extraWorkAllowance) || 0);
  const ua = roundMoney(Number(opt.uniformAllowance) || 0);
  const eda = roundMoney(Number(opt.educationAllowance) || 0);
  const daa = roundMoney(Number(opt.daArrears) || 0);
  const tra = roundMoney(Number(opt.transportArrears) || 0);
  const enc = roundMoney(Number(opt.encashment) || 0);
  const encDa = roundMoney(Number(opt.encashmentDa) || 0);

  const eo = input.earningPaidOverrides ?? {};
  const pickPaid = (computed: number, key: keyof GovernmentEarningPaidOverrides): number => {
    const v = eo[key];
    if (v != null && Number.isFinite(Number(v))) return roundMoney(Number(v));
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
  // Leave (HPL / EOL) per the CIRT leave calculation: each line is cut on its own leave month, Basic first,
  // then DA / HRA / Medical derived from the Basic cut (see leaveDeductions.ts). The cut is taken off the paid
  // earnings lines, so the auto HPL / EOL deduction lines stay 0 (no double counting). A manual HPL / EOL
  // override skips the earnings cut for that leave type and uses the typed deduction instead.
  const leaveLines = normalizeLeaveLines(
    {
      leaveLines: input.leaveLines,
      hplDays: input.hplDays,
      eolDays: input.eolDays,
      hplReferenceMonth: hplRefMonth,
      hplReferenceYear: hplRefYear,
      eolReferenceMonth: eolRefMonth,
      eolReferenceYear: eolRefYear,
      hplReferenceSalary: input.hplReferenceSalary,
      eolReferenceSalary: input.eolReferenceSalary,
      hplReferenceDaysInMonth: input.hplReferenceDaysInMonth,
      eolReferenceDaysInMonth: input.eolReferenceDaysInMonth,
    },
    runMonth,
    runYear,
  );
  const leaveCtx = { runMonth, runYear, grossBasic: gb, daPercent: daPct, hraPercent: hraPct, medicalFixed: medFixed };
  const hplAuto = computeLeaveCuts(leaveLines.filter((l) => l.type === "HPL"), leaveCtx);
  const eolAuto = computeLeaveCuts(leaveLines.filter((l) => l.type === "EOL"), leaveCtx);
  const leaveAll = computeLeaveCuts(leaveLines, leaveCtx);
  const hplLeave = { hplDays: hplAuto.hplDays, hplBasisAmount: hplAuto.hplAdjustment, hplDeduction: 0 };
  const eolLeave = { eolDays: eolAuto.eolDays, eolBasisAmount: eolAuto.eolAdjustment, eolDeduction: 0 };

  let eolDeduction = input.eolDeductionManualOverride ? roundMoney(d.eol) : 0;
  let hplDeduction = input.hplDeductionManualOverride ? roundMoney(d.hpl) : 0;

  const cutOf = (c: ReturnType<typeof computeLeaveCuts>, paid: number, key: "basic" | "da" | "hra" | "medical") =>
    Math.min(Math.max(0, paid), c[key]);
  let basicOut = basicPaidF;
  let daOut = daPaidF;
  let hraOut = hraPaidF;
  let medicalOut = medicalPaidF;
  if (!input.eolDeductionManualOverride) {
    basicOut = sumMoney(basicOut, -cutOf(eolAuto, basicOut, "basic"));
    daOut = sumMoney(daOut, -cutOf(eolAuto, daOut, "da"));
    hraOut = sumMoney(hraOut, -cutOf(eolAuto, hraOut, "hra"));
    medicalOut = sumMoney(medicalOut, -cutOf(eolAuto, medicalOut, "medical"));
  }
  if (!input.hplDeductionManualOverride) {
    basicOut = sumMoney(basicOut, -cutOf(hplAuto, basicOut, "basic"));
    daOut = sumMoney(daOut, -cutOf(hplAuto, daOut, "da"));
  }
  const leaveWarning = leaveAll.lines.map((l) => l.warning).find(Boolean);

  const nightRate = Math.max(0, Number(input.nightAllowanceRate) || 0);
  const nightHours = Math.max(0, Number(input.nightHours) || 0);
  const nightCeiling = Math.max(
    0,
    Number(input.nightAllowanceBasicCeiling) || DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING,
  );
  const basicForCeiling = basicPaidF > 0 ? basicPaidF : basicActual;
  const nightResolved = resolveNightAllowanceAmount({
    hours: nightHours,
    rate: nightRate,
    rateBasis: input.nightAllowanceRateBasis === "hour" ? "hour" : "duty",
    basicPay: basicForCeiling,
    ceiling: nightCeiling,
    manualOverride: input.nightAllowanceManualOverride,
    manualAmount: eo.nightAllowancePaid,
    slabWarning: input.nightAllowanceWarning,
  });
  const naF = nightResolved.amount;

  // Sum order matches government payslip line sequence (Basic → DA → HRA → Medical → TA → SP Pay → others).
  const totalEarnings = sumMoney(
    basicOut,
    daOut,
    hraOut,
    medicalOut,
    transportPaidF,
    spF,
    ewaF,
    naF,
    uaF,
    edaF,
    daaF,
    traF,
    encF,
    encDaF,
    customEarningsTotal,
  );

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
      ? roundMoney(Number(cpfFixedRaw))
      : 0;
  // Prefer explicit CPF config from master resolve over stale deductionDefaults.cpf —
  // unless admin set a Run Payroll CPF override (0 is valid).
  let cpfAmount: number;
  if (input.cpfManualOverride) {
    const raw = d.cpf;
    const n = Number(raw);
    cpfAmount = Number.isFinite(n) ? Math.max(0, roundMoney(n)) : 0;
  } else if (cpfMode === "fixed_amount") {
    // Explicit fixed amount — including intentional ₹0.
    cpfAmount = Number.isFinite(cpfFixed) ? cpfFixed : 0;
  } else {
    const basisSum = cpfBasis.reduce((s, k) => {
      if (customEarnings[k] != null) return s + (Number(customEarnings[k]) || 0);
      return s + (basisAmounts[k] ?? 0);
    }, 0);
    // CIRT rule (confirmed against FoxPro): whenever TR arrears are paid in the month, CPF = % of (basis + TR arrears), rounded UP
    // to the next rupee. Without TR arrears the configured basis and normal rounding apply, as before.
    const trArrearsForCpf = Math.max(traF, roundMoney(Number(input.transportArrearForCpf) || 0));
    cpfAmount =
      basisSum > 0 && trArrearsForCpf > 0
        ? percentOfCeil(basisSum + (cpfBasis.includes("transport_arrears") ? trArrearsForCpf - traF : trArrearsForCpf), cpfPct)
        : calculateCpfFromBasis(0, basisSum, cpfPct, totalEarnings, cpfMode, cpfFixed);
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
    ? roundMoney(
        (() => {
          const raw = input.quarterRent ?? d.quarterRent;
          if (raw === null || raw === undefined) return 0;
          const n = Number(raw);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        })(),
      )
    : 0;

  const deductions: GovernmentDeductionDefaults = {
    incomeTax: roundMoney(d.incomeTax),
    pt: roundMoney(d.pt),
    lic: roundMoney(d.lic),
    cpf: cpfAmount,
    daCpf: roundMoney(d.daCpf),
    vpf: roundMoney(d.vpf),
    pfLoan: roundMoney(d.pfLoan),
    postOffice: roundMoney(d.postOffice),
    creditSociety: roundMoney(d.creditSociety),
    stdLicenceFee: roundMoney(d.stdLicenceFee),
    electricity: electricityAmount,
    water: roundMoney(d.water),
    mess: roundMoney(d.mess),
    loanRecovery: roundMoney(d.loanRecovery),
    welfare: roundMoney(d.welfare),
    hpl: hplDeduction,
    eol: eolDeduction,
    vehCharge: roundMoney(d.vehCharge),
    other: roundMoney(d.other),
    quarterRent: quarterRentAmount,
  };

  const totalDeductions = sumMoney(
    deductions.incomeTax,
    deductions.pt,
    deductions.lic,
    deductions.cpf,
    deductions.daCpf,
    deductions.vpf,
    deductions.pfLoan,
    deductions.postOffice,
    deductions.creditSociety,
    deductions.stdLicenceFee,
    deductions.electricity,
    deductions.water,
    deductions.mess,
    deductions.loanRecovery,
    deductions.welfare,
    deductions.hpl,
    deductions.eol,
    deductions.vehCharge,
    deductions.other,
    deductions.quarterRent,
    customDeductionsTotal,
  );

  const netSalary = roundMoney(totalEarnings - totalDeductions);

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
    eolAdjustment: eolAuto.eolAdjustment,
    hplAdjustment: hplAuto.hplAdjustment,
    leaveLines: leaveAll.lines.map(({ type, month, year, days, grossBasic, daPercent, daysInMonth, warning }) => ({
      type, month, year, days, grossBasic, daPercent, daysInMonth, ...(warning ? { warning } : {}),
    })),
    eolReferenceWarning: input.eolReferenceWarning ?? leaveWarning,
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
    nightAllowanceRateBasis: input.nightAllowanceRateBasis === "hour" ? "hour" : "duty",
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
