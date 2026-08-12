/**
 * Run: npx --yes tsx src/lib/masterRunPayrollMapping.test.ts
 */
import {
  masterAmountOr,
  masterRecordToDeductionDefaults,
  pickMasterNumeric,
} from "./masterRunPayrollMapping";
import { computeGovernmentMonthlyPayroll, type GovernmentMonthlyComputed } from "./governmentPayroll";
import {
  applyGovernmentSheetMonetaryEdit,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function sheetMonthly(row: GovernmentSheetRow): GovernmentMonthlyComputed {
  return row.governmentMonthly as GovernmentMonthlyComputed;
}

// Primary column wins over *_default
assertEq(pickMasterNumeric(300, 0), 300, "primary water wins");
assertEq(pickMasterNumeric(null, 300), 300, "fallback to water_default");
assertEq(pickMasterNumeric(0, 300), 0, "explicit 0 wins over default alias");
assertEq(pickMasterNumeric(undefined, null, ""), undefined, "all missing");
assertEq(masterAmountOr(0, undefined, null), 0, "missing → 0");

const masterApi = {
  water: 300,
  water_default: 0,
  mess: 500,
  messDefault: 0,
  electricity: 700,
  electricity_default: 0,
  lic: 1000,
  lic_default: 0,
  creditSociety: 1200,
  welfare: 100,
  professionalTax: 200,
  incomeTax: 0,
  cpfDefault: 0,
};

const defaults = masterRecordToDeductionDefaults(masterApi);
assertEq(defaults.water, 300, "Water from master.water");
assertEq(defaults.mess, 500, "Mess from master.mess");
assertEq(defaults.electricity, 700, "Electricity from master.electricity");
assertEq(defaults.lic, 1000, "LIC from master.lic");
assertEq(defaults.creditSociety, 1200, "Credit society");
assertEq(defaults.welfare, 100, "Welfare");

// Legacy *Default-only shape (old run masters API)
const legacyOnly = masterRecordToDeductionDefaults({
  waterDefault: 300,
  messDefault: 500,
  electricityDefault: 700,
  licDefault: 1000,
});
assertEq(legacyOnly.water, 300, "legacy waterDefault");
assertEq(legacyOnly.mess, 500, "legacy messDefault");
assertEq(legacyOnly.electricity, 700, "legacy electricityDefault");
assertEq(legacyOnly.lic, 1000, "legacy licDefault");

// Explicit zeros
const zeros = masterRecordToDeductionDefaults({
  water: 0,
  water_default: 999,
  mess: 0,
  electricity: 0,
  lic: 0,
});
assertEq(zeros.water, 0, "Water explicit 0");
assertEq(zeros.mess, 0, "Mess explicit 0");
assertEq(zeros.lic, 0, "LIC explicit 0");

const emptyDeductions = {
  incomeTax: 0,
  pt: 200,
  lic: 0,
  cpf: 0,
  daCpf: 0,
  vpf: 0,
  pfLoan: 0,
  postOffice: 0,
  creditSociety: 0,
  stdLicenceFee: 0,
  electricity: 0,
  water: 0,
  mess: 0,
  loanRecovery: 0,
  welfare: 0,
  hpl: 0,
  eol: 0,
  vehCharge: 0,
  other: 0,
  quarterRent: 0,
};

const computed = computeGovernmentMonthlyPayroll({
  grossBasic: 34590,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 10,
  daysInMonth: 30,
  unpaidDays: 0,
  deductionDefaults: {
    ...emptyDeductions,
    ...defaults,
    cpf: 0,
  },
  cpfManualOverride: true,
  cpfConfig: {
    cpfPercentage: 12,
    cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
    cpfCalculationMode: "fixed_amount",
    cpfFixedAmount: 0,
  },
});

assertEq(computed.deductions.water, 300, "Run Payroll water from master defaults");
assertEq(computed.deductions.mess, 500, "Run Payroll mess");
assertEq(computed.deductions.electricity, 700, "Run Payroll electricity");
assertEq(computed.deductions.lic, 1000, "Run Payroll lic");
assert(
  computed.totalDeductions >= 300 + 500 + 700 + 1000 + 200 + 1200 + 100,
  "Total deductions includes master recurring",
);

let sheet: GovernmentSheetRow = {
  employeeUserId: "e1",
  payDays: 30,
  grossPay: computed.totalEarnings,
  deductions: computed.totalDeductions,
  netPay: computed.netSalary,
  takeHome: computed.netSalary,
  governmentMonthly: computed,
  govRecalc: {
    grossBasic: 34590,
    daPercent: 53,
    hraPercent: 30,
    medicalFixed: 3000,
    payLevel: 10,
    deductionDefaults: { ...emptyDeductions, ...defaults },
    earningPaidOverrides: {},
  },
  daArrear: 0,
  transportArrear: 0,
  grossArrear: 0,
  cpfArrear: 0,
  netArrear: 0,
};

sheet = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_water", 0);
assertEq(sheetMonthly(sheet).deductions.water, 0, "manual water 0");
sheet = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_mess", 250);
assertEq(sheetMonthly(sheet).deductions.mess, 250, "manual mess 250");
sheet = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_lic", 900);
assertEq(sheetMonthly(sheet).deductions.water, 0, "water stays 0 after other edit");
assertEq(sheetMonthly(sheet).deductions.mess, 250, "mess stays 250 after other edit");
assert(
  sheetMonthly(sheet).totalDeductions >= 0 + 250 + 700 + 900,
  "totals after manual edits",
);

console.log("masterRunPayrollMapping.test.ts: all tests passed");
