/**
 * Run with: npx --yes tsx src/lib/monthlySummarySections.test.ts
 * Verifies the Monthly Summary section headings are lettered A, B, C, D... with no gaps.
 */
import * as XLSX from "xlsx-js-style";
import { buildMonthlySummarySheet } from "./payrollRunWorkbook";

const ws = buildMonthlySummarySheet([], { month: 1, year: 2026, status: "draft" as never });

const letters: string[] = [];
const titles: string[] = [];
for (const addr of Object.keys(ws)) {
  if (addr.startsWith("!")) continue;
  const v = (ws as Record<string, XLSX.CellObject>)[addr]?.v;
  if (typeof v !== "string") continue;
  // Section titles are all caps ("A. GROSS SALARY"); line labels such as "N. All." (night allowance) are not headings.
  const m = /^([A-Z])\. [A-Z]{2,}/.exec(v);
  if (m && XLSX.utils.decode_cell(addr).c === 0) {
    letters.push(m[1]);
    titles.push(v);
  }
}

const expected = letters.map((_, i) => String.fromCharCode(65 + i));
if (letters.length < 4 || letters.join("") !== expected.join("")) {
  throw new Error(`Section headings must be lettered A, B, C, D... with no gaps; got: ${letters.join(",")}`);
}
const leave = titles.find((t) => t.includes("LEAVE ADJUSTMENTS"));
if (leave !== "D. LEAVE ADJUSTMENTS (already deducted from earnings; not part of Total Deductions)") {
  throw new Error(`Unexpected leave heading: ${leave}`);
}
console.log("monthlySummarySections: OK", letters.join(""));
