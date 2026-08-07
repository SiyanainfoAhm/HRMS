import {
  computeGovernmentMonthlyPayroll,
  governmentMonthlyExtras,
  type GovernmentDeductionDefaults,
  type GovernmentEarningPaidOverrides,
} from "./governmentPayroll";
import { DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING } from "./nightAllowanceCalculation";
import type { PayrollConfig } from "./payrollFieldTypes";
import type { CpfCalculationConfig } from "./payrollCpfCalculation";
import type { EolHplReferenceSalary } from "./hplEolDeductions";
import { govOptionalFromComputedMonthly } from "./govRunPayrollOptionalEarnings";

export type GovRecalcPayload = {
  grossBasic: number;
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
  payLevel: number;
  hplDays?: number;
  eolDays?: number;
  leaveRemarks?: string | null;
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
  electricityManualOverride?: boolean;
  nightHours?: number;
  nightAllowanceRate?: number;
  nightAllowanceSlabNo?: number | null;
  nightAllowanceManualOverride?: boolean;
  nightAllowanceWarning?: string;
  quarterRentManualOverride?: boolean;
  deductionDefaults: GovernmentDeductionDefaults;
  earningPaidOverrides?: GovernmentEarningPaidOverrides;
  customEarnings?: Record<string, number>;
  customDeductions?: Record<string, number>;
  cpfConfig?: CpfCalculationConfig;
  hasQuarter?: boolean;
  quarterRent?: number;
};

export function defaultGovRecalcReferencePeriod(runYear: number, runMonth: number) {
  return {
    eolReferenceMonth: runMonth,
    eolReferenceYear: runYear,
    hplReferenceMonth: runMonth,
    hplReferenceYear: runYear,
  };
}

export function runGovernmentPayrollCompute(
  gr: GovRecalcPayload,
  opts: {
    daysInMonth: number;
    payDays: number;
    payrollConfig?: PayrollConfig | null;
    runYear: number;
    runMonth: number;
    governmentMonthly?: Record<string, unknown> | null;
  },
) {
  const dim = Math.max(1, Math.floor(opts.daysInMonth));
  const capped = Math.max(0, Math.min(dim, Math.floor(opts.payDays)));
  const unpaidDays = Math.max(0, dim - capped);
  const electricityUnitRate =
    Number(opts.payrollConfig?.calculationSettings?.electricityUnitRate) || 0;
  const nightAllowanceBasicCeiling =
    Number(opts.payrollConfig?.calculationSettings?.nightAllowanceBasicCeiling) ||
    DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING;
  const optionalEarnings = govOptionalFromComputedMonthly(opts.governmentMonthly ?? null);
  const comp = computeGovernmentMonthlyPayroll({
    grossBasic: gr.grossBasic,
    daPercent: gr.daPercent,
    hraPercent: gr.hraPercent,
    medicalFixed: gr.medicalFixed,
    payLevel: gr.payLevel,
    daysInMonth: dim,
    unpaidDays,
    hplDays: gr.hplDays ?? 0,
    eolDays: gr.eolDays ?? 0,
    eolReferenceMonth: gr.eolReferenceMonth ?? opts.runMonth,
    eolReferenceYear: gr.eolReferenceYear ?? opts.runYear,
    hplReferenceMonth: gr.hplReferenceMonth ?? opts.runMonth,
    hplReferenceYear: gr.hplReferenceYear ?? opts.runYear,
    eolReferenceSalary: gr.eolReferenceSalary,
    hplReferenceSalary: gr.hplReferenceSalary,
    eolReferenceDaysInMonth: gr.eolReferenceDaysInMonth ?? dim,
    hplReferenceDaysInMonth: gr.hplReferenceDaysInMonth ?? dim,
    eolReferenceWarning: gr.eolReferenceWarning,
    hplReferenceWarning: gr.hplReferenceWarning,
    eolDeductionManualOverride: gr.eolDeductionManualOverride,
    hplDeductionManualOverride: gr.hplDeductionManualOverride,
    electricityUnitsConsumed: gr.electricityUnitsConsumed ?? 0,
    electricityUnitRate,
    electricityManualOverride: gr.electricityManualOverride,
    nightHours: gr.nightHours ?? 0,
    nightAllowanceRate: gr.nightAllowanceRate ?? 0,
    nightAllowanceBasicCeiling,
    nightAllowanceManualOverride: gr.nightAllowanceManualOverride,
    nightAllowanceSlabNo: gr.nightAllowanceSlabNo ?? null,
    nightAllowanceWarning: gr.nightAllowanceWarning,
    quarterRentManualOverride: gr.quarterRentManualOverride,
    runMonth: opts.runMonth,
    runYear: opts.runYear,
    deductionDefaults: gr.deductionDefaults,
    optionalEarnings,
    earningPaidOverrides: gr.earningPaidOverrides,
    hasQuarter: gr.hasQuarter,
    quarterRent: gr.quarterRent,
    ...governmentMonthlyExtras(gr, opts.payrollConfig),
    cpfConfig: gr.cpfConfig,
  });
  return { comp, capped, unpaidDays };
}
