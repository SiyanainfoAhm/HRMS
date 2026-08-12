/**
 * Run: npx --yes tsx src/lib/payrollMasterLiveTotals.test.ts
 */
import {
  calculatePayrollMasterSummary,
  computePayrollMasterPreview,
} from "./payrollMasterCalc";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const base = {
  payLevel: "10",
  grossBasicPay: "34590",
  daPercent: "53",
  hraPercent: "30",
  medical: "3000",
  daAmount: "22743",
  hraAmount: "10830",
  transportBase: "0",
  transportDa: "0",
  transportTotal: "10",
  professionalTax: "200",
  incomeTax: "0",
  lic: "0",
  mess: "0",
  welfare: "0",
  vpf: "0",
  pfLoan: "0",
  postOffice: "0",
  creditSociety: "0",
  electricity: "0",
  water: "0",
  loanRecovery: "0",
  otherDeduction: "0",
  advance: "0",
  cpfDefault: "0",
  cpfUseCompanySettings: true as boolean,
  companyCpfPercentage: 12,
  companyCpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
  companyCpfCalculationMode: "percentage" as const,
  companyCpfFixedAmount: 0,
};

const expectedEarningsWithTransport10 = 34590 + 22743 + 10830 + 3000 + 10;

// Stale stored total must NOT win over derived components
const stale = computePayrollMasterPreview({
  ...base,
  totalEarnings: "78541",
  useStoredTotalEarnings: false,
});
assertEq(stale.totalEarnings, expectedEarningsWithTransport10, "TEST live total ignores stale 78541");
assertEq(stale.transportTotal, 10, "transport effective 10");

// TEST 7/8 — transport change / 0
let s = calculatePayrollMasterSummary({ ...base, transportTotal: "10" });
assertEq(s.totalEarnings, expectedEarningsWithTransport10, "TEST7 transport 10");
s = calculatePayrollMasterSummary({ ...base, transportTotal: "0" });
assertEq(s.totalEarnings, expectedEarningsWithTransport10 - 10, "TEST8 transport 0 drops 10");
assertEq(s.transportTotal, 0, "TEST8 transport total 0");

// Empty transport while editing must not snap to slab
s = calculatePayrollMasterSummary({ ...base, transportTotal: "" });
assertEq(s.transportTotal, 0, "empty transport → 0 not slab");

// TEST 1/2 — basic
s = calculatePayrollMasterSummary({ ...base, grossBasicPay: "20000", daAmount: "0", hraAmount: "0", medical: "0", transportTotal: "0" });
assertEq(s.totalEarnings, 20000, "TEST1 basic change");
s = calculatePayrollMasterSummary({ ...base, grossBasicPay: "0", daAmount: "0", hraAmount: "0", medical: "0", transportTotal: "0" });
assertEq(s.totalEarnings, 0, "TEST2 basic 0");

// TEST 3/4 — DA
s = calculatePayrollMasterSummary({ ...base, daAmount: "1000" });
assertEq(s.totalEarnings, 34590 + 1000 + 10830 + 3000 + 10, "TEST3 DA change");
s = calculatePayrollMasterSummary({ ...base, daAmount: "0" });
assertEq(s.totalEarnings, 34590 + 0 + 10830 + 3000 + 10, "TEST4 DA 0");

// TEST 5/6 — HRA / Medical
s = calculatePayrollMasterSummary({ ...base, hraAmount: "5000" });
assertEq(s.totalEarnings, 34590 + 22743 + 5000 + 3000 + 10, "TEST5 HRA");
s = calculatePayrollMasterSummary({ ...base, medical: "0" });
assertEq(s.totalEarnings, expectedEarningsWithTransport10 - 3000, "TEST6 medical 0");
s = calculatePayrollMasterSummary({ ...base, medical: "" });
assertEq(s.totalEarnings, expectedEarningsWithTransport10 - 3000, "empty medical → 0 live, not DEFAULT");

