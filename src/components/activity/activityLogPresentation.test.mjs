import assert from "node:assert/strict";
import { actionLabel, auditChanges, buildActivityLogQueryParams, changeClassification, eventSummary, fieldLabel, formatTimestamp, payrollMonth, safeValue } from "./activityLogPresentation.ts";

const event = {
  eventId: "event-1", timestamp: "2026-10-27T11:52:00Z", actor: "Admin", actorRole: "admin", action: "payroll.generated.amended", outcome: "succeeded", employee: "Harshal Vishnu Karalkar", payrollYear: 2026, payrollMonth: 11,
  changedFields: [{ field: "basicPaid", label: "Basic Pay", before: 43027, after: 41490 }, { field: "eolDays", before: 2, after: 3 }, { field: "leaveRemarks", before: "Old remark", after: "New remark" }, { field: "mess", before: 0, after: 0 }],
};

assert.equal(actionLabel("payroll.generated.amended"), "Payroll Amended");
assert.equal(actionLabel("auth.login", "failed"), "Failed Login Attempt");
assert.equal(actionLabel("some_new.action"), "Some New Action");
assert.equal(fieldLabel("eolDays"), "EOL Days");
assert.equal(safeValue(43027, "basicPaid"), "₹43,027");
assert.equal(safeValue(1, "eolDays"), "1 day");
assert.equal(safeValue(42, "electricityUnitsConsumed"), "42 units");
assert.equal(safeValue(null), "—");
assert.equal(safeValue(["A", "B"]), "A, B");
assert.equal(safeValue({ eolDays: 1, accessToken: "hidden" }), "EOL Days: 1 day");
assert.notEqual(safeValue({ x: 1 }), "[object Object]");

const changes = auditChanges(event);
assert.equal(changes.length, 3, "unchanged fields are hidden by default");
assert.equal(changes[0].difference, -1537);
assert.equal(safeValue(Math.abs(changes[0].difference), changes[0].field), "₹1,537");
assert.equal(changes[2].before, "Old remark");
assert.equal(auditChanges(event, true).length, 4, "show unchanged option includes unchanged fields");
assert.equal(changeClassification(event), null, "manual/recalculated classes require reliable metadata");
const classified = { ...event, details: { changeClassificationSource: "payroll-ui", directEditedFields: ["eolDays"], recalculatedFields: ["basicPaid"] } };
assert.deepEqual(changeClassification(classified), { direct: ["eolDays"], recalculated: ["basicPaid"] });
assert.match(eventSummary(classified), /EOL Days changed from 2 days to 3 days/);
assert.equal(payrollMonth(2026, 11), "November 2026");
assert.ok(formatTimestamp(event.timestamp).includes("27"));
const filters = buildActivityLogQueryParams({ search: " Admin ", action: "auth.login", actor: "Admin", employee: "Harshal", period: "2026-11", from: "2026-10-01", to: "2026-10-31", category: "security", outcome: "failed" }, 3, 50);
assert.equal(filters.get("page"), "3", "server pagination page is sent");
assert.equal(filters.get("per_page"), "50");
assert.equal(filters.get("year"), "2026");
assert.equal(filters.get("month"), "11");
assert.equal(filters.get("from"), "2026-10-01");
assert.equal(filters.get("to"), "2026-10-31");
assert.equal(filters.get("outcome"), "failed");
assert.equal(filters.get("search"), "Admin");

console.log("Activity log presentation tests passed");
