/**
 * Run: npx --yes tsx src/lib/payrollEndToEnd.test.ts
 *
 * Full payroll for sample employees. Gross - deductions = net must hold on the
 * screen row, the saved snapshot, the printed payslip lines and the workbook
 * totals, and the same figures must come out of every output.
 */
import { applyAutoArrearsToGovernmentMonthly } from "./payrollArrearCalc";
import { DEFAULT_APRIL_2026_ELECTRICITY_TARIFF } from "./electricityTariffCalculation";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { aggregatePayrollSummary, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { governmentPayslipDeductionPairs, governmentPayslipEarningPairs } from "./governmentPayslipLayout";
import {
  applyGovernmentSheetMonetaryEdit,
  recalculateGovernmentSheetTotals,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertClose(a: number, b: number, msg: string, eps = 0.011) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

const baseDed = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const cpfConfig = { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da", "hra"], cpfCalculationMode: "percentage" as const, cpfFixedAmount: 0 };

type Sample = { name: string; gr: GovRecalcPayload; payDays: number; arrear?: { daArrear: number; transportArrear: number; grossArrear: number; cpfArrear: number; netArrear: number }; extras?: Record<string, number>; edits?: Array<[string, number]> };

const samples: Sample[] = [
  {
    // The reported case: Master flat electricity 49, units 80, water 314, mess 25.
    name: "Subhash (units 80, master 49)",
    gr: {
      grossBasic: 34590, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 10,
      electricityUnitsConsumed: 80, electricityMode: "manual_fixed", electricityApplicable: true,
      electricityTariff: DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
      deductionDefaults: { ...baseDed, electricity: 49, water: 314, mess: 25 }, cpfConfig,
    },
    payDays: 30,
    arrear: { daArrear: 1000, transportArrear: 200, grossArrear: 1200, cpfArrear: 144, netArrear: 1056 },
    edits: [["govDeduction_mess", 30]],
  },
  {
    name: "Quarter holder (rent 880, no HRA)",
    gr: {
      grossBasic: 52000, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 12,
      hasQuarter: true, quarterRent: 880, electricityUnitsConsumed: 301, electricityApplicable: true,
      electricityTariff: DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
      deductionDefaults: { ...baseDed, water: 100 }, cpfConfig,
    },
    payDays: 30,
    extras: { incentive: 500, reimbursement: 250 },
  },
  {
    name: "Part month with EOL days",
    gr: {
      grossBasic: 41000, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 11, eolDays: 3,
      electricityUnitsConsumed: 0, electricityApplicable: true, electricityMode: "manual_fixed",
      deductionDefaults: { ...baseDed, electricity: 49 }, cpfConfig,
    },
    payDays: 27,
  },
  {
    name: "Zero pay days",
    gr: {
      grossBasic: 30000, daPercent: 53, hraPercent: 30, medicalFixed: 0, payLevel: 9,
      deductionDefaults: { ...baseDed }, cpfConfig,
    },
    payDays: 0,
  },
];

type Output = { name: string; row: GovernmentSheetRow & { incentive?: number; prBonus?: number; reimbursement?: number } };
const outputs: Output[] = [];

for (const s of samples) {
  const { comp, capped } = runGovernmentPayrollCompute(s.gr, {
    daysInMonth: 30, payDays: s.payDays, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null,
  });
  let gm = (s.arrear ? applyAutoArrearsToGovernmentMonthly(comp as unknown as Record<string, unknown>, s.arrear) : comp) as unknown as Record<string, unknown>;
  let row: GovernmentSheetRow & { incentive?: number; prBonus?: number; reimbursement?: number } = {
    employeeUserId: s.name, payDays: capped,
    grossPay: Number(gm.totalEarnings), deductions: Number(gm.totalDeductions), netPay: Number(gm.netSalary), takeHome: Number(gm.netSalary),
    governmentMonthly: gm, govRecalc: s.gr,
    ...(s.arrear ?? {}),
  };
  for (const [field, value] of Object.entries(s.extras ?? {})) {
    row = applyGovernmentSheetMonetaryEdit(row, field, value) as typeof row;
  }
  for (const [field, value] of s.edits ?? []) {
    row = applyGovernmentSheetMonetaryEdit(row, field, value) as typeof row;
  }
  outputs.push({ name: s.name, row });
}

const toSlip = (gm: Record<string, unknown>) => {
  // The saved monthly snapshot uses snake_case columns; map the camelCase sheet to it.
  const ded = (gm.deductions ?? {}) as Record<string, number>;
  const snake: Record<string, number> = {
    basic_paid: gm.basicPaid as number, sp_pay_paid: gm.spPayPaid as number, da_paid: gm.daPaid as number,
    transport_paid: gm.transportPaid as number, hra_paid: gm.hraPaid as number, medical_paid: gm.medicalPaid as number,
    extra_work_allowance_paid: gm.extraWorkAllowancePaid as number, night_allowance_paid: gm.nightAllowancePaid as number,
    uniform_allowance_paid: gm.uniformAllowancePaid as number, education_allowance_paid: gm.educationAllowancePaid as number,
    da_arrears_paid: gm.daArrearsPaid as number, transport_arrears_paid: gm.transportArrearsPaid as number,
    gross_arrear: gm.grossArrear as number, encashment_paid: gm.encashmentPaid as number, encashment_da_paid: gm.encashmentDaPaid as number,
    cpf_arrear: gm.cpfArrear as number,
    income_tax_amount: ded.incomeTax, pt_amount: ded.pt, lic_amount: ded.lic, cpf_amount: ded.cpf, da_cpf_amount: ded.daCpf,
    vpf_amount: ded.vpf, post_office_amount: ded.postOffice, credit_society_amount: ded.creditSociety,
    electricity_amount: ded.electricity, water_amount: ded.water, mess_amount: ded.mess, loan_recovery_amount: ded.loanRecovery,
    welfare_amount: ded.welfare, quarter_rent_amount: ded.quarterRent, other_deduction_amount: ded.other,
    pf_loan_amount: ded.pfLoan, std_licence_fee_amount: ded.stdLicenceFee, veh_charge_amount: ded.vehCharge,
    hpl_amount: ded.hpl, eol_amount: ded.eol,
  };
  return snake;
};

let sumGross = 0;
let sumDed = 0;
let sumNet = 0;
for (const { name, row } of outputs) {
  const gm = row.governmentMonthly as Record<string, unknown>;
  // 1. Screen row.
  assertClose(row.grossPay - row.deductions, row.netPay, `${name}: screen gross - deductions = net`);
  // 2. Saved snapshot: the stored totals equal the totals recomputed from its own lines.
  const re = recalculateGovernmentSheetTotals(gm) as Record<string, number>;
  assertClose(Number(gm.totalEarnings), re.totalEarnings, `${name}: gross equals its lines`);
  assertClose(Number(gm.totalDeductions), re.totalDeductions, `${name}: deductions equal their lines`);
  assertClose(Number(gm.netSalary), re.netSalary, `${name}: net equals gross - deductions`);
  // 3. Payslip: the printed lines add up to the gross / deductions printed.
  const slip = toSlip(gm);
  const printedEarnings = governmentPayslipEarningPairs(slip).reduce((a, [, v]) => a + v, 0);
  const printedDeductions = governmentPayslipDeductionPairs(slip).reduce((a, [, v]) => a + v, 0);
  const extras = (Number(row.incentive) || 0) + (Number(row.prBonus) || 0) + (Number(row.reimbursement) || 0);
  assertClose(printedEarnings + extras, Number(gm.totalEarnings), `${name}: payslip earnings lines add up to gross`);
  assertClose(printedDeductions, Number(gm.totalDeductions), `${name}: payslip deduction lines add up to total deductions`);
  assertClose(printedEarnings + extras - printedDeductions, Number(gm.netSalary), `${name}: payslip net`);
  sumGross += Number(gm.totalEarnings);
  sumDed += Number(gm.totalDeductions);
  sumNet += Number(gm.netSalary);
}

// 4. Workbook summary agrees with the rows it was built from.
const exportRows: PayrollRunExportRow[] = outputs.map(({ name, row }) => ({
  employeeUserId: name, payrollMode: "government", payDays: row.payDays,
  grossPay: row.grossPay, deductions: row.deductions, netPay: row.netPay, takeHome: row.takeHome,
  governmentMonthly: row.governmentMonthly as Record<string, unknown>,
}));
const summary = aggregatePayrollSummary(exportRows);
assertEq(summary.totalEarnings, Math.round(sumGross), "workbook gross");
assertEq(summary.totalDeductions, Math.round(sumDed), "workbook deductions");
assertEq(summary.netPayable, Math.round(sumNet), "workbook net");
assertClose(summary.totalEarnings - summary.totalDeductions, summary.netPayable, "workbook gross - deductions = net", 1.01);
// Arrears are counted once: 1200 for Subhash, not 2400.
assertEq(summary.totalArrears, 1200, "workbook total arrears counted once");

// 5. The reported case specifically.
const subhash = outputs[0].row.governmentMonthly as { deductions: Record<string, number> };
assertEq(subhash.deductions.electricity === 49, false, "Subhash electricity is not the master 49");
assertEq(subhash.deductions.water, 314, "water as entered");
assertEq(subhash.deductions.mess, 30, "mess edited to 30");

console.log("payroll end-to-end totals: ok (" + outputs.length + " employees)");
