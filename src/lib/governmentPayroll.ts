import {
  calculateCpfFromBasis,
  DEFAULT_CPF_BASIS_KEYS,
  DEFAULT_CPF_PERCENTAGE,
  type CpfCalculationConfig,
  runPayrollBasisAmountsFromComputed,
} from "./payrollCpfCalculation";
import type { PayrollConfig } from "./payrollFieldTypes";
import { sumCustomBagForTotal } from "./payrollFieldTypes";

export type TransportSlab = { transportSlabGroup: string; transportBase: number };

/** Government transport allowance base by pay level (levels 1–2: 1350, 3–8: 3600, 9+: 7200). */
export function getTransportBaseByPayLevel(payLevel: number): number {
  const lv = Math.max(0, Math.floor(Number(payLevel) || 0));
  if (lv >= 9) return 7200;
  if (lv >= 3) return 3600;
  if (lv >= 1) return 1350;
  return 0;
}

export function deriveTransportSlabFromLevel(level: number | null | undefined): TransportSlab {
  if (level == null || !Number.isFinite(Number(level))) {
    throw new Error("government_pay_level is required for government payroll");
  }
  const lv = Math.floor(Number(level));
  if (lv < 1) throw new Error("government_pay_level must be at least 1");
  const transportBase = getTransportBaseByPayLevel(lv);
  if (lv >= 9) return { transportSlabGroup: "LEVEL_9_ABOVE", transportBase };
  if (lv >= 3) return { transportSlabGroup: "LEVEL_3_8", transportBase };
  return { transportSlabGroup: "LEVEL_1_2", transportBase };
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
  vehCharge: number;
  other: number;
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
  gr: { customEarnings?: Record<string, number>; customDeductions?: Record<string, number> },
  payrollConfig?: PayrollConfig | null,
): Pick<GovernmentMonthlyInput, "cpfConfig" | "customEarnings" | "customDeductions"> {
  const cs = payrollConfig?.calculationSettings;
  return {
    cpfConfig: cs
      ? {
          cpfPercentage: cs.cpfPercentage ?? DEFAULT_CPF_PERCENTAGE,
          cpfBasisFieldKeys: cs.cpfBasisFieldKeys ?? DEFAULT_CPF_BASIS_KEYS,
        }
      : undefined,
    customEarnings: gr.customEarnings ?? {},
    customDeductions: gr.customDeductions ?? {},
    payrollFieldDefs: payrollConfig?.fields,
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
  deductionDefaults: GovernmentDeductionDefaults;
  /** Manual / variable earning heads (actual = paid) */
  optionalEarnings?: GovernmentOptionalMonthlyEarnings;
  /** Replace specific paid lines (e.g. admin adjustments before finalize). */
  earningPaidOverrides?: GovernmentEarningPaidOverrides;
  /** Company CPF configuration from Settings */
  cpfConfig?: CpfCalculationConfig;
  /** Custom earning field values (non-system) */
  customEarnings?: Record<string, number>;
  /** Custom deduction field values (non-system) */
  customDeductions?: Record<string, number>;
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
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
};

export function computeGovernmentMonthlyPayroll(input: GovernmentMonthlyInput): GovernmentMonthlyComputed {
  const slab = deriveTransportSlabFromLevel(input.payLevel);
  const daPctForTransport = Number(input.daPercent) || 0;
  const transportDa = roundRupees((slab.transportBase * daPctForTransport) / 100);
  const transportActual = roundRupees(slab.transportBase + transportDa);
  const transportPaid = transportActual;

  const gb = Number(input.grossBasic) || 0;
  const daPct = Number(input.daPercent) || 0;
  const hraPct = Number(input.hraPercent) || 0;
  const medFixed = Number(input.medicalFixed) || 0;

  const basicActual = gb;
  const daActual = roundRupees((gb * daPct) / 100);
  const hraActual = roundRupees((gb * hraPct) / 100);
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
  const na = Number(opt.nightAllowance) || 0;
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
  const naF = pickPaid(na, "nightAllowancePaid");
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

  // Sum order matches government payslip line sequence (Basic → DA → HRA → Medical → TA → SP Pay → others).
  const totalEarnings =
    basicPaidF +
    daPaidF +
    hraPaidF +
    medicalPaidF +
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
    basicPaid: basicPaidF,
    daPaid: daPaidF,
    hraPaid: hraPaidF,
    medicalPaid: medicalPaidF,
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
  let cpfFromMaster = roundRupees(d.cpf);
  if (cpfFromMaster <= 0) {
    const basisSum = cpfBasis.reduce((s, k) => {
      if (customEarnings[k] != null) return s + (Number(customEarnings[k]) || 0);
      return s + (basisAmounts[k] ?? 0);
    }, 0);
    cpfFromMaster = calculateCpfFromBasis(0, basisSum, cpfPct, totalEarnings);
  }

  const deductions: GovernmentDeductionDefaults = {
    incomeTax: roundRupees(d.incomeTax),
    pt: roundRupees(d.pt),
    lic: roundRupees(d.lic),
    cpf: cpfFromMaster,
    daCpf: roundRupees(d.daCpf),
    vpf: roundRupees(d.vpf),
    pfLoan: roundRupees(d.pfLoan),
    postOffice: roundRupees(d.postOffice),
    creditSociety: roundRupees(d.creditSociety),
    stdLicenceFee: roundRupees(d.stdLicenceFee),
    electricity: roundRupees(d.electricity),
    water: roundRupees(d.water),
    mess: roundRupees(d.mess),
    loanRecovery: roundRupees(d.loanRecovery),
    welfare: roundRupees(d.welfare),
    vehCharge: roundRupees(d.vehCharge),
    other: roundRupees(d.other),
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
    deductions.vehCharge +
    deductions.other +
    customDeductionsTotal;

  const netSalary = roundRupees(totalEarnings - totalDeductions);

  return {
    transportSlab: slab,
    transportActual,
    transportPaid: transportPaidF,
    basicActual,
    basicPaid: basicPaidF,
    spPayActual: spF,
    spPayPaid: spF,
    daActual,
    daPaid: daPaidF,
    hraActual,
    hraPaid: hraPaidF,
    medicalActual,
    medicalPaid: medicalPaidF,
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
    totalEarnings,
    totalDeductions,
    netSalary,
  };
}

/** Reads monthly rupee defaults from payroll_master. CPF: when `cpf_default` is 0, `computeGovernmentMonthlyPayroll` applies configured basis × percentage. */
export function masterRowToDeductionDefaults(m: Record<string, unknown>): GovernmentDeductionDefaults {
  return {
    incomeTax: Number(m.income_tax_default ?? m.tds ?? 0) || 0,
    pt: Number(m.pt_default ?? 200) || 0,
    lic: Number(m.lic_default ?? 0) || 0,
    cpf: Number(m.cpf_default ?? 0) || 0,
    daCpf: Number(m.da_cpf_default ?? 0) || 0,
    vpf: Number(m.vpf_default ?? 0) || 0,
    pfLoan: 0,
    postOffice: Number(m.post_office_default ?? 0) || 0,
    creditSociety: Number(m.credit_society_default ?? 0) || 0,
    stdLicenceFee: 0,
    electricity: Number(m.electricity_default ?? 0) || 0,
    water: Number(m.water_default ?? 0) || 0,
    mess: Number(m.mess_default ?? 0) || 0,
    loanRecovery:
      Number(m.loanRecoveryDefault ?? m.loan_recovery_default ?? (m as { horticultureDefault?: number }).horticultureDefault ?? 0) ||
      0,
    welfare: Number(m.welfare_default ?? 0) || 0,
    vehCharge: 0,
    other: Number(m.other_deduction_default ?? 0) || 0,
  };
}
