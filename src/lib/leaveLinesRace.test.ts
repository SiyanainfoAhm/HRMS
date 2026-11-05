import { applyResolvedLeaveBasis, leaveLinesMismatch, type LeaveLine } from "./leaveDeductions";

let failures = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); } else console.log(`ok   ${label}`);
}

// The bug: Four leave lines typed quickly. A lookup started when the list was [HPL Sep 4, EOL Sep 1] resolves after the
// operator already typed EOL Sep = 2 and added two October lines. The lookup result must only add the Sep basis.
const staleResolved: LeaveLine[] = [
  { type: "HPL", month: 9, year: 2026, days: 4, grossBasic: 43100, daPercent: 63, daysInMonth: 30 },
  { type: "EOL", month: 9, year: 2026, days: 1, grossBasic: 43100, daPercent: 63, daysInMonth: 30 },
];
const current: LeaveLine[] = [
  { type: "HPL", month: 9, year: 2026, days: 4 },
  { type: "EOL", month: 9, year: 2026, days: 2 },
  { type: "HPL", month: 10, year: 2026, days: 1 },
  { type: "EOL", month: 10, year: 2026, days: 2 },
];
const merged = applyResolvedLeaveBasis(current, staleResolved);
eq(merged.map((l) => [l.type, l.month, l.days]), [["HPL", 9, 4], ["EOL", 9, 2], ["HPL", 10, 1], ["EOL", 10, 2]], "typed days and all 4 lines survive a stale lookup");
eq(merged.map((l) => l.grossBasic ?? null), [43100, 43100, null, null], "Sep lines get the Sep basis; October lines (run month) stay unresolved/own values");
eq(merged[1].daysInMonth, 30, "calendar days copied");

const hasBasis: LeaveLine[] = [{ type: "HPL", month: 9, year: 2026, days: 2, grossBasic: 50000, daPercent: 60, daysInMonth: 30 }];
eq(applyResolvedLeaveBasis(hasBasis, staleResolved)[0].grossBasic, 50000, "a line that already has its basis keeps it");
eq(applyResolvedLeaveBasis(current, []).length, 4, "empty lookup changes nothing");

// Safety check
eq(leaveLinesMismatch(current, current.map((l) => ({ ...l }))), null, "identical lists agree");
eq(leaveLinesMismatch(current, [current[0], { ...current[1], days: 1 }, current[2], current[3]]), "line 2: screen shows EOL 2026-9 x2, save would send EOL 2026-9 x1", "a changed day count is reported");
eq(leaveLinesMismatch(current, current.slice(0, 2)), "line 3: screen shows HPL 2026-10 x1, save would send (no line)", "a missing line is reported");
eq(leaveLinesMismatch([], undefined), null, "no lines on both sides agree");

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("leaveLinesRace: all passed");
