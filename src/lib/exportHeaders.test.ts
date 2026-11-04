/**
 * Run with: npx --yes tsx src/lib/exportHeaders.test.ts
 * Excel export hygiene for the browser/Next-built workbooks (Run Payroll Preview Excel / Extract / finalized
 * export, Bank Letter): every header is a non-empty, non-numeric string, the preview header list equals the
 * Excel header row, and whole-number identifiers (pay days, pay level, serial numbers) are written with number
 * format '0' - never "#,##0", which would show 2026 as 2,026. The generated files are written to xlsx bytes and
 * parsed back. The PHP-built workbooks (TDS, Export Employee Payroll, CPF, Division, Paybill) are covered by
 * backend/tests/Unit/ExportHeadersAndYearFormatTest.php.
 */
import * as XLSX from "xlsx-js-style";
import { assertExportHeaders, invalidHeaderPositions } from "./exportHeaderGuard";
import { buildPayrollExcelHeaders, collectDynamicPayrollExcelColumns } from "./payrollExcelExport";
import { buildPayrollRunWorkbook } from "./payrollRunWorkbook";
import { buildBankLetterExcelBlob } from "./payrollBankLetterExport";

type Cell = { t?: string; v?: unknown; z?: string; w?: string };

function fail(msg: string): never {
  throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// 1. The guard itself.
for (const bad of [[""], ["  "], [null], [undefined], [0], ["0"], [2026], ["12"], [1.5], ["A", "", "B"]]) {
  let threw = false;
  try {
    assertExportHeaders(bad, "probe");
  } catch (e) {
    threw = String((e as Error).message).includes("Export 'probe'");
  }
  if (!threw) fail(`guard must reject ${JSON.stringify(bad)}`);
}
assertEq(invalidHeaderPositions(["Year", "", 0, "Net"]), [1, 2], "reports the offending positions");
assertExportHeaders(["Year", "EmployeeCode", "BasicPaid", "Net Pay"], "ok");

// 2. The Run Payroll fixed list (+ custom fields, even with blank/numeric labels) has only valid headers.
assertEq(invalidHeaderPositions(buildPayrollExcelHeaders([])), [], "fixed Run Payroll headers");
const dyn = collectDynamicPayrollExcelColumns(
  [],
  new Map([["a", "Allowance"], ["b", ""], ["c", "0"]]),
  new Set(["a", "b", "c"]),
  new Map<string, "earnings" | "deductions" | "statutory">([["a", "earnings"], ["b", "earnings"], ["c", "deductions"]]),
);
const withCustom = buildPayrollExcelHeaders(dyn);
const badCustom = invalidHeaderPositions(withCustom);
if (badCustom.length) fail(`custom fields produced invalid headers at ${badCustom.join(",")}: ${badCustom.map((i) => JSON.stringify(withCustom[i])).join(", ")}`);

// 3. A generated Preview Excel / Extract workbook, written and parsed back.
const rows = [1, 2].map((i) => ({
  employeeUserId: `employee-${i}`,
  employeeName: `Employee ${i}`,
  payrollMode: "government",
  payDays: 30,
  grossPay: 50000,
  deductions: 1000,
  netPay: 49000,
  bankAccountNumber: `00123456789${i}`,
  governmentMonthly: { payLevel: 10, totalEarnings: 50000, totalDeductions: 1000, netSalary: 49000, basicPaid: 50000 },
}));
const wb = buildPayrollRunWorkbook(rows as never, { month: 9, year: 2026, status: "Draft" });
const parsed = XLSX.read(XLSX.write(wb, { bookType: "xlsx", type: "array" }), { type: "array", cellNF: true, cellStyles: true });
const detail = parsed.Sheets["Employee Detail"];
const grid = XLSX.utils.sheet_to_json<unknown[]>(detail, { header: 1 }) as unknown[][];
const headerIdx = grid.findIndex((r) => r.includes("AccountNumber"));
if (headerIdx < 0) fail("header row not found in Employee Detail");
const headerRow = grid[headerIdx];
assertEq(invalidHeaderPositions(headerRow), [], "Employee Detail header row has no blank/null/0/numeric header");
assertEq(headerRow, buildPayrollExcelHeaders([], ["EncashmentDA"]), "preview header list equals the Excel header row (EncashmentDA left out: no row carries it)");

const cellOf = (h: string, r = headerIdx + 1) => detail[XLSX.utils.encode_cell({ r, c: headerRow.indexOf(h) })] as Cell;
for (const h of ["PayDays", "PayLevel"]) {
  const c = cellOf(h);
  assertEq(c.t, "n", `${h} stays a number`);
  assertEq(c.z, "0", `${h} number format is '0', not '#,##0'`);
}
assertEq(cellOf("PayLevel").v, 10, "PayLevel value");
// Money columns keep their format.
if (!String(cellOf("NetSalary").z).includes("#,##0")) fail(`NetSalary must keep its money format, got ${cellOf("NetSalary").z}`);
// No identifier column anywhere in the sheet carries a thousands separator format.
for (const h of ["PayDays", "PayLevel", "EmployeeCode"]) {
  const z = cellOf(h)?.z;
  if (z && z.includes(",")) fail(`${h} must not have a thousands separator format, got ${z}`);
}

// 4. Bank letter: header row valid, Sr No is a plain serial, Employee ID text.
async function bankLetter(): Promise<void> {
  const emps = rows.map((r, i) => ({
    employeeUserId: r.employeeUserId, employeeCode: `00${i + 1}`, employeeName: r.employeeName, bankAccountNumber: r.bankAccountNumber, netPay: r.netPay,
  }));
  const blob = buildBankLetterExcelBlob(emps, 9, 2026, "01/10/2026");
  const bank = XLSX.read(await blob.arrayBuffer(), { type: "array", cellNF: true, cellStyles: true }).Sheets["Bank Letter"];
  const hdr = ["A5", "B5", "C5", "D5", "E5"].map((a) => (bank[a] as Cell | undefined)?.v);
  assertEq(invalidHeaderPositions(hdr), [], "bank letter header row");
  assertEq(hdr, ["Sr No", "Employee ID", "Employee Name", "Account Number", "Amount (Rs.)"], "bank letter headers");
  assertEq((bank["A6"] as Cell).z, "0", "Sr No format is '0'");
  assertEq((bank["B6"] as Cell).t, "s", "Employee ID stays text");
  assertEq((bank["B6"] as Cell).v, "001", "Employee ID keeps its leading zeros");
}

bankLetter().then(
  () => console.log("exportHeaders.test.ts passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
