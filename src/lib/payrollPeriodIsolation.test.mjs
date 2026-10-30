import assert from "node:assert/strict";
import { freshPayrollLeaveDefaults, payrollPeriodKey, payrollRowCacheKey } from "./payrollPeriodIsolation.ts";

const november = payrollPeriodKey(2026, 11);
const december = payrollPeriodKey(2026, 12);
const january = payrollPeriodKey(2027, 1);
assert.equal(november, "2026-11");
assert.equal(december, "2026-12");
assert.equal(january, "2027-01");
assert.notEqual(payrollRowCacheKey(november, "employee-a"), payrollRowCacheKey(december, "employee-a"));
assert.notEqual(payrollRowCacheKey(december, "employee-a"), payrollRowCacheKey(december, "employee-b"));

const defaults = freshPayrollLeaveDefaults(2026, 12);
assert.deepEqual(defaults, {
  eolDays: 0,
  hplDays: 0,
  leaveRemarks: "",
  eolReferenceMonth: 12,
  eolReferenceYear: 2026,
  hplReferenceMonth: 12,
  hplReferenceYear: 2026,
});
assert.equal(new Date(2026, 12, 0).getDate(), 31, "December payable days when no other adjustment applies");

const stored = new Map([[payrollRowCacheKey(november, "employee-a"), { eolDays: 1, leaveRemarks: "November test" }]]);
assert.equal(stored.get(payrollRowCacheKey(december, "employee-a")), undefined, "November cannot hydrate a new December period");
assert.deepEqual(stored.get(payrollRowCacheKey(november, "employee-a")), { eolDays: 1, leaveRemarks: "November test" }, "switching back preserves November data");
console.log("Payroll period isolation tests passed");
