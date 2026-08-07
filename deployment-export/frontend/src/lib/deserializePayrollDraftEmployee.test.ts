/**
 * Run: npx --yes tsx src/lib/deserializePayrollDraftEmployee.test.ts
 */
import {
  deserializePayrollDraftEmployee,
  firstDefined,
  normalizeDraftEmployeeApiRow,
  sumResolvedPayrollTotals,
} from "./deserializePayrollDraftEmployee";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const samplePayload = {
  gross_basic: 90000,
  pay_days: 30,
  government_monthly: {
    basic_paid: 50000,
    da_paid: 54000,
    hra_paid: 27000,
    transport_paid: 11520,
    medical_paid: 3000,
    total_earnings: 145520,
    total_deductions: 17662,
    net_salary: 127858,
    deductions: { pt: 200, cpf: 17462, income_tax: 0 },
    da_arrears_paid: 0,
    transport_arrears_paid: 0,
    gross_arrear: 0,
  },
};

function testNullTotalEarningsRestoresFromPayload() {
  const draft = {
    employeeUserId: "user-1",
    payDays: 30,
    grossPay: 145520,
    totalEarnings: null,
    totalArrears: null,
    totalDeductions: 17662,
    netPay: 127858,
    rowPayload: samplePayload,
  };
  const row = deserializePayrollDraftEmployee(draft, {
    employeeUserId: "user-1",
    grossPay: 1,
    governmentMonthly: { basicPaid: 1, totalEarnings: 1 },
  });
  const gm = row.governmentMonthly as Record<string, number>;
  assertEq(gm.totalEarnings, 145520, "totalEarnings from payload");
  assertEq(row.grossPay, 145520, "grossPay column");
  assertEq(gm.basicPaid, 50000, "basic from government_monthly");
}

function testBasicPaidFromGovernmentMonthly() {
  const row = deserializePayrollDraftEmployee(
    { employeeUserId: "user-1", rowPayload: samplePayload },
    { employeeUserId: "user-1", governmentMonthly: { basicPaid: 999 } },
  );
  assertEq((row.governmentMonthly as Record<string, number>).basicPaid, 50000, "basicPaid");
}

function testDeductionsRestore() {
  const row = deserializePayrollDraftEmployee(
    { employeeUserId: "user-1", rowPayload: samplePayload },
    null,
  );
  const ded = (row.governmentMonthly as { deductions: Record<string, number> }).deductions;
  assertEq(ded.pt, 200, "pt");
  assertEq(ded.cpf, 17462, "cpf");
  assertEq(ded.incomeTax, 0, "incomeTax zero preserved");
}

function testIntentionalZeroRemains() {
  const row = deserializePayrollDraftEmployee(
    {
      employeeUserId: "user-1",
      rowPayload: {
        government_monthly: {
          basic_paid: 0,
          da_paid: 0,
          total_earnings: 0,
          total_deductions: 0,
          net_salary: 0,
          deductions: { pt: 0, cpf: 0 },
        },
      },
    },
    {
      employeeUserId: "user-1",
      grossPay: 99999,
      governmentMonthly: {
        basicPaid: 50000,
        daPaid: 54000,
        totalEarnings: 99999,
        totalDeductions: 100,
        netSalary: 99899,
        deductions: { pt: 200, cpf: 100 },
      },
    },
  );
  const gm = row.governmentMonthly as {
    basicPaid: number;
    daPaid: number;
    totalEarnings: number;
    deductions: { pt: number; cpf: number };
  };
  assertEq(gm.basicPaid, 0, "zero basic kept");
  assertEq(gm.daPaid, 0, "zero da kept");
  assertEq(gm.totalEarnings, 0, "zero gross kept");
  assertEq(gm.deductions.pt, 0, "zero pt kept");
  assertEq(row.grossPay, 0, "zero grossPay kept");
}

