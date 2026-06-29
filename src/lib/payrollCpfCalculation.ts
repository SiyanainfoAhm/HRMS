/** CPF/PF basis resolution — keep in sync with backend PayrollFieldRegistry */

export type CpfCalculationConfig = {
  cpfPercentage: number;
  cpfBasisFieldKeys: string[];
};

export const DEFAULT_CPF_PERCENTAGE = 12;

/** Legacy: all standard earning components (matches total earnings before allowances). */
export const DEFAULT_CPF_BASIS_KEYS = ["gross_basic", "da", "hra", "medical", "transport"];

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

export function cpfFormulaPreview(basisLabels: string[], percentage: number): string {
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
): number {
  if (cpfDefaultFromMaster > 0) {
    return Math.round(cpfDefaultFromMaster);
  }
  if (basisAmount > 0) {
    return Math.round(basisAmount * (cpfPercentage / 100));
  }
  return Math.round(legacyTotalEarnings * (DEFAULT_CPF_PERCENTAGE / 100));
}

export type MasterCpfConfigInput = {
  cpfUseCompanySettings?: boolean;
  cpfPercentageOverride?: number | string | null;
  cpfBasisFieldKeysOverride?: string[];
  companyCpfPercentage?: number | string;
  companyCpfBasisFieldKeys?: string[];
};

export function resolveEffectiveCpfConfigForMaster(input: MasterCpfConfigInput): CpfCalculationConfig {
  const companyPct = Number(input.companyCpfPercentage) || DEFAULT_CPF_PERCENTAGE;
  const companyBasis =
    input.companyCpfBasisFieldKeys && input.companyCpfBasisFieldKeys.length > 0
      ? input.companyCpfBasisFieldKeys
      : DEFAULT_CPF_BASIS_KEYS;

  if (input.cpfUseCompanySettings !== false) {
    return { cpfPercentage: companyPct, cpfBasisFieldKeys: companyBasis };
  }

  const overridePct = input.cpfPercentageOverride;
  const pct =
    overridePct !== undefined && overridePct !== null && overridePct !== ""
      ? Number(overridePct) || companyPct
      : companyPct;

  const basis =
    input.cpfBasisFieldKeysOverride && input.cpfBasisFieldKeysOverride.length > 0
      ? input.cpfBasisFieldKeysOverride
      : companyBasis;

  return { cpfPercentage: pct, cpfBasisFieldKeys: basis };
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

  let sum = 0;
  for (const key of basisKeys) {
    if (customEarnings[key] != null) {
      sum += Number(customEarnings[key]) || 0;
    } else if (amounts[key] != null) {
      sum += amounts[key];
    }
  }

  return Math.round(sum);
}
