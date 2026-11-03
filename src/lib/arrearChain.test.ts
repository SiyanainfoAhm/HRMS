/**
 * Run: npx --yes tsx src/lib/arrearChain.test.ts
 *
 * The arrears chain: DA, TR and CPF Arrears are the inputs; Gross Arrears = DA + TR and Net Arrears = Gross -
 * CPF Arrears are derived and read-only. Gross (earnings) holds DA and TR arrears once, Total Deductions holds
 * CPF Arr once, Net Pay = Gross - Total Deductions, so Net Arrears is a memo. PHP mirror:
 * backend/tests/Unit/ArrearChainTest.php (same fixture).
 */
import { readFileSync } from "node:fs";
import { applyGovernmentSheetMonetaryEdit, type GovernmentSheetRow } from "./runPayrollSheetEdit";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { applyAutoArrearsToGovernmentMonthly, arrearChain, totalArrearsPaid } from "./payrollArrearCalc";
import { mirroredArrearValue, resolveUnpaidArrears } from "./payrollRunArrearMirror";
import { deserializePayrollDraftEmployee, sumResolvedPayrollTotals } from "./deserializePayrollDraftEmployee";
import { governmentPayslipDeductionPairs, governmentPayslipEarningPairs } from "./governmentPayslipLayout";
import { buildPayrollExcelRow } from "./payrollExcelExport";
import { sumMoney } from "./money";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// 1. The shared fixture, zero tolerance.
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/arrear_chain_cases.json", import.meta.url), "utf8")) as {
  cases: Array<{ da: number; tr: number; cpf: number; grossArrear: number; netArrear: number }>;
};
for (const c of fixture.cases) {
  const r = arrearChain(c.da, c.tr, c.cpf);
  assertEq(r.grossArrear, c.grossArrear, `gross for ${c.da}+${c.tr}`);
  assertEq(r.netArrear, c.netArrear, `net for ${c.da}+${c.tr}-${c.cpf}`);
}
assertEq(totalArrearsPaid(1000, 200, 99999), 1200, "total arrears = DA + TR whatever gross says");

// 2. A row, computed like the Run Payroll screen does.
const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0,
  vehCharge: 0, other: 0, quarterRent: 0,
};
const gr: GovRecalcPayload = {
  grossBasic: 34590, daPercent: 53, hraPercent: 30, medicalFixed: 3000, payLevel: 10, deductionDefaults: ded,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
};
const comp = runGovernmentPayrollCompute(gr, { daysInMonth: 30, payDays: 30, runYear: 2026, runMonth: 9, payrollConfig: null, governmentMonthly: null })
  .comp as unknown as Record<string, number>;
const fresh = (): GovernmentSheetRow => ({
  employeeUserId: "emp-a", payDays: 30, grossPay: comp.totalEarnings, deductions: comp.totalDeductions, netPay: comp.netSalary,
  takeHome: comp.netSalary, governmentMonthly: { ...comp } as never, govRecalc: gr,
  daArrear: 0, transportArrear: 0, grossArrear: 0, cpfArrear: 0, netArrear: 0,
});
const base = fresh();
const gmOf = (r: GovernmentSheetRow) => r.governmentMonthly as unknown as Record<string, number>;