function testMissingFallsBackToCalculated() {
  const row = deserializePayrollDraftEmployee(
    {
      employeeUserId: "user-1",
      rowPayload: { government_monthly: { medical_paid: 3000 } },
    },
    {
      employeeUserId: "user-1",
      payDays: 28,
      grossPay: 100000,
      governmentMonthly: {
        basicPaid: 40000,
        daPaid: 30000,
        medicalPaid: 1000,
        totalEarnings: 100000,
      },
    },
  );
  const gm = row.governmentMonthly as Record<string, number>;
  assertEq(gm.basicPaid, 40000, "basic from calc");
  assertEq(gm.daPaid, 30000, "da from calc");
  assertEq(gm.medicalPaid, 3000, "medical from draft");
  assertEq(row.payDays, 28, "payDays from calc when absent on draft columns");
}

function testEmployeeUserIdMatching() {
  const stored = {
    employeeUserId: "abc-123",
    totalEarnings: null,
    grossPay: 145520,
    rowPayload: samplePayload,
  };
  const normalized = normalizeDraftEmployeeApiRow(stored, "abc-123");
  assert(normalized, "normalized");
  assertEq(String(normalized.employeeUserId), "abc-123", "uid string");
  const wrong = deserializePayrollDraftEmployee(
    { ...normalized, employeeUserId: "abc-123" },
    { employeeUserId: "abc-123", governmentMonthly: { basicPaid: 1 } },
  );
  assertEq(String(wrong.employeeUserId), "abc-123", "matched uid");
}

function testHeaderTotalsEqualHydratedRows() {
  const rows = [
    deserializePayrollDraftEmployee(
      {
        employeeUserId: "a",
        grossPay: 145520,
        totalDeductions: 17662,
        netPay: 127858,
        rowPayload: samplePayload,
      },
      null,
    ),
    deserializePayrollDraftEmployee(
      {
        employeeUserId: "b",
        grossPay: 100,
        totalDeductions: 10,
        netPay: 90,
        rowPayload: {
          government_monthly: {
            total_earnings: 100,
            total_deductions: 10,
            net_salary: 90,
            da_arrears_paid: 5,
            transport_arrears_paid: 0,
            gross_arrear: 0,
          },
        },
      },
      null,
    ),
  ];
  const totals = sumResolvedPayrollTotals(rows);
  assertEq(totals.gross, 145620, "header gross");
  assertEq(totals.deductions, 17672, "header deductions");
  assertEq(totals.net, 127948, "header net");
  assertEq(totals.arrears, 5, "header arrears");
  assertEq(totals.employees, 2, "employee count");
}

function testFirstDefinedDoesNotTreatZeroAsMissing() {
  assertEq(firstDefined(0, 5), 0, "zero wins");
  assertEq(firstDefined(null, undefined, 5), 5, "skip null/undefined");
  assertEq(firstDefined(undefined, 0, 9), 0, "zero after undefined");
}

function testPreviewExportShapeUsesHydratedGm() {
  const row = deserializePayrollDraftEmployee(
    { employeeUserId: "user-1", rowPayload: samplePayload },
    { employeeUserId: "user-1", governmentMonthly: { basicPaid: 0, daPaid: 0 } },
  );
  const gm = row.governmentMonthly as Record<string, number>;
  // Same fields Preview/Extract Excel read via governmentMonthly
  assertEq(gm.basicPaid, 50000, "excel basic");
  assertEq(gm.daPaid, 54000, "excel da");
  assertEq(gm.hraPaid, 27000, "excel hra");
  assertEq(gm.transportPaid, 11520, "excel transport");
  assertEq(gm.medicalPaid, 3000, "excel medical");
  assertEq(gm.totalEarnings, 145520, "excel gross");
  assertEq(gm.totalDeductions, 17662, "excel deductions");
  assertEq(gm.netSalary, 127858, "excel net");
}

const tests = [
  testNullTotalEarningsRestoresFromPayload,
  testBasicPaidFromGovernmentMonthly,
  testDeductionsRestore,
  testIntentionalZeroRemains,
  testMissingFallsBackToCalculated,
  testEmployeeUserIdMatching,
  testHeaderTotalsEqualHydratedRows,
  testFirstDefinedDoesNotTreatZeroAsMissing,
  testPreviewExportShapeUsesHydratedGm,
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

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${tests.length} passed`);
