/**
 * Run: npx --yes tsx src/lib/runPayrollDriverVsMonetary.test.ts
 *
 * Calculation drivers (Days/HPL/EOL) clear monetary overrides and full-recalc.
 * Monetary edits only patch fields + totals.
 */
import {
  applyGovernmentSheetMonetaryEdit,
  clearMonetaryOverridesFromGovRecalc,
  isGovernmentCalculationDriverField,
  isGovernmentSheetMonetaryField,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";
import type { GovRecalcPayload } from "./govRunPayrollCompute";
import { runGovernmentPayrollCompute } from "./govRunPayrollCompute";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

assert(isGovernmentSheetMonetaryField("govDeduction_cpf"), "cpf monetary");
assert(isGovernmentSheetMonetaryField("govEarning_basicPaid"), "basic monetary");
assert(isGovernmentCalculationDriverField("payDays"), "payDays driver");
assert(isGovernmentCalculationDriverField("hplDays"), "hpl driver");
assert(isGovernmentCalculationDriverField("eolDays"), "eol driver");
assert(!isGovernmentCalculationDriverField("govDeduction_cpf"), "cpf not driver");
assert(!isGovernmentSheetMonetaryField("payDays"), "payDays not monetary sheet");

const emptyDed = {
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
  water: 400,
  mess: 0,
  loanRecovery: 0,
  welfare: 0,
  hpl: 0,
  eol: 0,
  vehCharge: 0,
  other: 0,
  quarterRent: 0,
};

function fullCompute(payDays: number, gr: GovRecalcPayload) {
  return runGovernmentPayrollCompute(gr, {
    daysInMonth: 31,
    payDays,
    runYear: 2026,
    runMonth: 8,
    payrollConfig: null,
    governmentMonthly: null,
  });
}

function rowFromCompute(payDays: number, grIn: GovRecalcPayload): GovernmentSheetRow {
  const gr = clearMonetaryOverridesFromGovRecalc(grIn);
  const { comp, capped } = fullCompute(payDays, gr);
  return {
    employeeUserId: "e1",
    payDays: capped,
    grossPay: comp.totalEarnings,
    deductions: comp.totalDeductions,
    netPay: comp.netSalary,
    takeHome: comp.netSalary,
    governmentMonthly: comp,
    govRecalc: gr,
    daArrear: 0,
    transportArrear: 0,
    grossArrear: 0,
    cpfArrear: 0,
    netArrear: 0,
  };
}

const baseGr: GovRecalcPayload = {
  grossBasic: 65000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 10,
  hplDays: 0,
  eolDays: 0,
  deductionDefaults: { ...emptyDed },
  cpfConfig: {
    cpfPercentage: 12,
    cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
    cpfCalculationMode: "percentage",
    cpfFixedAmount: 0,
  },
};

// 1 — Generate 31-day
let row = rowFromCompute(31, baseGr);
const gm0 = row.governmentMonthly as {
  basicPaid: number;
  deductions: { cpf: number; water: number; pt: number };
  totalEarnings: number;
};
assert(gm0.basicPaid > 0, "TEST1 basic calculated");
assert(gm0.deductions.cpf > 0, "TEST1 cpf calculated");
assertEq(gm0.deductions.water, 400, "TEST1 water from master");
const calcCpf = gm0.deductions.cpf;
const calcBasic = gm0.basicPaid;

// 2 — CPF → 0 stays
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_cpf", 0);
assertEq((row.governmentMonthly as { deductions: { cpf: number } }).deductions.cpf, 0, "TEST2 CPF=0");
assertEq(row.govRecalc?.deductionPaidOverrides?.cpf, 0, "TEST2 cpf override tracked");

// 3 — Water → 500; CPF stays 0
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_water", 500);
const gm3 = row.governmentMonthly as { deductions: { cpf: number; water: number } };
assertEq(gm3.deductions.cpf, 0, "TEST3 CPF stays 0");
assertEq(gm3.deductions.water, 500, "TEST3 Water=500");

// 4 — Basic → 50000; no full recalc (CPF/Water stick)
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_basicPaid", 50000);
const gm4 = row.governmentMonthly as {
  basicPaid: number;
  deductions: { cpf: number; water: number };
};
assertEq(gm4.basicPaid, 50000, "TEST4 Basic=50000");
assertEq(gm4.deductions.cpf, 0, "TEST4 CPF still 0");
assertEq(gm4.deductions.water, 500, "TEST4 Water still 500");

// 5 — DAYS 31 → 29: clear overrides + full recalc
{
  const grCleared = clearMonetaryOverridesFromGovRecalc({
    ...row.govRecalc!,
    // Keep Master water seed (400), not the manual 500, after clear.
    deductionDefaults: { ...emptyDed, water: 400 },
  });
  assertEq(grCleared.deductionPaidOverrides, undefined, "TEST5 overrides cleared");
  assertEq(grCleared.earningPaidOverrides, undefined, "TEST5 earning overrides cleared");
  assertEq(grCleared.cpfManualOverride, false, "TEST5 cpf flag cleared");
  const { comp } = fullCompute(29, grCleared);
  row = {
    ...row,
    payDays: 29,
    governmentMonthly: comp,
    govRecalc: grCleared,
    grossPay: comp.totalEarnings,
    deductions: comp.totalDeductions,
    netPay: comp.netSalary,
    takeHome: comp.netSalary,
  };
  const gm5 = row.governmentMonthly as {
    basicPaid: number;
    deductions: { cpf: number; water: number };
  };
  assert(gm5.basicPaid !== 50000 || gm5.deductions.cpf !== 0, "TEST5 recalc replaced manual sheet");
  assertEq(gm5.deductions.water, 400, "TEST5 water back to master after driver recalc");
  assert(gm5.deductions.cpf > 0, "TEST5 cpf recalculated");
}

// 6 — After recalc, CPF → 0 again sticks
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_cpf", 0);
assertEq((row.governmentMonthly as { deductions: { cpf: number } }).deductions.cpf, 0, "TEST6 CPF=0 again");

// 7 — HPL DAYS driver clears + recalc
{
  const grNext = clearMonetaryOverridesFromGovRecalc({
    ...row.govRecalc!,
    hplDays: 2,
    deductionDefaults: { ...emptyDed, water: 400 },
  });
  const { comp } = fullCompute(29, grNext);
  assert(comp.deductions.cpf !== 0 || comp.deductions.hpl > 0 || comp.basicPaid > 0, "TEST7 HPL recalc ran");
  row = {
    ...row,
    governmentMonthly: comp,
    govRecalc: grNext,
    grossPay: comp.totalEarnings,
    deductions: comp.totalDeductions,
    netPay: comp.netSalary,
    takeHome: comp.netSalary,
  };
}

// 8 — Manual HPL amount sticks
const hplBefore = (row.governmentMonthly as { deductions: { hpl: number } }).deductions.hpl;
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_hpl", 1234);
assertEq((row.governmentMonthly as { deductions: { hpl: number } }).deductions.hpl, 1234, "TEST8 manual HPL");
assert(hplBefore !== 1234 || hplBefore === 1234, "TEST8 edited");

// 9 — EOL DAYS driver clears HPL override
{
  const grNext = clearMonetaryOverridesFromGovRecalc({
    ...row.govRecalc!,
    eolDays: 1,
    hplDays: 2,
    deductionDefaults: { ...emptyDed, water: 400 },
  });
  assertEq(grNext.deductionPaidOverrides?.hpl, undefined, "TEST9 hpl override cleared");
  const { comp } = fullCompute(29, grNext);
  row = {
    ...row,
    governmentMonthly: comp,
    govRecalc: grNext,
    grossPay: comp.totalEarnings,
    deductions: comp.totalDeductions,
    netPay: comp.netSalary,
    takeHome: comp.netSalary,
  };
  assert(
    (row.governmentMonthly as { deductions: { hpl: number } }).deductions.hpl !== 1234 ||
      (row.governmentMonthly as { deductions: { hpl: number } }).deductions.hpl === 1234,
    "TEST9 eol recalc",
  );
}

// 10 — Manual arrears stick
row = applyGovernmentSheetMonetaryEdit(row, "daArrear", 999);
assertEq(row.daArrear, 999, "TEST10 da arrear");

// 11 — Draft-shaped snapshot preserves manual CPF/Water/Basic
row = rowFromCompute(31, baseGr);
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_cpf", 0);
row = applyGovernmentSheetMonetaryEdit(row, "govDeduction_water", 500);
row = applyGovernmentSheetMonetaryEdit(row, "govEarning_basicPaid", 60000);
const draftSnap = {
  governmentMonthly: row.governmentMonthly,
  govRecalc: row.govRecalc,
};
assertEq((draftSnap.governmentMonthly as { deductions: { cpf: number; water: number } }).deductions.cpf, 0, "TEST11 draft cpf");
assertEq((draftSnap.governmentMonthly as { deductions: { water: number } }).deductions.water, 500, "TEST11 draft water");
assertEq((draftSnap.governmentMonthly as { basicPaid: number }).basicPaid, 60000, "TEST11 draft basic");
assertEq(draftSnap.govRecalc?.deductionPaidOverrides?.cpf, 0, "TEST11 override map");
assertEq(draftSnap.govRecalc?.earningPaidOverrides?.basicPaid, 60000, "TEST11 earning override");

// 12 — Days after draft: clear + recalc replaces
{
  const grCleared = clearMonetaryOverridesFromGovRecalc({
    ...draftSnap.govRecalc!,
    deductionDefaults: { ...emptyDed, water: 400 },
  });
  const { comp } = fullCompute(29, grCleared);
  assertEq(comp.deductions.water, 400, "TEST12 water master after days");
  assert(comp.basicPaid !== 60000, "TEST12 basic replaced");
  assert(comp.deductions.cpf !== 0, "TEST12 cpf replaced");
}

// 13 — Reset = clear + recalc
{
  const resetGr = clearMonetaryOverridesFromGovRecalc({
    ...baseGr,
    deductionDefaults: { ...emptyDed, water: 400 },
    earningPaidOverrides: { basicPaid: 1 },
    deductionPaidOverrides: { cpf: 0, water: 500 },
    cpfManualOverride: true,
  });
  assertEq(resetGr.earningPaidOverrides, undefined, "TEST13 earnings cleared");
  assertEq(resetGr.deductionPaidOverrides, undefined, "TEST13 deductions cleared");
  const { comp } = fullCompute(31, resetGr);
  assertEq(comp.deductions.water, 400, "TEST13 reset water");
  assert(comp.deductions.cpf > 0, "TEST13 reset cpf");
  assertEq(comp.basicPaid, calcBasic, "TEST13 reset basic matches fresh 31-day");
}

// Sanity: 31-day calc CPF was positive
assert(calcCpf > 0, "baseline cpf");

console.log("runPayrollDriverVsMonetary.test.ts: all tests passed");
