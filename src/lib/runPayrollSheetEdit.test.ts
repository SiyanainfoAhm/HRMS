/**
 * Run: npx --yes tsx src/lib/runPayrollSheetEdit.test.ts
 */
import {
  applyGovernmentSheetMonetaryEdit,
  isGovernmentSheetMonetaryField,
  recalculateGovernmentSheetTotals,
  sumSheetDeductions,
  sumSheetEarnings,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";
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
  cpf: 4151,
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

function baseRow(overrides: Partial<GovernmentSheetRow> = {}): GovernmentSheetRow {
  const gm = {
    basicPaid: 34590,
    spPayPaid: 0,
    daPaid: 0,
    transportPaid: 5760,
    hraPaid: 25830,
    medicalPaid: 3000,
    extraWorkAllowancePaid: 0,
    nightAllowancePaid: 0,
    uniformAllowancePaid: 0,
    educationAllowancePaid: 0,
    daArrearsPaid: 0,
    transportArrearsPaid: 0,
    encashmentPaid: 0,
    encashmentDaPaid: 0,
    customEarnings: {},
    customDeductions: {},
    deductions: { ...emptyDed },
    totalEarnings: 34590 + 5760 + 25830 + 3000,
    totalDeductions: 4151 + 200,
    netSalary: 34590 + 5760 + 25830 + 3000 - 4151 - 200,
  };
  const gr: GovRecalcPayload = {
    grossBasic: 34590,
    daPercent: 53,
    hraPercent: 30,
    medicalFixed: 3000,
    payLevel: 10,
    deductionDefaults: { ...emptyDed },
  };
  return {
    employeeUserId: "emp-a",
    payDays: 30,
    grossPay: gm.totalEarnings,
    deductions: gm.totalDeductions,
    netPay: gm.netSalary,
    takeHome: gm.netSalary,
    governmentMonthly: gm,
    govRecalc: gr,
    daArrear: 0,
    transportArrear: 0,
    grossArrear: 0,
    cpfArrear: 0,
    netArrear: 0,
    ...overrides,
  };
}

assert(isGovernmentSheetMonetaryField("govEarning_basicPaid"), "basic is sheet field");
assert(isGovernmentSheetMonetaryField("govDeduction_cpf"), "cpf is sheet field");
assert(isGovernmentSheetMonetaryField("daArrear"), "da arrear is sheet field");
assert(!isGovernmentSheetMonetaryField("hplDays"), "hpl days not sheet monetary");
assert(!isGovernmentSheetMonetaryField("payDays"), "pay days not sheet monetary");

// TEST 1 — Basic replaced
let row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_basicPaid", 30000);
assertEq((row.governmentMonthly as { basicPaid: number }).basicPaid, 30000, "TEST1 Basic=30000");

// TEST 2 — Basic = 0
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_basicPaid", 0);
assertEq((row.governmentMonthly as { basicPaid: number }).basicPaid, 0, "TEST2 Basic=0");

// TEST 3/4 — DA arbitrary / 0
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_daPaid", 1234);
assertEq((row.governmentMonthly as { daPaid: number }).daPaid, 1234, "TEST3 DA");
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_daPaid", 0);
assertEq((row.governmentMonthly as { daPaid: number }).daPaid, 0, "TEST4 DA=0");

// TEST 5 — Transport 0
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_transportPaid", 0);
assertEq((row.governmentMonthly as { transportPaid: number }).transportPaid, 0, "TEST5 Transport=0");

// TEST 6/7 — HRA / Medical
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_hraPaid", 10000);
assertEq((row.governmentMonthly as { hraPaid: number }).hraPaid, 10000, "TEST6 HRA");
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_medicalPaid", 0);
assertEq((row.governmentMonthly as { medicalPaid: number }).medicalPaid, 0, "TEST7 Medical=0");

// TEST 8/9 — CPF / PT
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govDeduction_cpf", 0);
assertEq((row.governmentMonthly as { deductions: { cpf: number } }).deductions.cpf, 0, "TEST8 CPF=0");
assertEq(row.govRecalc?.cpfManualOverride, true, "TEST8 cpf flag");
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govDeduction_pt", 0);
assertEq((row.governmentMonthly as { deductions: { pt: number } }).deductions.pt, 0, "TEST9 PT=0");

// TEST 10 — LIC
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govDeduction_lic", 500);
assertEq((row.governmentMonthly as { deductions: { lic: number } }).deductions.lic, 500, "TEST10 LIC");

// TEST 11 — every deduction can be 0
for (const key of [
  "incomeTax",
  "daCpf",
  "vpf",
  "pfLoan",
  "postOffice",
  "creditSociety",
  "electricity",
  "water",
  "mess",
  "loanRecovery",
  "welfare",
  "hpl",
  "eol",
  "vehCharge",
  "other",
  "quarterRent",
] as const) {
  const r = applyGovernmentSheetMonetaryEdit(baseRow(), `govDeduction_${key}`, 0);
  assertEq(
    (r.governmentMonthly as { deductions: Record<string, number> }).deductions[key],
    0,
    `TEST11 ${key}=0`,
  );
}

// TEST 12–16 — arrears
for (const key of ["daArrear", "transportArrear", "grossArrear", "cpfArrear", "netArrear"] as const) {
  const r = applyGovernmentSheetMonetaryEdit(baseRow(), key, 0);
  assertEq(r[key], 0, `TEST arrears ${key}=0`);
}
row = applyGovernmentSheetMonetaryEdit(baseRow(), "daArrear", 1000);
assertEq(row.daArrear, 1000, "TEST12 DA arrear");

// TEST 17 — editing one does not reset another
row = applyGovernmentSheetMonetaryEdit(baseRow(), "govEarning_basicPaid", 20000);
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_transportPaid", 0);
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_hraPaid", 10000);
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_medicalPaid", 0);
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_daPaid", 0);
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_cpf", 0);
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_pt", 0);
const gm = row.governmentMonthly as {
  basicPaid: number;
  daPaid: number;
  transportPaid: number;
  hraPaid: number;
  medicalPaid: number;
  deductions: { cpf: number; pt: number };
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
};
assertEq(gm.basicPaid, 20000, "TEST17 basic stays");
assertEq(gm.daPaid, 0, "TEST17 da stays");
assertEq(gm.transportPaid, 0, "TEST17 transport stays");
assertEq(gm.hraPaid, 10000, "TEST17 hra stays");
assertEq(gm.medicalPaid, 0, "TEST17 medical stays");
assertEq(gm.deductions.cpf, 0, "TEST17 cpf stays");
assertEq(gm.deductions.pt, 0, "TEST17 pt stays");
assertEq(gm.totalEarnings, 20000 + 0 + 0 + 10000 + 0, "TEST17 earnings total");
assertEq(gm.totalDeductions, 0, "TEST17 deductions total");
assertEq(gm.netSalary, 30000, "TEST17 net");
assertEq(row.grossPay, 30000, "TEST17 row grossPay");
assertEq(row.netPay, 30000, "TEST17 row netPay");

// TEST 18 — switching employee: edits are on row object (canonical map stores row)
const empB = applyGovernmentSheetMonetaryEdit(
  { ...baseRow(), employeeUserId: "emp-b" },
  "govEarning_basicPaid",
  11111,
);
assertEq((empB.governmentMonthly as { basicPaid: number }).basicPaid, 11111, "TEST18 emp B");
assertEq(gm.basicPaid, 20000, "TEST18 emp A unchanged");

// TEST 22 — explicit zeroes survive totals recalc
const zeroed = recalculateGovernmentSheetTotals({
  ...gm,
  basicPaid: 0,
  transportPaid: 0,
  deductions: { ...emptyDed, cpf: 0, pt: 0 },
});
assertEq(zeroed.basicPaid, 0, "TEST22 basic 0 after totals");
assertEq((zeroed.deductions as { cpf: number }).cpf, 0, "TEST22 cpf 0 after totals");

assertEq(sumSheetEarnings(gm), 30000, "sum earnings");
assertEq(sumSheetDeductions(gm), 0, "sum deductions");

// Freeze: overrides present after edit
assert(
  row.govRecalc?.earningPaidOverrides &&
    Object.prototype.hasOwnProperty.call(row.govRecalc.earningPaidOverrides, "basicPaid"),
  "TEST override presence for basic",
);
assertEq(row.govRecalc?.earningPaidOverrides?.basicPaid, 20000, "frozen basic override");

console.log("runPayrollSheetEdit.test.ts: all tests passed");
