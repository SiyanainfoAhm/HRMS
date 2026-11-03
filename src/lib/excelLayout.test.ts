/**
 * Run with: npx --yes tsx src/lib/excelLayout.test.ts
 * Layout regression for the browser/Next-built workbooks (Run Payroll detail + summary, Extract,
 * Download/Preview Excel, Bank Letter Excel): no numeric cell may be wider than its column ("####"),
 * widths stay in [8, 50], amounts are numbers (never text), account numbers stay text, header is frozen
 * and filterable. The PHP-built workbooks are covered by backend/tests/Unit/SpreadsheetLayoutTest.php.
 */
import * as XLSX from "xlsx-js-style";
import { buildPayrollRunWorkbook } from "./payrollRunWorkbook";
import { buildBankLetterExcelBlob } from "./payrollBankLetterExport";
import { contentColumnWidths, renderedCellLength } from "./payrollExcelStyles";

type Cell = { t?: string; v?: unknown; z?: string; f?: string };

function fail(msg: string): never {
  throw new Error(msg);
}

function mergedSet(ws: XLSX.WorkSheet): Set<string> {
  const out = new Set<string>();
  for (const m of ws["!merges"] ?? []) {
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) out.add(XLSX.utils.encode_cell({ r, c }));
  }
  return out;
}

/** Problems that would show as "####" or break the column rules. */
function audit(name: string, ws: XLSX.WorkSheet, firstRow0: number): string[] {
  const problems: string[] = [];
  const cols = (ws["!cols"] ?? []) as Array<{ wch?: number }>;
  const merged = mergedSet(ws);
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  cols.forEach((col, c) => {
    if (col?.wch == null || col.wch < 8 || col.wch > 50) problems.push(`${name}: column ${c} width ${col?.wch} outside 8..50`);
  });
  for (let c = range.s.c; c <= range.e.c; c++) {
    const wch = cols[c]?.wch ?? 8.43;
    let widestNumber = 0;
    let hasFormula = false;
    for (let r = firstRow0; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as Cell | undefined;
      if (!cell || merged.has(addr)) continue;
      if (cell.f && cell.v == null) {
        hasFormula = true;
        continue;
      }
      if (typeof cell.v === "number") {
        const len = renderedCellLength(cell) + 1;
        widestNumber = Math.max(widestNumber, len);
        if (len > wch) problems.push(`${name}!${addr}: needs ${len}, column is ${wch} (would show ####)`);
      }
    }
    if (hasFormula && widestNumber + 3 > wch + 3) problems.push(`${name}: total of column ${c} may not fit`);
  }
  return problems;
}

const rows = [1, 2, 3].map((i) => ({
  employeeUserId: `employee-${i}`,
  employeeName: `Employee ${i} with a rather long name ${"X".repeat(i * 4)}`,
  payrollMode: "government",
  grossPay: 98765432.1 * i,
  deductions: 12345678.9,
  netPay: 86419753.2 * i,
  bankAccountNumber: `00123456789${i}`,
  division: "Safety & Homologation Division",
  department: "Automotive Testing and Certification Department",
  designation: "Principal Technical Officer",
  governmentMonthly: { totalEarnings: 98765432.1 * i, totalDeductions: 12345678.9, netSalary: 86419753.2 * i, basicPaid: 123456.5 * i, daPaid: 98765.43 * i },
}));

const wb = buildPayrollRunWorkbook(rows as never, { month: 9, year: 2026, status: "Draft" });
const detail = wb.Sheets["Employee Detail"];
const problems = [...audit("Employee Detail", detail, 3)];
if (problems.length) fail(problems.slice(0, 8).join("\n"));

