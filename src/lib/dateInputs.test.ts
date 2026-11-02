/**
 * Run: npx --yes tsx src/lib/dateInputs.test.ts
 *
 * Value format, parsing and rules behind DateInput / MonthInput, plus smoke checks that Post Payroll Downloads and the
 * Activity Log render the shared components and no native month/date input is left anywhere in src.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addDays,
  addMonthsToYm,
  addMonthsToYmd,
  calendarWeeks,
  checkYmdInRange,
  clampYmd,
  formatDmy,
  formatDmyFromIso,
  formatDmyTimeFromIso,
  formatMonthLabel,
  formatTime12FromIso,
  isValidYm,
  isValidYmd,
  maskDmyInput,
  monthDisabledReason,
  parseDmy,
  reconcileMonthRange,
} from "./dateInputs";
import { DateInput } from "../components/ui/DateInput";
import { MonthInput } from "../components/ui/MonthInput";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ---- date value format: display DD/MM/YYYY, value YYYY-MM-DD
assertEq(formatDmy("2026-10-05"), "05/10/2026", "format");
assertEq(formatDmy(""), "", "empty formats to empty");
assertEq(formatDmy("2026-02-31"), "", "impossible stored date formats to empty");
assertEq(formatDmy(null), "", "null");

// ---- parsing typed text
assertEq(parseDmy("05/10/2026"), { ok: true, ymd: "2026-10-05" }, "typed");
assertEq(parseDmy("5/1/2026"), { ok: true, ymd: "2026-01-05" }, "single digits");
assertEq(parseDmy("05-10-2026"), { ok: true, ymd: "2026-10-05" }, "dashes");
assertEq(parseDmy("05.10.2026"), { ok: true, ymd: "2026-10-05" }, "dots");
assertEq(parseDmy("05102026"), { ok: true, ymd: "2026-10-05" }, "eight digits");
assertEq(parseDmy("29/02/2028"), { ok: true, ymd: "2028-02-29" }, "leap day");
assertEq(parseDmy("31/02/2026"), { ok: false, reason: "invalid" }, "31/02/2026 is rejected");
assertEq(parseDmy("29/02/2026"), { ok: false, reason: "invalid" }, "29 Feb in a non-leap year");
assertEq(parseDmy("31/04/2026"), { ok: false, reason: "invalid" }, "31 April");
assertEq(parseDmy("00/10/2026"), { ok: false, reason: "invalid" }, "day 0");
assertEq(parseDmy("10/13/2026"), { ok: false, reason: "invalid" }, "month 13 (US order is not accepted)");
assertEq(parseDmy("05/10/26"), { ok: false, reason: "incomplete" }, "two-digit year is not guessed");
assertEq(parseDmy("05/10/"), { ok: false, reason: "incomplete" }, "partial");
assertEq(parseDmy("hello"), { ok: false, reason: "invalid" }, "text");
assertEq(parseDmy("  "), { ok: false, reason: "empty" }, "blank is empty");
assertEq(parseDmy("05/10/1800"), { ok: false, reason: "invalid" }, "year before 1900");
assertEq(maskDmyInput("05102026"), "05/10/2026", "mask inserts slashes");
assertEq(maskDmyInput("0510"), "05/10", "mask partial");
assertEq(maskDmyInput("05/10/20269999"), "05/10/2026", "mask caps at 8 digits");
assertEq(maskDmyInput("ab12"), "12", "mask drops letters");

// ---- min / max
assertEq(checkYmdInRange("2026-10-05", "2026-10-01", "2026-10-31"), "ok", "inside");
assertEq(checkYmdInRange("2026-09-30", "2026-10-01", "2026-10-31"), "before-min", "before min");
assertEq(checkYmdInRange("2026-11-01", "2026-10-01", "2026-10-31"), "after-max", "after max");
assertEq(checkYmdInRange("2026-10-01", "2026-10-01", "2026-10-31"), "ok", "min is inclusive");
assertEq(checkYmdInRange("2026-10-31", "2026-10-01", "2026-10-31"), "ok", "max is inclusive");
assertEq(checkYmdInRange("1999-01-01", undefined, undefined), "ok", "no bounds");
assertEq(clampYmd("2026-12-01", "2026-10-01", "2026-10-31"), "2026-10-31", "clamp to max");
assertEq(clampYmd("2026-01-01", "2026-10-01", "2026-10-31"), "2026-10-01", "clamp to min");

// ---- calendar arithmetic (no time-zone dependence)
assertEq(addDays("2026-12-31", 1), "2027-01-01", "year rollover");
assertEq(addDays("2026-03-01", -1), "2026-02-28", "back over February");
assertEq(addMonthsToYmd("2026-01-31", 1), "2026-02-28", "month add clamps the day");
assertEq(addMonthsToYmd("2028-01-31", 1), "2028-02-29", "leap year clamp");
assertEq(addMonthsToYmd("2026-01-15", -1), "2025-12-15", "month subtract over a year");
const weeks = calendarWeeks(2026, 10); // 1 Oct 2026 is a Thursday
assertEq(weeks.length, 6, "six weeks");
assertEq(weeks[0].map((d) => d ?? "."), [".", ".", ".", ".", "2026-10-01", "2026-10-02", "2026-10-03"], "Sunday-first layout");
assertEq(weeks.flat().filter(Boolean).length, 31, "October has 31 days");
assertEq(isValidYmd("2026-10-05"), true, "valid ymd");
assertEq(isValidYmd("2026-13-05"), false, "invalid ymd");

// ---- month value format: display "Oct 2026", value YYYY-MM
assertEq(formatMonthLabel("2026-10"), "Oct 2026", "month label");
assertEq(formatMonthLabel(""), "", "empty month label");
assertEq(formatMonthLabel("2026-13"), "", "bad month label");
assertEq(isValidYm("2026-10"), true, "valid ym");
assertEq(isValidYm("2026-00"), false, "month 00");
assertEq(isValidYm("2026-10-01"), false, "a date is not a month");
assertEq(addMonthsToYm("2026-12", 1), "2027-01", "month rollover");
assertEq(addMonthsToYm("2026-01", -1), "2025-12", "month rollover back");

// ---- month availability, min/max and the reasons shown in the title
const rules = { available: ["2026-09", "2026-10"], unavailableReason: "No payroll generated" };
assertEq(monthDisabledReason("2026-10", rules), null, "generated month is selectable");
assertEq(monthDisabledReason("2026-11", rules), "No payroll generated", "month without payroll is disabled with a reason");
assertEq(monthDisabledReason("2026-08", { min: "2026-09" }), "Before Sep 2026", "min");
assertEq(monthDisabledReason("2026-12", { max: "2026-10" }), "After Oct 2026", "max");
assertEq(monthDisabledReason("2026-10", { min: "2026-10", max: "2026-10" }), null, "bounds are inclusive");
assertEq(monthDisabledReason("2026-11", { available: null }), null, "no availability list = nothing disabled");

// ---- TDS range: "to" can never be before "from"
assertEq(reconcileMonthRange({ from: "2026-09", to: "2026-10" }), { from: "2026-09", to: "2026-10" }, "valid range kept");
assertEq(reconcileMonthRange({ from: "2026-09", to: "2026-09" }), { from: "2026-09", to: "2026-09" }, "same month is a valid range");
assertEq(reconcileMonthRange({ from: "2026-11", to: "2026-10" }), { from: "2026-11", to: "" }, "to before from is cleared");
assertEq(reconcileMonthRange({ from: "2026-11", to: "" }), { from: "2026-11", to: "" }, "optional to stays empty (clear)");

// ---- timestamps in the activity tables: DD/MM/YYYY and 12-hour, always IST
const iso = "2026-11-02T09:52:00Z"; // 15:22 IST
assertEq(formatDmyFromIso(iso), "02/11/2026", "activity date");
assertEq(formatTime12FromIso(iso), "3:22 pm", "activity time");
assertEq(formatDmyTimeFromIso(iso), "02/11/2026, 3:22 pm", "activity date and time");
assertEq(formatDmyFromIso("2026-12-31T20:00:00Z"), "01/01/2027", "IST date can differ from the UTC date");
assertEq(formatDmyTimeFromIso(null), "—", "missing timestamp");
assertEq(formatDmyTimeFromIso("nonsense"), "—", "bad timestamp");

// ---- the components render the Indian display, the right placeholders and the optional/clear affordances
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const dateEmpty = html(createElement(DateInput, { value: "", onChange: () => {}, "aria-label": "From date" }));
assertEq(dateEmpty.includes('placeholder="Select date"'), true, "date placeholder");
assertEq(dateEmpty.includes('type="date"'), false, "date input is not native");
const dateOptional = html(createElement(DateInput, { value: "", onChange: () => {}, optional: true, "aria-label": "To date" }));
assertEq(dateOptional.includes('placeholder="Optional"'), true, "optional date placeholder");
const dateFilled = html(createElement(DateInput, { value: "2026-10-05", onChange: () => {}, optional: true, "aria-label": "From date" }));
assertEq(dateFilled.includes('value="05/10/2026"'), true, "date shows DD/MM/YYYY");
assertEq(dateFilled.includes('aria-label="Clear From date"'), true, "optional field with a value has a visible clear button");
const dateRequired = html(createElement(DateInput, { value: "2026-10-05", onChange: () => {}, required: true, "aria-label": "Effective" }));
assertEq(dateRequired.includes("Clear"), false, "required field has no clear button");
const monthEmpty = html(createElement(MonthInput, { value: "", onChange: () => {}, "aria-label": "Month" }));
assertEq(monthEmpty.includes("Select month"), true, "month placeholder");
assertEq(monthEmpty.includes('type="month"'), false, "month input is not native");
const monthOptional = html(createElement(MonthInput, { value: "", onChange: () => {}, optional: true, "aria-label": "To month" }));
assertEq(monthOptional.includes(">Optional<"), true, "optional month placeholder");
const monthFilled = html(createElement(MonthInput, { value: "2026-10", onChange: () => {}, optional: true, "aria-label": "To month" }));
assertEq(monthFilled.includes("Oct 2026"), true, "month shows Oct 2026");
assertEq(monthFilled.includes('aria-label="Clear To month"'), true, "optional month has a clear button");

// ---- smoke: the Activity Log uses the shared components (the TDS month range lives in the Run Payroll Downloads menu, see downloadsMenu.test.ts)
async function smoke() {
  const act = html(createElement((await import("../components/activity/ActivityEntriesView")).ActivityEntriesView));
  assertEq(act.includes('aria-label="From date"') && act.includes('aria-label="To date"'), true, "activity filters use DateInput");
  assertEq(/type="(month|date)"/.test(act), false, "activity entries has no native date input");
  const legacy = html(createElement((await import("../components/activity/ActivityLogScreen")).ActivityLogScreen));
  assertEq(legacy.includes("Activity"), true, "activity screen renders");

  // guard: nothing in src may bring the browser's own pickers back
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
        const src = readFileSync(p, "utf8");
        if (/type=["'{]+\s*["']?(month|date|datetime-local)["']/.test(src)) offenders.push(p);
      }
    }
  };
  walk(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assertEq(offenders, [], "no native month/date/datetime-local inputs remain");

  console.log("dateInputs.test.ts passed");
}
smoke().catch((e) => { console.error(e); process.exit(1); });