type Snapshot = { gross: number; net: number; ded: number; earn: number };
const state = (r: GovernmentSheetRow): Snapshot & ReturnType<typeof resolveUnpaidArrears> => {
  const g = gmOf(r);
  return { ...resolveUnpaidArrears(r as never), earn: g.totalEarnings, ded: g.totalDeductions, gross: r.grossPay, net: r.netPay };
};
function checkRow(r: GovernmentSheetRow, da: number, tr: number, cpf: number, label: string) {
  const s = state(r);
  assertEq(s.daArrear, da, `${label}: DA arrear`);
  assertEq(s.trArrear, tr, `${label}: TR arrear`);
  assertEq(s.cpfArrear, cpf, `${label}: CPF arrear`);
  assertEq(s.grossArrear, da + tr, `${label}: Gross Arrears = DA + TR`);
  assertEq(s.netArrear, da + tr - cpf, `${label}: Net Arrears = Gross - CPF Arr`);
  assertEq(r.grossArrear, da + tr, `${label}: stored row gross arrears`);
  assertEq(r.netArrear, da + tr - cpf, `${label}: stored row net arrears`);
  assertEq(gmOf(r).grossArrear, da + tr, `${label}: monthly gross arrears`);
  assertEq(gmOf(r).netArrear, da + tr - cpf, `${label}: monthly net arrears`);
  // Earnings mirrors (read-only) follow the same single source.
  assertEq(mirroredArrearValue(r as never, "grossArrear"), da + tr, `${label}: Earnings mirror gross`);
  assertEq(mirroredArrearValue(r as never, "netArrear"), da + tr - cpf, `${label}: Earnings mirror net`);
  assertEq(mirroredArrearValue(r as never, "cpfArrear"), cpf, `${label}: Deductions mirror CPF Arr`);
  // Totals: DA and TR once in Gross, CPF Arr once in Total Deductions, Net Pay = Gross - Total Deductions.
  assertEq(s.earn, base.grossPay + da + tr, `${label}: Gross holds DA + TR arrears once`);
  assertEq(s.ded, base.deductions + cpf, `${label}: Total Deductions holds CPF Arr once`);
  assertEq(r.netPay, s.earn - s.ded, `${label}: Net Pay = Gross - Total Deductions`);
  assertEq(r.netPay, base.netPay + (da + tr) - cpf, `${label}: Net Pay moved by Gross Arrears - CPF Arr (net arrears is a memo)`);
  assertEq(r.grossPay, s.earn, `${label}: row gross is Gross`);
  assertEq(r.deductions, s.ded, `${label}: row deductions`);
}

// Change DA, then TR, then CPF Arr, each separately, on the live screen logic.
let row = applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 1923);
checkRow(row, 1923, 0, 0, "DA only");
row = applyGovernmentSheetMonetaryEdit(row, "transportArrear", 100);
checkRow(row, 1923, 100, 0, "then TR");
row = applyGovernmentSheetMonetaryEdit(row, "cpfArrear", 243);
checkRow(row, 1923, 100, 243, "then CPF Arr");
row = applyGovernmentSheetMonetaryEdit(row, "daArrear", 2000);
checkRow(row, 2000, 100, 243, "DA changed again: gross and net both move");
row = applyGovernmentSheetMonetaryEdit(row, "cpfArrear", 0);
checkRow(row, 2000, 100, 0, "CPF Arr cleared: net follows");
// Typing Gross or Net Arrears is not possible (ignored).
assertEq(applyGovernmentSheetMonetaryEdit(row, "grossArrear", 7), row, "gross arrears is read-only");
assertEq(applyGovernmentSheetMonetaryEdit(row, "netArrear", 7), row, "net arrears is read-only");
// Zero and large values; paise are rounded to the rupee.
checkRow(applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 0), 0, 0, 0, "all zero");
checkRow(applyGovernmentSheetMonetaryEdit(applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 100000000), "transportArrear", 50000000), 100000000, 50000000, 0, "large values");
checkRow(applyGovernmentSheetMonetaryEdit(applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 1000.5), "cpfArrear", 144.09), 1001, 0, 144, "paise rounded");
// CPF Arr larger than gross: net arrears goes negative (a memo), net pay still = gross - deductions.
checkRow(applyGovernmentSheetMonetaryEdit(applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 100), "cpfArrear", 300), 100, 0, 300, "CPF Arr above gross");

