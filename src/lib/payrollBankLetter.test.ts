/**
 * Run: npx --yes tsx src/lib/payrollBankLetter.test.ts
 */
import { payrollBankLetterFilename } from "./payrollDownloadFilenames";
import {
  mapRowToBankLetterEmployee,
  validateBankLetterEmployees,
  resolveBankLetterNetPay,
} from "./payrollBankLetter";
import {
  formatBankLetterAmount,
  payrollBankLetterFilenameForFormat,
  bankLetterSalaryMonthLabel,
} from "./payrollBankLetterExport";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function testFilename() {
  assertEq(payrollBankLetterFilename(9, 2026), "Bank Letter Sep 2026.docx", "sep filename");
  assertEq(payrollBankLetterFilename("01", "2026"), "Bank Letter Jan 2026.docx", "jan filename");
  assertEq(payrollBankLetterFilenameForFormat("xlsx", 9, 2026), "Bank Letter Sep 2026.xlsx", "xlsx");
  assertEq(payrollBankLetterFilenameForFormat("pdf", 9, 2026), "Bank Letter Sep 2026.pdf", "pdf");
  assertEq(bankLetterSalaryMonthLabel(9, 2026), "September 2026", "salary month");
  assertEq(formatBankLetterAmount(127858), "1,27,858.00", "indian amount");
  assertEq(formatBankLetterAmount(2139931), "21,39,931.00", "large indian amount");
}

function testUnsavedNetPreferred() {
  const n = resolveBankLetterNetPay({
    employeeUserId: "u1",
    netPay: 126858,
    governmentMonthly: { netSalary: 127858 },
  });
  assertEq(n, 126858, "unsaved net");
}

function testMapAndValidateAllEmployees() {
  const rows = Array.from({ length: 15 }, (_, i) =>
    mapRowToBankLetterEmployee({
      employeeUserId: `u${i + 1}`,
      employeeCode: `C${i + 1}`,
      employeeName: `Name ${i + 1}`,
      bankAccountNumber: `00000000000${i + 1}`,
      netPay: 1000 + i,
      governmentMonthly: { netSalary: 999 },
    }),
  );
  assertEq(rows.length, 15, "all 15");
  assertEq(rows[0].netPay, 1000, "uses row net not only gm");
  const ok = validateBankLetterEmployees(rows);
  assert(ok.ok, "valid");
}

function testMissingAccountBlocked() {
  const rows = [
    mapRowToBankLetterEmployee({
      employeeUserId: "u1",
      employeeCode: "E1",
      employeeName: "Rohan Mehta",
      bankAccountNumber: "",
      netPay: 10,
    }),
    mapRowToBankLetterEmployee({
      employeeUserId: "u2",
      employeeCode: "E2",
      employeeName: "Devang Shah",
      bankAccountNumber: "   ",
      netPay: 20,
    }),
  ];
  const result = validateBankLetterEmployees(rows);
  assert(!result.ok, "should fail");
  if (!result.ok) {
    assert(result.message.includes("Missing account number"), "message");
    assert(result.message.includes("Rohan Mehta"), "rohan");
    assert(result.message.includes("Devang Shah"), "devang");
  }
}

function testEmptyDisabled() {
  const result = validateBankLetterEmployees([]);
  assert(!result.ok, "empty fails");
}

function testButtonEnableLogic() {
  // Mirror toolbar exportDisabled: no rows and no draft and not finalized
  const exportDisabled = (rowCount: number, hasDraft: boolean, finalized: boolean) =>
    rowCount === 0 && !hasDraft && !finalized;
  assert(exportDisabled(0, false, false) === true, "disabled empty");
  assert(exportDisabled(15, false, false) === false, "enabled with rows");
  assert(exportDisabled(0, true, false) === false, "enabled with draft meta");
  assert(exportDisabled(0, false, true) === false, "enabled finalized");
}

const tests = [
  testFilename,
  testUnsavedNetPreferred,
  testMapAndValidateAllEmployees,
  testMissingAccountBlocked,
  testEmptyDisabled,
  testButtonEnableLogic,
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
if (failed) {
  process.exit(1);
}
console.log(`\n${tests.length} passed`);
