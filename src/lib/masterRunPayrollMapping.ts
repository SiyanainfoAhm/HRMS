/**
 * Map Payroll Master API / DB fields → Run Payroll deductionDefaults.
 * Prefer primary columns (water, lic, …) over legacy *_default aliases.
 * Explicit 0 is authoritative (nullish-aware, never `|| fallback`).
 */
import { firstDefined } from "./effectivePayrollValue";
import type { GovernmentDeductionDefaults } from "./governmentPayroll";

/** First finite number among candidates; undefined if none. Empty string skipped. */
export function pickMasterNumeric(
  ...candidates: Array<unknown>
): number | undefined {
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Resolve amount with optional system default when master has no value. */
export function masterAmountOr(
  defaultWhenMissing: number,
  ...candidates: Array<unknown>
): number {
  const v = pickMasterNumeric(...candidates);
  return v === undefined ? defaultWhenMissing : v;
}

/**
 * Build Run Payroll deductionDefaults from a Payroll Master API object
 * (camelCase from master service, or *Default / snake from run/masters list).
 */
export function masterRecordToDeductionDefaults(
  m: Record<string, unknown>,
  opts?: { companyPt?: number; quarterRent?: number },
): GovernmentDeductionDefaults {
  const companyPt = opts?.companyPt ?? 200;
  const quarterRent =
    opts?.quarterRent !== undefined
      ? opts.quarterRent
      : masterAmountOr(0, m.quarterRent, m.quarter_rent);

  return {
    incomeTax: masterAmountOr(0, m.incomeTax, m.incomeTaxDefault, m.income_tax, m.income_tax_default, m.tds),
    pt: masterAmountOr(companyPt, m.professionalTax, m.pt, m.ptDefault, m.pt_default),
    lic: masterAmountOr(0, m.lic, m.licDefault, m.lic_default),
    cpf: masterAmountOr(0, m.cpfDefault, m.cpf_default, m.cpf),
    daCpf: masterAmountOr(0, m.daCpf, m.daCpfDefault, m.da_cpf, m.da_cpf_default),
    vpf: masterAmountOr(0, m.vpf, m.vpfDefault, m.vpf_default),
    pfLoan: masterAmountOr(0, m.pfLoan, m.pfLoanDefault, m.pf_loan, m.pf_loan_default),
    postOffice: masterAmountOr(0, m.postOffice, m.postOfficeDefault, m.post_office, m.post_office_default),
    creditSociety: masterAmountOr(
      0,
      m.creditSociety,
      m.creditSocietyDefault,
      m.credit_society,
      m.credit_society_default,
    ),
    stdLicenceFee: masterAmountOr(
      0,
      m.standardLicenceFee,
      m.stdLicenceFeeDefault,
      m.standard_licence_fee,
      m.std_licence_fee_default,
    ),
    electricity: masterAmountOr(0, m.electricity, m.electricityDefault, m.electricity_default),
    water: masterAmountOr(0, m.water, m.waterDefault, m.water_default),
    mess: masterAmountOr(0, m.mess, m.messDefault, m.mess_default),
    loanRecovery: masterAmountOr(
      0,
      m.loanRecovery,
      m.loanRecoveryDefault,
      m.loan_recovery,
      m.loan_recovery_default,
      m.horticultureDefault,
      m.horticulture_default,
    ),
    welfare: masterAmountOr(0, m.welfare, m.welfareDefault, m.welfare_default),
    hpl: 0,
    eol: 0,
    vehCharge: masterAmountOr(
      0,
      m.vehicleCharge,
      m.vehChargeDefault,
      m.vehicle_charge,
      m.veh_charge_default,
    ),
    other: masterAmountOr(
      0,
      m.otherDeduction,
      m.otherDeductionDefault,
      m.other_deduction,
      m.other_deduction_default,
    ),
    quarterRent: Math.max(0, quarterRent),
  };
}

/** Convenience: resolve a single Master→Run field for tests / callers. */
export function resolveMasterDeductionField(
  m: Record<string, unknown>,
  field: keyof GovernmentDeductionDefaults,
): number {
  return masterRecordToDeductionDefaults(m)[field];
}

export function resolveMasterMedicalFixed(m: Record<string, unknown>): number {
  return (
    firstDefined(
      pickMasterNumeric(m.medicalFixed, m.medical_fixed, m.medical),
      3000,
    ) ?? 3000
  );
}

export function resolveMasterTransportTotal(m: Record<string, unknown>): number | undefined {
  return pickMasterNumeric(m.transportTotal, m.transport_total, m.trans);
}
