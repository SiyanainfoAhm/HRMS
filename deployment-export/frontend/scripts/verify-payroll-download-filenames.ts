import assert from "node:assert/strict";
import {
  formatPayrollMonthYear,
  payrollDetailWorkbookFilename,
  payrollExtractWorkbookFilename,
} from "../src/lib/payrollDownloadFilenames";

assert.equal(formatPayrollMonthYear(9, 2026), "Sep 2026");
assert.equal(formatPayrollMonthYear("09", "2026"), "Sep 2026");
assert.equal(formatPayrollMonthYear(1, 2026), "Jan 2026");
assert.equal(formatPayrollMonthYear(12, 2026), "Dec 2026");
assert.equal(payrollDetailWorkbookFilename(9, 2026), "Sep 2026.xlsx");
assert.equal(payrollExtractWorkbookFilename(9, 2026), "Extract Sep 2026.xlsx");
assert.equal(payrollDetailWorkbookFilename(1, 2026), "Jan 2026.xlsx");
assert.equal(payrollExtractWorkbookFilename(12, 2026), "Extract Dec 2026.xlsx");

console.log("payrollDownloadFilenames: OK");
