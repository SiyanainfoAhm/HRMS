/**
 * Run: npx --yes tsx src/lib/payrollGeneratedAudit.test.ts
 */
import {
  canShowAuditGeneratedAction,
  diffPayrollAuditSnapshots,
  formatAuditChangeLine,
  isGeneratedPayrollMonth,
  rowHasGeneratedPayrollId,
  snapshotGeneratedPayrollRow,
} from "./payrollGeneratedAudit";
import {
  applyGovernmentSheetMonetaryEdit,
  isGovernmentSheetMonetaryField,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";
import { isGovernmentCalculationDriverField } from "./runPayrollSheetEdit";
import type { GovRecalcPayload } from "./govRunPayrollCompute";
import type { GovernmentDeductionDefaults } from "./governmentPayroll";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const emptyDed: GovernmentDeductionDefaults = {
  incomeTax: 0,
  pt: 200,
  lic: 0,
  cpf: 17371,
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
  quarterRent: 500,
};

function generatedRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    employeeUserId: "emp-1",
    employeeName: "Subhash Duryodhan Katkar",
    monthlyPayrollId: "mp-1",
    payslipId: "ps-1",
    payDays: 31,
    unpaidLeaveDays: 0,
    grossPay: 140337,
    deductions: 17571,
    netPay: 122766,
    governmentMonthly: {
      id: "mp-1",
      basicPaid: 65000,
      spPayPaid: 0,
      daPaid: 0,
      transportPaid: 0,
      hraPaid: 0,
      medicalPaid: 0,
      extraWorkAllowancePaid: 0,
      nightAllowancePaid: 0,
      uniformAllowancePaid: 0,
      educationAllowancePaid: 0,
      encashmentPaid: 0,
      encashmentDaPaid: 0,
      daArrearsPaid: 0,
      transportArrearsPaid: 0,
      grossArrear: 0,
      cpfArrear: 0,
      netArrear: 0,
      totalEarnings: 140337,
      totalDeductions: 17571,
      netSalary: 122766,
      quarterRent: 500,
      deductions: {
        ...emptyDed,
        water: 0,
        cpf: 17371,
        pt: 200,
        quarterRent: 500,
      },
    },
    ...overrides,
  };
}

// 1. Generated month detected
assert(isGeneratedPayrollMonth({ alreadyRun: true, existingPeriodId: "period-1" }), "generated month");
assert(!isGeneratedPayrollMonth({ alreadyRun: false, existingPeriodId: null }), "not generated");

// 2. Audit button shown to Admin only
assert(canShowAuditGeneratedAction({ alreadyRun: true, isAdmin: true }), "admin sees audit");
assert(!canShowAuditGeneratedAction({ alreadyRun: true, isAdmin: false }), "non-admin hidden");
assert(!canShowAuditGeneratedAction({ alreadyRun: false, isAdmin: true }), "not shown before generate");

// 3. Existing generated payroll loads current DB values (monthlyPayrollId + water 0)
const loaded = generatedRow();
assert(rowHasGeneratedPayrollId(loaded), "has monthly id");
const snap = snapshotGeneratedPayrollRow(loaded);
assertEq(snap.water, 0, "water from generated DB");
assertEq(snap.quarterRent, 500, "quarter rent from generated DB");
assertEq(snap.pt, 200, "PT from generated DB");
assertEq(snap.totalDeductions, 17571, "total deductions from generated DB");
assertEq(snap.netSalary, 122766, "net from generated DB");
assertEq(snap.basicPaid, 65000, "basic from generated DB");

// 4-6. Monetary edit + explicit 0 + totals only
const gr: GovRecalcPayload = {
  grossBasic: 65000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 10,
  deductionDefaults: emptyDed,
};
const sheet: GovernmentSheetRow = {
  employeeUserId: "emp-1",
  payDays: 31,
  grossPay: 140337,
  deductions: 17571,
  netPay: 122766,
  takeHome: 122766,
  governmentMonthly: loaded.governmentMonthly,
  govRecalc: gr,
};
assert(isGovernmentSheetMonetaryField("govDeduction_water"), "water is monetary");
assert(!isGovernmentCalculationDriverField("govDeduction_water"), "water is not a driver");
assert(isGovernmentCalculationDriverField("payDays"), "days is a driver");

const baseline = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_pt", 200);
const baselineGm = baseline.governmentMonthly as Record<string, unknown>;
const waterEdited = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_water", 400);
const waterGm = waterEdited.governmentMonthly as Record<string, unknown>;
const waterDed = waterGm.deductions as Record<string, number>;
assertEq(waterDed.water, 400, "water edited to 400");
assertEq(waterDed.cpf, 17371, "CPF unchanged by water edit");
assertEq(
  Number(waterGm.totalDeductions),
  Number(baselineGm.totalDeductions) + 400,
  "total deductions +400",
);
assertEq(Number(waterGm.netSalary), Number(baselineGm.netSalary) - 400, "net -400");

const zeroCpf = applyGovernmentSheetMonetaryEdit(sheet, "govDeduction_cpf", 0);
const zeroGm = zeroCpf.governmentMonthly as Record<string, unknown>;
const zeroDed = zeroGm.deductions as Record<string, number>;
assertEq(zeroDed.cpf, 0, "explicit CPF 0 sticks");
assertEq(
  Number(zeroGm.totalDeductions),
  Number(baselineGm.totalDeductions) - 17371,
  "deductions drop by CPF",
);
assertEq(Number(zeroGm.netSalary), Number(baselineGm.netSalary) + 17371, "net rises by waived CPF");

// 11-14. Change list / before after
const afterWater = snapshotGeneratedPayrollRow({
  ...loaded,
  deductions: 17971,
  netPay: 122366,
  governmentMonthly: waterGm,
});
const changes = diffPayrollAuditSnapshots(snap, afterWater);
const waterChange = changes.find((c) => c.field === "water");
assert(waterChange, "water in changed fields");
assertEq(waterChange?.before, 0, "before water 0");
assertEq(waterChange?.after, 400, "after water 400");
const line = formatAuditChangeLine(waterChange!);
assert(line.includes("Water"), "friendly water label");
assert(line.includes("0"), "before in line");
assert(line.includes("400"), "after in line");

const afterZero = snapshotGeneratedPayrollRow({
  ...loaded,
  governmentMonthly: zeroGm,
});
const cpfChange = diffPayrollAuditSnapshots(snap, afterZero).find((c) => c.field === "cpf");
assertEq(cpfChange?.before, 17371, "cpf before");
assertEq(cpfChange?.after, 0, "cpf after 0 is stored");

console.log("payrollGeneratedAudit.test.ts: all assertions passed");