// 3. Recompute through the compute engine (Generate payroll path) gives the same figures.
const gen = applyAutoArrearsToGovernmentMonthly(comp, { daArrear: 2000, transportArrear: 100, cpfArrear: 243, grossArrear: 99999, netArrear: 99999 });
assertEq(gen.grossArrear, 2100, "generate: a passed-in gross is ignored");
assertEq(gen.netArrear, 1857, "generate: net arrears = gross - CPF Arr");
assertEq(gen.totalEarnings, comp.totalEarnings + 2100, "generate: gross holds arrears once");
assertEq(gen.totalDeductions, comp.totalDeductions + 243, "generate: deductions hold CPF Arr once");
assertEq(gen.netSalary, comp.netSalary + 2100 - 243, "generate: net pay");
const again = applyAutoArrearsToGovernmentMonthly(gen, { daArrear: 2000, transportArrear: 100, cpfArrear: 243 });
assertEq(again.totalEarnings, gen.totalEarnings, "idempotent: arrears are never counted twice");
assertEq(again.netSalary, gen.netSalary, "idempotent net");

// 4. Save / reload: the reloaded draft shows the same chain and totals; header chips are exact sums.
const edited = applyGovernmentSheetMonetaryEdit(applyGovernmentSheetMonetaryEdit(applyGovernmentSheetMonetaryEdit(fresh(), "daArrear", 2000), "transportArrear", 100), "cpfArrear", 243);
const reloaded = deserializePayrollDraftEmployee(
  { employeeUserId: "u", rowPayload: JSON.parse(JSON.stringify(edited)) } as never,
  { employeeUserId: "u", payrollMode: "government" } as never,
) as unknown as GovernmentSheetRow;
const rg = reloaded.governmentMonthly as unknown as Record<string, number>;
assertEq(rg.grossArrear, 2100, "reload: gross arrears");
assertEq(rg.netArrear, 1857, "reload: net arrears");
assertEq(rg.totalEarnings, edited.grossPay, "reload: gross");
assertEq(rg.netSalary, edited.netPay, "reload: net pay");
const totals = sumResolvedPayrollTotals([{ governmentMonthly: rg, daArrear: 2000, transportArrear: 100, grossArrear: 2100 }] as Array<Record<string, unknown>>);
assertEq(totals.arrears, 2100, "header chip: total arrears = gross arrears");

// 5. Payslip and Excel (saved-row shapes) show the same chain and add up.
const slip: Record<string, number> = {
  basic_paid: rg.basicPaid, da_paid: rg.daPaid, transport_paid: rg.transportPaid, hra_paid: rg.hraPaid, medical_paid: rg.medicalPaid,
  da_arrears_paid: 2000, transport_arrears_paid: 100, gross_arrear: 2100, cpf_arrear: 243, net_arrear: 1857,
  cpf_amount: rg.deductions ? (rg.deductions as unknown as Record<string, number>).cpf : 0,
  pt_amount: 200, total_earnings: rg.totalEarnings, total_deductions: rg.totalDeductions, net_salary: rg.netSalary,
};
const earningPairs = governmentPayslipEarningPairs(slip);
const deductionPairs = governmentPayslipDeductionPairs(slip);
const pair = (pairs: [string, number][], label: string) => pairs.find(([l]) => l === label)?.[1];
assertEq(pair(earningPairs, "DA Arrears"), 2000, "payslip DA arrears");
assertEq(pair(earningPairs, "TR Arrears"), 100, "payslip TR arrears");
assertEq(pair(earningPairs, "Gross Arrears"), 0, "payslip: Gross Arrears is not printed again on top of its two lines");
assertEq(pair(deductionPairs, "CPF Arr"), 243, "payslip CPF arrears");
assertEq(sumMoney(...earningPairs.map(([, v]) => v)), rg.totalEarnings, "payslip earning lines add up to Gross");
assertEq(rg.totalEarnings - rg.totalDeductions, rg.netSalary, "payslip: gross - deductions = net pay");
const excel = buildPayrollExcelRow({ payroll_mode: "government", employee_user_id: "u" }, "Emp", { kind: "row", row: slip as never });
assertEq(excel["DAArrears"], 2000, "excel DA arrears");
assertEq(excel["TransportArrears"], 100, "excel TR arrears");
assertEq(excel["GrossArrears"], 2100, "excel gross arrears");
assertEq(excel["Net Arrears"] ?? excel["NetArrears"], 1857, "excel net arrears");

console.log("arrearChain.test.ts passed");
