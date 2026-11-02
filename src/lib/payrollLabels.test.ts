/**
 * Run: npx --yes tsx src/lib/payrollLabels.test.ts
 *
 * CIRT-05/06/07: one label source for the arrears family, a CPF Arr line and a
 * Net Arrears line in the preview, Net Arrears derived (never a stored 0).
 */
import { readFileSync } from "node:fs";
import { PAYROLL_LABELS } from "./payrollLabels";
import { applyAutoArrearsToGovernmentMonthly } from "./payrollArrearCalc";
import { governmentPayslipDeductionPairs, governmentPayslipEarningPairs } from "./governmentPayslipLayout";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// 1. TS and PHP label sources agree.
const php = readFileSync(new URL("../../backend/app/Support/PayrollLabels.php", import.meta.url), "utf8");
const phpConst = (name: string) => php.match(new RegExp(`const ${name} = '([^']+)'`))?.[1];
assertEq(phpConst("DA_ARREARS"), PAYROLL_LABELS.daArrears, "DA label");
assertEq(phpConst("TRANSPORT_ARREARS"), PAYROLL_LABELS.transportArrears, "TR label");
assertEq(phpConst("GROSS_ARREARS"), PAYROLL_LABELS.grossArrears, "Gross label");
assertEq(phpConst("PAST_ARREARS"), PAYROLL_LABELS.pastArrears, "Past label");
assertEq(phpConst("NET_ARREARS"), PAYROLL_LABELS.netArrears, "Net label");
assertEq(phpConst("CPF_ARREARS"), PAYROLL_LABELS.cpfArrears, "CPF Arr label");
assertEq(phpConst("PAST_ARREARS_FIELD_KEY"), PAYROLL_LABELS.pastArrearsFieldKey, "Past key");

// 2. Net Arrears is derived: a defaulted 0 next to a positive gross is not kept (Sept 2026 emp 037: gross 22636, net 0).
const comp = { totalEarnings: 91785, totalDeductions: 15395, netSalary: 76390 };
const out = applyAutoArrearsToGovernmentMonthly(comp, { grossArrear: 22636, cpfArrear: 0, netArrear: 0 });
assertEq(out.netArrear, 22636, "net arrear derived from gross - cpf");
const out2 = applyAutoArrearsToGovernmentMonthly(comp, { grossArrear: 1200, cpfArrear: 144, netArrear: 999 });
assertEq(out2.netArrear, 1056, "stale net arrear replaced by gross - cpf");
assertEq(out2.cpfArrear, 144, "cpf arr kept");
// CPF Arr is a deduction, Net Arrears never changes totals.
assertEq(out2.totalDeductions, 15395 + 144, "cpf arr added to deductions once");

// 3. Payslip uses the shared labels.
const gov = { gross_arrear: 500, da_arrears_paid: 100, transport_arrears_paid: 50, cpf_arrear: 60 } as never;
const earn = Object.fromEntries(governmentPayslipEarningPairs(gov));
const ded = Object.fromEntries(governmentPayslipDeductionPairs(gov));
assertEq(earn[PAYROLL_LABELS.daArrears], 100, "payslip DA Arrears");
assertEq(earn[PAYROLL_LABELS.transportArrears], 50, "payslip TR Arrears");
assertEq(earn[PAYROLL_LABELS.grossArrears], 350, "payslip Gross Arrears shows the remainder so lines add to gross");
assertEq(ded[PAYROLL_LABELS.cpfArrears], 60, "payslip CPF Arr");

// 4. Preview lists carry CPF Arr (deduction) and Net Arrears (earnings, memo) and route arrear edits.
const shared = readFileSync(new URL("../components/payroll/payrollRunPreviewShared.tsx", import.meta.url), "utf8");
for (const needle of ["PAYROLL_LABELS.grossArrears", "PAYROLL_LABELS.netArrears", "PAYROLL_LABELS.cpfArrears", 'arrearField: "grossArrear"', "memo: true"]) {
  if (!shared.includes(needle)) throw new Error(`preview list missing ${needle}`);
}

console.log("payrollLabels.test.ts passed");
