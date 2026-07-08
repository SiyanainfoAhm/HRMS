/** CPF/PF basis resolution — keep in sync with backend PayrollFieldRegistry */

export type CpfCalculationMode = "percentage" | "fixed_amount";

export type CpfCalculationConfig = {
  cpfPercentage: number;
  cpfBasisFieldKeys: string[];
  cpfCalculationMode?: CpfCalculationMode;
  cpfFixedAmount?: number;
};

export const DEFAULT_CPF_PERCENTAGE = 12;

/** Legacy: all standard earning components (matches total earnings before allowances). */
export const DEFAULT_CPF_BASIS_KEYS = ["gross_basic", "da", "hra", "medical", "transport"];

/** Employee-level CPF override (API/DB may send `0` instead of boolean `false`). */
export function isCpfEmployeeCustomMode(value: unknown): boolean {
  return value === false || value === 0 || value === "0" || value === "false";
}

export function isCpfCompanyDefaultMode(value: unknown): boolean {
  return !isCpfEmployeeCustomMode(value);
}

export function normalizeCpfUseCompanySettings(value: unknown, defaultCompany = true): boolean {
  if (value === undefined || value === null) return defaultCompany;
  return !isCpfEmployeeCustomMode(value);
}

export type RunPayrollBasisAmounts = Record<string, number>;

export function resolveRunCpfBasisAmount(
  basisKeys: string[],
  amounts: RunPayrollBasisAmounts,
  customEarnings: Record<string, number> = {},
): number {
  let sum = 0;
  for (const key of basisKeys) {
    if (customEarnings[key] != null) {
      sum += Number(customEarnings[key]) || 0;
    } else if (amounts[key] != null) {
      sum += Number(amounts[key]) || 0;
    }
  }
  return Math.round(sum);
}

export function cpfFormulaPreview(
  basisLabels: string[],
  percentage: number,
  mode: CpfCalculationMode = "percentage",
  fixedAmount = 0,
): string {
  if (mode === "fixed_amount") {
    const amt = Math.round(Number(fixedAmount) || 0);
    return `CPF = Fixed Amount (₹${amt.toLocaleString("en-IN")})`;
  }
  const labels = basisLabels.length ? basisLabels.join(" + ") : "—";
  const pct = Number.isInteger(percentage) ? String(percentage) : String(percentage);
  return `CPF = (${labels}) × ${pct}%`;
}

export function runPayrollBasisAmountsFromComputed(computed: {
  basicPaid: number;
  daPaid: number;
  hraPaid: number;
  medicalPaid: number;
  transportPaid: number;
  spPayPaid: number;
  extraWorkAllowancePaid: number;
  nightAllowancePaid: number;
  uniformAllowancePaid: number;
  educationAllowancePaid: number;
  daArrearsPaid: number;
  transportArrearsPaid: number;
}): RunPayrollBasisAmounts {
  return {
    gross_basic: computed.basicPaid,
    da: computed.daPaid,
    hra: computed.hraPaid,
    medical: computed.medicalPaid,
    transport: computed.transportPaid,
    sp_pay: computed.spPayPaid,
    extra_work_allowance: computed.extraWorkAllowancePaid,
    night_allowance: computed.nightAllowancePaid,
    uniform_allowance: computed.uniformAllowancePaid,
    education_allowance: computed.educationAllowancePaid,
    da_arrears: computed.daArrearsPaid,
    transport_arrears: computed.transportArrearsPaid,
  };
}

export function calculateCpfFromBasis(
  cpfDefaultFromMaster: number,
  basisAmount: number,
  cpfPercentage: number,
  legacyTotalEarnings: number,
  mode: CpfCalculationMode = "percentage",
  fixedAmount = 0,
  opts?: { strictBasis?: boolean },
): number {
  if (mode === "fixed_amount") {
    const fixed = Math.round(Number(fixedAmount) || 0);
    if (fixed > 0) return fixed;
  }
  if (cpfDefaultFromMaster > 0) {
    return Math.round(cpfDefaultFromMaster);
  }
  if (basisAmount > 0) {
    return Math.round(basisAmount * (cpfPercentage / 100));
  }
  if (opts?.strictBasis) {
    return 0;
  }
  const pct = Number(cpfPercentage) || DEFAULT_CPF_PERCENTAGE;
  return Math.round(legacyTotalEarnings * (pct / 100));
}

