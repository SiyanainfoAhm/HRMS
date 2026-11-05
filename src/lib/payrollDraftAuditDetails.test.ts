/** Run with: npx --yes tsx src/lib/payrollDraftAuditDetails.test.ts */
import assert from "node:assert/strict";
import { draftAuditDetailLines } from "./payrollDraftAuditDetails";

// Field changes: one line each, with the reason in brackets (unchanged behaviour).
assert.deepEqual(
  draftAuditDetailLines([{ employeeCode: "010", employeeUserId: "u1", reason: "Fix", changes: { cpfArrear: { previous: null, new: 498 } } }]).map((l) => l.text),
  ["010: cpfArrear — → 498 (Fix)"],
);

// draft_copied: 82 employees, same note, no changes -> the note appears exactly once.
const note = "November 2026 draft copied from October 2026 draft v21";
const copied = Array.from({ length: 82 }, (_, i) => ({ employeeCode: String(i), employeeUserId: `u${i}`, reason: note }));
const lines = draftAuditDetailLines(copied);
assert.equal(lines.length, 1);
assert.equal(lines[0].text, note);

// Distinct notes are each shown once; blank/missing reasons show nothing; keys are unique.
const mixed = draftAuditDetailLines([{ reason: "A" }, { reason: "B" }, { reason: "A" }, { reason: "  " }, {}]);
assert.deepEqual(mixed.map((l) => l.text), ["A", "B"]);
assert.equal(new Set(mixed.map((l) => l.key)).size, mixed.length);

// Entries with changes and entries without can coexist.
assert.equal(draftAuditDetailLines([{ reason: "N" }, { employeeCode: "1", changes: { x: { previous: 1, new: 2 } } }]).length, 2);

assert.deepEqual(draftAuditDetailLines(undefined), []);
console.log("payrollDraftAuditDetails tests passed");
