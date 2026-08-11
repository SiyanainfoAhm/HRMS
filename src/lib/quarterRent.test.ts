/**
 * Run: npx --yes tsx src/lib/quarterRent.test.ts
 */
import {
  formatQuarterOptionLabel,
  isCustomQuarterRent,
  parseQuarterRentInput,
  resolveEffectiveQuarterRent,
  resolveRunPayrollQuarterRent,
} from "./quarterRent";
import { computeGovernmentMonthlyPayroll } from "./governmentPayroll";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const emptyDeductions = {
  incomeTax: 0,
  pt: 0,
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

// TEST 1 — default rent when selecting quarter
assertEq(resolveEffectiveQuarterRent(null, 300), 300, "TEST1 default from catalog");
assertEq(parseQuarterRentInput("300"), 300, "TEST1 form shows 300");

// TEST 2 — manual override 450
assertEq(resolveEffectiveQuarterRent(450, 300), 450, "TEST2 override 450");
assert(isCustomQuarterRent(450, 300), "TEST2 marked custom");

// TEST 3 — explicit 0 must not fall back
assertEq(resolveEffectiveQuarterRent(0, 300), 0, "TEST3 explicit 0");
assertEq(parseQuarterRentInput("0"), 0, "TEST3 parse 0");
assertEq(0 || 300, 300, "document wrong truthy pattern");
const zeroRent: number | null = 0;
assertEq(zeroRent ?? 300, 0, "document correct nullish pattern");

// TEST 4 — option value is quarter id (label formatting)
const label = formatQuarterOptionLabel({
  quarterName: "B2/7",
  quarterType: "Type II",
  monthlyRent: 300,
});
assert(label.includes("B2/7"), "TEST4 name in label");
assert(label.includes("Type II"), "TEST4 type in label");
assert(label.includes("300"), "TEST4 rent in label");

// TEST 5 — new quarters appear via list (normalization of rent)
assertEq(parseQuarterRentInput(500), 500, "TEST5 new quarter default parse");

// TEST 6 — Run Payroll uses override 450
assertEq(
  resolveRunPayrollQuarterRent({
    hasQuarter: true,
    masterRent: 450,
    catalogDefaultRent: 300,
  }),
  450,
  "TEST6 run uses master override",
);

const runWithOverride = computeGovernmentMonthlyPayroll({
  grossBasic: 48000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 5,
  daysInMonth: 30,
  unpaidDays: 0,
  hasQuarter: true,
  quarterRent: 450,
  deductionDefaults: { ...emptyDeductions, quarterRent: 450 },
});
assertEq(runWithOverride.deductions.quarterRent, 450, "TEST6 compute uses 450");
assertEq(runWithOverride.hraActual, 0, "TEST6 HRA zero with quarter");

// TEST 7 — no override → catalog/master default 300
assertEq(
  resolveRunPayrollQuarterRent({
    hasQuarter: true,
    masterRent: 300,
    catalogDefaultRent: 300,
  }),
  300,
  "TEST7 default 300",
);
const runDefault = computeGovernmentMonthlyPayroll({
  grossBasic: 48000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 5,
  daysInMonth: 30,
  unpaidDays: 0,
  hasQuarter: true,
  quarterRent: 300,
  deductionDefaults: { ...emptyDeductions, quarterRent: 300 },
});
assertEq(runDefault.deductions.quarterRent, 300, "TEST7 compute 300");

// TEST 8 — unassign → 0
assertEq(
  resolveRunPayrollQuarterRent({
    hasQuarter: false,
    masterRent: 450,
    catalogDefaultRent: 300,
  }),
  0,
  "TEST8 unassigned 0",
);
const runNone = computeGovernmentMonthlyPayroll({
  grossBasic: 48000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 5,
  daysInMonth: 30,
  unpaidDays: 0,
  hasQuarter: false,
  quarterRent: 450,
  deductionDefaults: { ...emptyDeductions, quarterRent: 450 },
});
assertEq(runNone.deductions.quarterRent, 0, "TEST8 compute ignores leftover rent when no quarter");

// TEST 9 — run-level manual override wins over master
assertEq(
  resolveRunPayrollQuarterRent({
    hasQuarter: true,
    runManualOverride: true,
    runRent: 500,
    masterRent: 450,
    catalogDefaultRent: 300,
  }),
  500,
  "TEST9 run override wins",
);

// TEST 10 — draft/reload semantics: effective rent is the stored master rent
assertEq(resolveEffectiveQuarterRent(450, 300), 450, "TEST10 persisted effective rent");

console.log("quarterRent.test.ts: all tests passed");
