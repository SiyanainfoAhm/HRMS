/**
 * Run: npx --yes tsx src/lib/hplEolDeductions.test.ts
 *
 * EOL / HPL deductions and pay-day proration across 28/29/30/31-day months and
 * across a reference month that differs from the payroll month.
 */
import {
  applyBasicDaEarningsCut,
  applyProportionalEarningsCut,
  computeEolHplDeductions,
  daysInCalendarMonth,
} from "./hplEolDeductions";
import { calendarDaysInMonth, equivalentPayableDays, leaveSalaryAdjustment } from "./payrollLeaveDays";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const salary = { basic: 30000, da: 15900, hra: 9000, medical: 0 }; // EOL basis 54900, HPL basis 45900

// Month lengths, including leap February.
assertEq(daysInCalendarMonth(2026, 2), 28, "Feb 2026");
assertEq(daysInCalendarMonth(2028, 2), 29, "Feb 2028");
assertEq(daysInCalendarMonth(2026, 4), 30, "Apr");
assertEq(daysInCalendarMonth(2026, 12), 31, "Dec");
assertEq(calendarDaysInMonth(2026, 13), 0, "invalid month");

// One EOL day is 1/dim of the basis, for each month length.
for (const [dim, expected] of [[28, 1960.71], [29, 1893.1], [30, 1830], [31, 1770.97]] as const) {
  assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: dim, eolDays: 1 }).eolDeduction, expected, `EOL 1 day in ${dim}-day month`);
}

// HPL: half a day's pay per HPL day, on Basic + DA only.
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, hplDays: 2 }).hplDeduction, Math.round((45900 / 30) * 2 * 0.5), "2 HPL days = 1 day on basic+DA");
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, hplDays: 2 }).eolDeduction, 0, "HPL does not create EOL");

// Leave charged to a prior month uses THAT month's length (Feb reference used in March).
const fromFeb = computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 28, eolDays: 3 }).eolDeduction;
const fromMar = computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 31, eolDays: 3 }).eolDeduction;
assertEq(fromFeb, 5882.14, "Feb reference");
assertEq(fromFeb > fromMar, true, "shorter reference month costs more per day");

// Boundaries: zero, negative, fractional, more than the month, whole month.
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30 }).eolDeduction, 0, "no leave");
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, eolDays: -4 }).eolDeduction, 0, "negative clamps to 0");
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, eolDays: 2.9 }).eolDays, 2, "fractional days floor");
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, eolDays: 99 }).eolDeduction, 54900, "leave capped at the month: never more than that month's salary");
assertEq(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 30, eolDays: 30 }).eolDeduction, 54900, "whole month");
assertEq(computeEolHplDeductions({ referenceSalary: { basic: 0, da: 0, hra: 0, medical: 0 }, daysInReferenceMonth: 30, eolDays: 5 }).eolDeduction, 0, "zero salary");
assertEq(Number.isFinite(computeEolHplDeductions({ referenceSalary: salary, daysInReferenceMonth: 0, eolDays: 1 }).eolDeduction), true, "zero days in month is guarded");
assertEq(computeEolHplDeductions({ referenceSalary: { basic: 1e9, da: 1e9, hra: 0, medical: 0 }, daysInReferenceMonth: 31, eolDays: 31 }).eolDeduction, 2e9, "very large basis");

// The earnings cut never exceeds what is paid and keeps the cut total exactly.
const cut = applyProportionalEarningsCut({ basic: 30000, da: 15900, hra: 9000, medical: 0 }, 1830);
assertEq(Math.abs(30000 + 15900 + 9000 - (cut.basic + cut.da + cut.hra + cut.medical) - 1830) <= 2, true, "cut total preserved within rounding");
const overCut = applyProportionalEarningsCut({ basic: 100, da: 0, hra: 0, medical: 0 }, 5000);
assertEq(overCut.basic, 0, "cut larger than pay clamps at zero");
const hplCut = applyBasicDaEarningsCut({ basic: 30000, da: 15900, hra: 9000, medical: 500 }, 765);
assertEq(hplCut.hra, 9000, "HPL leaves HRA");
assertEq(hplCut.medical, 500, "HPL leaves medical");

// Equivalent payable days: calendar days less EOL, less half of HPL; never negative.
assertEq(equivalentPayableDays(28, 0, 0), 28, "Feb full");
assertEq(equivalentPayableDays(28, 2, 4), 24, "Feb with EOL and HPL");
assertEq(equivalentPayableDays(30, 100, 0), 0, "lower bound");
assertEq(leaveSalaryAdjustment(30000, 3, 30), 3000, "3/30 of 30000");
assertEq(leaveSalaryAdjustment(31000, 1, 31), 1000, "1/31");
assertEq(leaveSalaryAdjustment(28000, 1, 28), 1000, "1/28");

console.log("hplEolDeductions.test.ts: all tests passed");