// Custom earning
s = calculatePayrollMasterSummary({
  ...base,
  customEarnings: { special_pay: 500 },
  payrollFieldDefs: [
    {
      id: "1",
      fieldKey: "special_pay",
      fieldLabel: "SP",
      fieldGroup: "earnings",
      fieldType: "number",
      calculationType: "manual_entry",
      isRequired: false,
      isActive: true,
      isSystem: false,
      showInPayrollMaster: true,
      showInRunPayroll: true,
      showInSalarySlip: true,
      includeInTotalEarnings: true,
      includeInTotalDeductions: false,
      displayOrder: 1,
    },
  ],
});
assertEq(s.totalEarnings, expectedEarningsWithTransport10 + 500, "TEST9 custom earning");

const withCustomDed = calculatePayrollMasterSummary({
  ...base,
  professionalTax: "0",
  cpfUseCompanySettings: false,
  cpfCalculationModeOverride: "fixed_amount",
  cpfFixedAmountOverride: "0",
  customDeductions: { misc_ded: 150 },
  payrollFieldDefs: [
    {
      id: "2",
      fieldKey: "misc_ded",
      fieldLabel: "Misc",
      fieldGroup: "deductions",
      fieldType: "number",
      calculationType: "manual_entry",
      isRequired: false,
      isActive: true,
      isSystem: false,
      showInPayrollMaster: true,
      showInRunPayroll: true,
      showInSalarySlip: true,
      includeInTotalEarnings: false,
      includeInTotalDeductions: true,
      displayOrder: 2,
    },
  ],
});
assertEq(withCustomDed.totalDeductions, 150, "TEST15 custom deduction");

// TEST 10/11 — CPF fixed 0
s = calculatePayrollMasterSummary({
  ...base,
  cpfUseCompanySettings: false,
  cpfCalculationModeOverride: "fixed_amount",
  cpfFixedAmountOverride: "0",
  cpfPercentageOverride: "12",
  cpfBasisFieldKeysOverride: ["gross_basic"],
});
assertEq(s.cpfEffective, 0, "TEST11 CPF fixed 0");
assert(s.totalDeductions >= 200, "deductions include PT");
const takeWithCpf0 = s.takeHome;

s = calculatePayrollMasterSummary({
  ...base,
  cpfUseCompanySettings: false,
  cpfCalculationModeOverride: "fixed_amount",
  cpfFixedAmountOverride: "8722",
  cpfPercentageOverride: "12",
  cpfBasisFieldKeysOverride: ["gross_basic"],
});
assertEq(s.cpfEffective, 8722, "TEST10 CPF 8722");
assertEq(s.takeHome, takeWithCpf0 - 8722, "TEST16/17 take-home moves with CPF");

// TEST 12/13 — PT
const withPt = calculatePayrollMasterSummary({ ...base, professionalTax: "200", cpfUseCompanySettings: false, cpfCalculationModeOverride: "fixed_amount", cpfFixedAmountOverride: "0" });
const noPt = calculatePayrollMasterSummary({ ...base, professionalTax: "0", cpfUseCompanySettings: false, cpfCalculationModeOverride: "fixed_amount", cpfFixedAmountOverride: "0" });
assertEq(withPt.totalDeductions - noPt.totalDeductions, 200, "TEST12 PT in deductions");
assertEq(noPt.takeHome - withPt.takeHome, 200, "TEST13 PT 0 increases take home");

// TEST 14 — LIC etc.
const withLic = calculatePayrollMasterSummary({
  ...base,
  lic: "500",
  cpfUseCompanySettings: false,
  cpfCalculationModeOverride: "fixed_amount",
  cpfFixedAmountOverride: "0",
  professionalTax: "0",
});
const noLic = calculatePayrollMasterSummary({
  ...base,
  lic: "0",
  cpfUseCompanySettings: false,
  cpfCalculationModeOverride: "fixed_amount",
  cpfFixedAmountOverride: "0",
  professionalTax: "0",
});
assertEq(withLic.totalDeductions - noLic.totalDeductions, 500, "TEST14 LIC");

// Optional stored total override still works when opted in
const override = computePayrollMasterPreview({
  ...base,
  totalEarnings: "99999",
  useStoredTotalEarnings: true,
});
assertEq(override.totalEarnings, 99999, "opt-in stored total override");

console.log("payrollMasterLiveTotals.test.ts: all tests passed");
