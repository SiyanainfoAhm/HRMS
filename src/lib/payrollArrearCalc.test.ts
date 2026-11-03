/**
 * Run: npx --yes tsx src/lib/payrollArrearCalc.test.ts
 *
 * Arrears (DA / transport / gross / CPF / net) must be counted exactly once in
 * gross, deductions and net, however many times the row is recomputed.
 */
import { applyAutoArrearsToGovernmentMonthly, calculateMonthDaArrear, totalArrearsPaid } from "./payrollArrearCalc";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { recalculateGovernmentSheetTotals } from "./runPayrollSheetEdit";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr: GovRecalcPayload = {
  grossBasic: 30000, daPercent: 50, hraPercent: 30, medicalFixed: 0, payLevel: 10, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
};
const compute = (gm: Record<string, unknown> | null) =>
  runGovernmentPayrollCompute(gr, {
    daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: gm,
  }).comp as unknown as Record<string, number>;

const arrear = { daArrear: 1000, transportArrear: 200, grossArrear: 1200, cpfArrear: 144, netArrear: 1056 };
const base = compute(null);
const first = applyAutoArrearsToGovernmentMonthly(base, arrear);
assertEq(first.totalEarnings, base.totalEarnings + 1200, "gross includes arrears once");
assertEq(first.totalDeductions, base.totalDeductions + 144, "deductions include CPF arrear once");
assertEq(first.netSalary, base.netSalary + 1056, "net includes net arrear once");

// Recomputing a row that already holds arrears (pay days / leave edit, draft reload)
// must give the identical result, not add the arrears a second time.
let row = first as Record<string, number>;
for (let i = 0; i < 3; i++) {
  row = applyAutoArrearsToGovernmentMonthly(compute(row), arrear) as Record<string, number>;
  assertEq(row.totalEarnings, first.totalEarnings, `recompute #${i + 1}: gross stable`);
  assertEq(row.totalDeductions, first.totalDeductions, `recompute #${i + 1}: deductions stable`);
  assertEq(row.netSalary, first.netSalary, `recompute #${i + 1}: net stable`);
}

// Sheet totals agree with the engine after arrears.
const sheet = recalculateGovernmentSheetTotals(first as Record<string, unknown>) as Record<string, number>;
assertEq(sheet.totalEarnings, first.totalEarnings, "sheet gross = engine gross");
assertEq(sheet.totalDeductions, first.totalDeductions, "sheet deductions = engine deductions");
assertEq(sheet.netSalary, first.netSalary, "sheet net = engine net");

// Zero arrears clear the arrear lines; an explicit 0 net/gross is a value, not "missing".
const cleared = applyAutoArrearsToGovernmentMonthly(first, { daArrear: 0, transportArrear: 0, grossArrear: 0, cpfArrear: 0, netArrear: 0 });
assertEq(cleared.totalEarnings, base.totalEarnings, "clearing arrears restores gross");
assertEq(cleared.netSalary, base.netSalary, "clearing arrears restores net");
assertEq(cleared.daArrearsPaid, 0, "DA arrear line cleared");

// Gross arrear recorded without DA/TR split counts once.
const grossOnly = applyAutoArrearsToGovernmentMonthly(base, { grossArrear: 500, cpfArrear: 60, netArrear: 440 });
assertEq(grossOnly.totalEarnings, base.totalEarnings + 500, "gross-only arrear");
assertEq(grossOnly.netSalary, base.netSalary + 440, "gross-only net");

// Month arrear arithmetic: every arrear line is a whole rupee (CPF arrear 12% of gross, rounded once, no float drift).
const m = calculateMonthDaArrear(34590, 3600, 50, 53);
assertEq(m.grossArrear, m.daArrear + m.transportArrear, "gross = DA + TR");
assertEq(m.cpfArrear, Math.round(m.grossArrear * 12 / 100), "cpf arrear is a whole rupee");
assertEq(m.netArrear, m.grossArrear - m.cpfArrear, "net = gross - cpf");
assertEq(calculateMonthDaArrear(0, 0, 50, 53).grossArrear, 0, "zero basic");
assertEq(calculateMonthDaArrear(34590, 3600, 53, 53).grossArrear, 0, "no DA change");
assertEq(calculateMonthDaArrear(34590, 3600, 53, 50).daArrear < 0, true, "DA decrease is a negative arrear (recovery)");

// Total arrears: gross already contains DA + TR, so it is never added on top of them.
assertEq(totalArrearsPaid(1000, 200, 1200), 1200, "gross == da + tr counts once");
assertEq(totalArrearsPaid(1000, 200, 1500), 1500, "gross-only remainder added once");
assertEq(totalArrearsPaid(0, 0, 500), 500, "gross only");
assertEq(totalArrearsPaid(0, 0, 0), 0, "none");
assertEq(totalArrearsPaid(null, "", undefined), 0, "blank inputs");
assertEq(totalArrearsPaid(-5, 10, 0), 10, "negative clamps to 0");

console.log("payrollArrearCalc.test.ts: all tests passed");