const filter = (detail as { "!autofilter"?: { ref: string } })["!autofilter"];
if (!filter) fail("Employee Detail must have an autofilter on the header row");
const view = (detail as { "!views"?: Array<{ state?: string; xSplit?: number; ySplit?: number }> })["!views"]?.[0];
if (view?.state !== "frozen" || !view.ySplit || view.xSplit !== 2) fail("Employee Detail must freeze the header row and the first two columns");
const page = (detail as { "!pageSetup"?: { orientation?: string; fitToWidth?: number } })["!pageSetup"];
if (page?.orientation !== "landscape" || page.fitToWidth !== 1) fail("Employee Detail must print landscape, fit to one page wide");

// Account numbers stay text (leading zeros), amounts are numbers.
const headerRow = (XLSX.utils.sheet_to_json<string[]>(detail, { header: 1 }) as string[][]).findIndex((r) => r.includes("AccountNumber"));
const acctCol = (XLSX.utils.sheet_to_json<string[]>(detail, { header: 1 }) as string[][])[headerRow].indexOf("AccountNumber");
const acct = detail[XLSX.utils.encode_cell({ r: headerRow + 1, c: acctCol })] as Cell;
if (acct.t !== "s" || acct.v !== "001234567891") fail(`Account number must stay text, got ${JSON.stringify(acct)}`);
const netCol = (XLSX.utils.sheet_to_json<string[]>(detail, { header: 1 }) as string[][])[headerRow].indexOf("NetPay");
const net = detail[XLSX.utils.encode_cell({ r: headerRow + 1, c: netCol })] as Cell;
if (net.t !== "n") fail("NetPay must be a numeric cell");

// Helper behaviour.
const probe: Record<string, unknown> = {
  A1: { t: "s", v: "Header" },
  A2: { t: "n", v: 1234567.891, z: '"₹"#,##0.00' },
  A3: { t: "s", v: "x".repeat(80) },
};
const w = contentColumnWidths(probe, { firstRow0: 0, lastRow0: 2, lastCol0: 0 });
if (w[0].wch !== 50) fail(`long text must cap at 50, got ${w[0].wch}`);
if (renderedCellLength(probe.A2 as Cell) !== 13) fail(`₹1,234,567.89 is 13 chars, got ${renderedCellLength(probe.A2 as Cell)}`);
const tiny = contentColumnWidths({ A1: { t: "s", v: "ID" } }, { firstRow0: 0, lastRow0: 0, lastCol0: 0 });
if (tiny[0].wch !== 8) fail("narrow content must still get the minimum width of 8");

async function bankLetterChecks(): Promise<void> {
// Bank letter Excel: amounts numeric with the Indian format, account text, widths fit.
const emps = rows.map((r, i) => ({
  employeeUserId: r.employeeUserId,
  employeeCode: `00${i + 1}`,
  employeeName: r.employeeName,
  bankAccountNumber: r.bankAccountNumber,
  netPay: r.netPay,
}));
const blob = buildBankLetterExcelBlob(emps, 9, 2026, "01/10/2026");
const bank = XLSX.read(await blob.arrayBuffer(), { type: "array", cellNF: true, cellStyles: true }).Sheets["Bank Letter"];
const bankAmt = bank["E6"] as Cell;
if (bankAmt.t !== "n") fail("Bank letter amount must be a number, not text");
if (!bankAmt.z?.includes("##0") || bankAmt.z.includes("0.00")) fail(`Bank letter amount needs an explicit number format, got ${bankAmt.z}`);
const bankAcct = bank["D6"] as Cell;
if (bankAcct.t !== "s") fail("Bank letter account number must stay text");
const bankCols = (bank["!cols"] ?? []) as Array<{ wch?: number }>;
if (!bankCols.length || bankCols.some((c) => (c.wch ?? 0) < 8 || (c.wch ?? 0) > 50)) fail("Bank letter widths must be set within 8..50");
const need = Math.max(...emps.map((e) => `${Math.round(e.netPay).toLocaleString("en-IN")}`.length));
if ((bankCols[4].wch ?? 0) < need + 1) fail(`Bank letter amount column ${bankCols[4].wch} too narrow for ${need} chars`);

}

bankLetterChecks().then(
  () => console.log("excelLayout tests passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
