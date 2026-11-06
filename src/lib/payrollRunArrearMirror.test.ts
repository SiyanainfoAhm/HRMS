/**
 * Run: npx --yes tsx src/lib/payrollRunArrearMirror.test.ts
 *
 * The Arrears (UNPAID) section is the only editable source; Earnings/Deductions
 * arrear lines are read-only mirrors; the generic custom "arrears" box is hidden at 0.
 */
import { readFileSync } from "node:fs";
import {
  ARREAR_MIRROR_HINT,
  isCustomEarningVisibleOnRow,
  isMirroredArrearKey,
  mirroredArrearValue,
  resolveUnpaidArrears,
  type UnpaidArrearsSource,
} from "./payrollRunArrearMirror";
import { applyAutoArrearsToGovernmentMonthly } from "./payrollArrearCalc";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { recalculateGovernmentSheetTotals } from "./runPayrollSheetEdit";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// 1. Mirrors follow the unpaid section (row values win, drafts fall back to the monthly row).
let row: UnpaidArrearsSource = { governmentMonthly: { daArrearsPaid: 10, transportArrearsPaid: 5, grossArrear: 15, cpfArrear: 2, netArrear: 13 } };
assertEq(mirroredArrearValue(row, "daArrearsPaid"), 10, "old draft: DA mirror from monthly");
assertEq(mirroredArrearValue(row, "cpfArrear"), 2, "old draft: CPF mirror from monthly");
row = { ...row, daArrear: 1000, transportArrear: 200, grossArrear: 1200, cpfArrear: 144, netArrear: 1056 };
assertEq(mirroredArrearValue(row, "daArrearsPaid"), 1000, "DA mirror follows unpaid edit");
assertEq(mirroredArrearValue(row, "transportArrearsPaid"), 200, "TR mirror follows unpaid edit");
assertEq(mirroredArrearValue(row, "grossArrear"), 1200, "Gross mirror follows unpaid edit");
assertEq(mirroredArrearValue(row, "cpfArrear"), 144, "CPF mirror follows unpaid edit");
assertEq(mirroredArrearValue(row, "netArrear"), 1056, "Net mirror follows unpaid edit");
assertEq(resolveUnpaidArrears(row).grossArrear, 1200, "unpaid section reads same value");

// 2. Only the five statutory lines are read-only mirrors; everything else (incl. Past Arrears) stays editable.
for (const k of ["daArrearsPaid", "transportArrearsPaid", "grossArrear", "netArrear", "cpfArrear"]) {
  assertEq(isMirroredArrearKey(k), true, `${k} is a mirror`);
}
for (const k of ["past_arrears", "arrears", "basicPaid", "encashmentPaid"]) assertEq(isMirroredArrearKey(k), false, `${k} not a mirror`);
assertEq(isCustomEarningVisibleOnRow("past_arrears", 0), true, "Past Arrears always shown");
assertEq(isCustomEarningVisibleOnRow("hor", 0), true, "other custom fields always shown");

// 3. Generic Arrears box: hidden at 0, shown when non-zero.
assertEq(isCustomEarningVisibleOnRow("arrears", 0), false, "generic Arrears hidden at 0");
assertEq(isCustomEarningVisibleOnRow("arrears", 22636), true, "generic Arrears shown when non-zero");
assertEq(isCustomEarningVisibleOnRow("arrears", -50), true, "generic Arrears shown when negative");

// 4. The table renders mirrors without any write path to onUpdate.
const src = readFileSync(new URL("../components/payroll/GovernmentRunPreviewTable.tsx", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const mirrorBlocks = src.split("<FieldChip").filter((b) => b.includes("mirrorHint={ARREAR_MIRROR_HINT}"));
assertEq(mirrorBlocks.length, 1, "one ARREAR_MIRROR_HINT chip site (earnings); DA CPF has its own from-Arrears chip");
for (const b of mirrorBlocks) {
  const head = b.slice(0, b.indexOf("/>"));
  assertEq(head.includes("onUpdate"), false, "mirror chip never calls onUpdate");
  assertEq(head.includes("readOnly\n"), true, "mirror chip is read-only");
}
assertEq(ARREAR_MIRROR_HINT, "edit in Arrears (Unpaid)", "hint text");
assertEq(src.includes("ArrearsUnpaidSection"), true, "unpaid section kept");

// 5. gross - deductions = net with arrears entered in the unpaid section.
const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr: GovRecalcPayload = {
  grossBasic: 30000, daPercent: 50, hraPercent: 30, medicalFixed: 0, payLevel: 10, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
};
const base = runGovernmentPayrollCompute(gr, {
  daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null,
}).comp as unknown as Record<string, number>;
const withArrears = applyAutoArrearsToGovernmentMonthly(base, {
  daArrear: 1000, transportArrear: 200, grossArrear: 1200, cpfArrear: 144, netArrear: 1056,
}) as Record<string, number>;
const sheet = recalculateGovernmentSheetTotals(withArrears) as Record<string, number>;
for (const t of [withArrears, sheet]) {
  assertEq(t.totalEarnings - t.totalDeductions, t.netSalary, "gross - deductions = net");
}
assertEq(withArrears.totalEarnings, base.totalEarnings + 1200, "gross counts arrears once");
assertEq(withArrears.totalDeductions, base.totalDeductions + 144, "deductions count CPF arrear once");

console.log("payrollRunArrearMirror.test.ts: all tests passed");