export type MasterCpfConfigInput = {
  cpfUseCompanySettings?: boolean | number | string | null;
  cpfPercentageOverride?: number | string | null;
  cpfBasisFieldKeysOverride?: string[];
  cpfCalculationModeOverride?: CpfCalculationMode | string | null;
  cpfFixedAmountOverride?: number | string | null;
  companyCpfPercentage?: number | string;
  companyCpfBasisFieldKeys?: string[];
  companyCpfCalculationMode?: CpfCalculationMode | string;
  companyCpfFixedAmount?: number | string;
};

export function resolveEffectiveCpfConfigForMaster(input: MasterCpfConfigInput): CpfCalculationConfig {
  const companyPct = Number(input.companyCpfPercentage) || DEFAULT_CPF_PERCENTAGE;
  const companyBasis =
    input.companyCpfBasisFieldKeys && input.companyCpfBasisFieldKeys.length > 0
      ? input.companyCpfBasisFieldKeys
      : DEFAULT_CPF_BASIS_KEYS;
  const companyMode: CpfCalculationMode =
    input.companyCpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage";
  const companyFixed = Math.round(Number(input.companyCpfFixedAmount) || 0);

  const customMode = isCpfEmployeeCustomMode(input.cpfUseCompanySettings);

  if (!customMode) {
    return {
      cpfPercentage: companyPct,
      cpfBasisFieldKeys: companyBasis,
      cpfCalculationMode: companyMode,
      cpfFixedAmount: companyFixed,
    };
  }

  const overridePct = input.cpfPercentageOverride;
  const pct =
    overridePct !== undefined && overridePct !== null && overridePct !== ""
      ? Number(overridePct) || companyPct
      : companyPct;

  const basis = input.cpfBasisFieldKeysOverride ?? [];

  const mode: CpfCalculationMode =
    input.cpfCalculationModeOverride === "fixed_amount" ? "fixed_amount" : "percentage";
  const fixed =
    input.cpfFixedAmountOverride !== undefined && input.cpfFixedAmountOverride !== null
      ? Math.round(Number(input.cpfFixedAmountOverride) || 0)
      : companyFixed;

  return {
    cpfPercentage: pct,
    cpfBasisFieldKeys: basis,
    cpfCalculationMode: mode,
    cpfFixedAmount: fixed,
  };
}

export function resolveMasterCpfBasisAmount(
  calc: {
    gross_basic_pay?: number;
    da_amount?: number;
    hra_amount?: number;
    medical?: number;
    transport_total?: number;
  },
  basisKeys: string[],
  customEarnings: Record<string, number> = {},
): number {
  const amounts: Record<string, number> = {
    gross_basic: calc.gross_basic_pay ?? 0,
    da: calc.da_amount ?? 0,
    hra: calc.hra_amount ?? 0,
    medical: calc.medical ?? 0,
    transport: calc.transport_total ?? 0,
    sp_pay: 0,
    extra_work_allowance: 0,
    night_allowance: 0,
    uniform_allowance: 0,
    education_allowance: 0,
    da_arrears: 0,
    transport_arrears: 0,
    gross_arrears: 0,
    net_arrears: 0,
  };
  for (const [key, value] of Object.entries(customEarnings)) {
    if (Number.isFinite(Number(value))) {
      amounts[key] = Number(value);
    }
  }

  let sum = 0;
  for (const key of basisKeys) {
    sum += Number(amounts[key]) || 0;
  }

  return Math.round(sum);
}
