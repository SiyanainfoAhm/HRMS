import { markPayrollDraftFieldEdited, rowsForPayrollDraftSave } from "./payrollDraftPatch";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const rows = [
  { employeeUserId: "jangam", rowPayload: { governmentMonthly: { electricityUnitsConsumed: 48, deductions: { electricity: 900, mess: 650, creditSociety: 11750 } } } },
  { employeeUserId: "employee-2", rowPayload: { governmentMonthly: { deductions: { mess: 300, creditSociety: 500 } } } },
];
const changes = new Map<string, Set<string>>();
const key = (id: string) => `2026-10:${id}`;

markPayrollDraftFieldEdited(changes, key("jangam"), "govDeduction_mess");
const messPatch = rowsForPayrollDraftSave(rows, true, changes, key);
assert(messPatch.length === 1 && messPatch[0].employeeUserId === "jangam", "only edited employee is sent");
assert(messPatch[0].changedFields?.[0] === "govDeduction_mess", "operator field token is sent");
assert(messPatch[0].rowPayload.governmentMonthly.deductions.mess === 650, "field patch retains explicit current value");
assert(messPatch[0].rowPayload.governmentMonthly.electricityUnitsConsumed === 48, "unrelated patch carries the saved electricity units snapshot");
assert(messPatch[0].rowPayload.governmentMonthly.deductions.electricity === 900, "unrelated patch carries the saved electricity amount snapshot");

markPayrollDraftFieldEdited(changes, key("jangam"), "govDeduction_creditSociety");
const sequentialPatch = rowsForPayrollDraftSave(rows, true, changes, key);
assert(sequentialPatch[0].changedFields?.length === 2, "sequential edits union changed fields");
assert(sequentialPatch[0].rowPayload.governmentMonthly.deductions.creditSociety === 11750, "credit society value remains in payload");
assert(rowsForPayrollDraftSave(rows, true, new Map(), key).length === 0, "empty patch cannot clear employee rows");
assert(rowsForPayrollDraftSave(rows, false, new Map(), key).length === 2, "new draft gets complete initial snapshot");

const zeroRow = [{ employeeUserId: "zero", rowPayload: { governmentMonthly: { deductions: { mess: 0 } } } }];
const zeroChanges = new Map<string, Set<string>>();
markPayrollDraftFieldEdited(zeroChanges, key("zero"), "govDeduction_mess");
const intentionalZero = rowsForPayrollDraftSave(zeroRow, true, zeroChanges, key);
assert(intentionalZero[0].changedFields?.includes("govDeduction_mess"), "an explicitly edited zero carries the field token");
assert(intentionalZero[0].rowPayload.governmentMonthly.deductions.mess === 0, "intentional zero is serialized unchanged");

markPayrollDraftFieldEdited(changes, key("employee-2"), "govDeduction_mess");
const twoEmployees = rowsForPayrollDraftSave(rows, true, changes, key);
assert(twoEmployees.length === 2, "both edited employees are included");
assert(twoEmployees[0].changedFields?.includes("govDeduction_creditSociety"), "first employee has only own changes");
assert(twoEmployees[1].changedFields?.length === 1, "second employee has separate field mask");

console.log("payrollDraftPatch.test.ts: all tests passed");
