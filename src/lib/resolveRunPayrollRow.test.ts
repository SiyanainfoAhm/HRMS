/**
 * Run: npx --yes tsx src/lib/resolveRunPayrollRow.test.ts
 */
import {
  hasUsableGovernmentMonthly,
  isZeroStubPayrollRow,
  resolveRunPayrollRow,
  type RunPayrollRowLike,
} from "./resolveRunPayrollRow";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function stubApiRow(uid: string): RunPayrollRowLike {
  return {
    employeeUserId: uid,
    payrollMode: "government",
    payDays: 30,
    grossPay: 0,
    netPay: 0,
    deductions: 0,
    governmentMonthly: null,
    govRecalc: {
      grossBasic: 50000,
      daPercent: 53,
      hraPercent: 30,
      medicalFixed: 3000,
      payLevel: 10,
      hplDays: 0,
      eolDays: 0,
      deductionDefaults: {
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
      },
      cpfConfig: {
        cpfPercentage: 12,
        cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
        cpfCalculationMode: "percentage",
        cpfFixedAmount: 0,
      },
    },
  };
}

function testZeroStubDetection() {
  const stub = stubApiRow("u1");
  assert(isZeroStubPayrollRow(stub), "api stub is zero");
  assert(!hasUsableGovernmentMonthly(null), "null gm");
}

function testResolveComputesGovernmentMonthly() {
  const resolved = resolveRunPayrollRow(stubApiRow("u1"), {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
  });
  assert(hasUsableGovernmentMonthly(resolved.governmentMonthly), "gm computed");
  assert(Number(resolved.grossPay) > 0, "gross > 0");
  assert(!isZeroStubPayrollRow(resolved), "not stub after resolve");
}

function testDraftOverlayKeepsExplicitZero() {
  const base = stubApiRow("u2");
  const draftStored = {
    employeeUserId: "u2",
    grossPay: 0,
    netPay: 0,
    totalDeductions: 0,
    rowPayload: {
      employeeUserId: "u2",
      payrollMode: "government",
      grossPay: 0,
      netPay: 0,
      deductions: 0,
      governmentMonthly: {
        basicPaid: 0,
        daPaid: 0,
        hraPaid: 0,
        totalEarnings: 0,
        totalDeductions: 0,
        netSalary: 0,
        deductions: { cpf: 0, pt: 0 },
      },
      govRecalc: base.govRecalc,
    },
  };
  const resolved = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
    draftStored,
  });
  assertEq(Number((resolved.governmentMonthly as { totalEarnings: number }).totalEarnings), 0, "explicit 0");
  assertEq(Number(resolved.grossPay), 0, "gross 0");
}

function testDirtyCacheWins() {
  const base = stubApiRow("u3");
  const cached: RunPayrollRowLike = {
    ...base,
    employeeUserId: "u3",
    grossPay: 255110,
    netPay: 200000,
    deductions: 55110,
    governmentMonthly: {
      basicPaid: 90000,
      totalEarnings: 255110,
      totalDeductions: 55110,
      netSalary: 200000,
    },
  };
  const resolved = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: true,
    cached,
  });
  assertEq(Number(resolved.grossPay), 255110, "dirty cache");
}

function testManyEmployeesResolveWithoutPageBias() {
  const rows = Array.from({ length: 83 }, (_, i) => stubApiRow(`u${i + 1}`));
  const page = rows.slice(0, 25);
  const map = new Map<string, RunPayrollRowLike>();
  for (const r of page) {
    map.set(r.employeeUserId, resolveRunPayrollRow(r, {
      denom: 30,
      runYear: 2026,
      runMonth: 7,
      payrollConfig: null,
      alreadyRun: false,
      draftDirty: false,
    }));
  }
  assertEq(map.size, 25, "page only in map so far");
  for (const r of rows) {
    map.set(
      r.employeeUserId,
      resolveRunPayrollRow(r, {
        denom: 30,
        runYear: 2026,
        runMonth: 7,
        payrollConfig: null,
        alreadyRun: false,
        draftDirty: false,
        cached: map.get(r.employeeUserId),
      }),
    );
  }
  assertEq(map.size, 83, "full set");
  let zeros = 0;
  for (const row of map.values()) {
    if (isZeroStubPayrollRow(row)) zeros += 1;
  }
  assertEq(zeros, 0, "no stubs after full resolve");
}

const tests = [
  testZeroStubDetection,
  testResolveComputesGovernmentMonthly,
  testDraftOverlayKeepsExplicitZero,
  testDirtyCacheWins,
  testManyEmployeesResolveWithoutPageBias,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`ok - ${t.name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL - ${t.name}:`, e);
  }
}
if (failed) process.exit(1);
console.log(`\n${tests.length} passed`);
