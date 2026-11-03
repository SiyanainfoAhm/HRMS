/**
 * Run: npx --yes tsx src/components/activity/activityEntries.test.ts
 *
 * The Activity Log screen: no "Earlier records" tab, the filters (Module, Performed By, Employee, Month/Year, date range)
 * are server-side query parameters, a hung request ends in an error with Retry, and View Details lists only what changed.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogScreen } from "./ActivityLogScreen";
import { ACTIVITY_REQUEST_TIMEOUT_MS, activityEntriesQuery, detailSummaryLine } from "./activityEntriesQuery";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const base = { module: "", actor: "", employee: "", period: "", from: "", to: "", page: 1, perPage: 25 };
assertEq(activityEntriesQuery(base), "page=1&per_page=25", "no filters");
assertEq(
  activityEntriesQuery({ ...base, module: "Quarters", actor: " Admin ", employee: "0042", period: "2026-09", from: "2026-09-01", to: "2026-09-30", page: 3, perPage: 50 }),
  "page=3&per_page=50&module=Quarters&actor=Admin&employee=0042&year=2026&month=9&from=2026-09-01&to=2026-09-30",
  "every filter is a server-side parameter",
);
assertEq(activityEntriesQuery({ ...base, page: 0 }), "page=1&per_page=25", "page never below 1");
assertEq(ACTIVITY_REQUEST_TIMEOUT_MS > 0 && ACTIVITY_REQUEST_TIMEOUT_MS <= 60_000, true, "a hung request times out");
assertEq(detailSummaryLine([{ kind: "typed" }, { kind: "recalculated" }, { kind: "recalculated" }]), "1 typed change, 2 recalculated", "typed vs recalculated summary");
assertEq(detailSummaryLine([{ kind: "typed" }]), null, "no summary when nothing was recalculated");

const html = renderToStaticMarkup(createElement(ActivityLogScreen));
assertEq(html.includes("Earlier records"), false, "no Earlier records tab");
assertEq(html.includes('role="tablist"'), false, "no tabs at all");
for (const label of ["Module", "Performed By", "Employee", "Month / Year", "From", "To", "View Details", "Date", "Time", "Action"]) {
  assertEq(html.includes(label), true, `${label} is on the screen`);
}
for (const m of ["Payroll", "Master", "Users", "Settings", "Quarters", "Reports"]) assertEq(html.includes(`>${m}<`), true, `module ${m} can be filtered`);

// The retained endpoints and data are still there; only the UI entry is gone.
const proxy = readFileSync(new URL("../../app/api/activity-logs/route.ts", import.meta.url), "utf8");
assertEq(proxy.includes('"/activity-logs"'), true, "the per-employee endpoint is kept");
const screen = readFileSync(new URL("./ActivityLogScreen.tsx", import.meta.url), "utf8");
assertEq(screen.includes("LegacyActivityLogScreen"), false, "legacy screen is not rendered");

console.log("activityEntries.test.ts passed");
