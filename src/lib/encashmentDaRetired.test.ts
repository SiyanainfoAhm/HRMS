/**
 * Run: npx --yes tsx src/lib/encashmentDaRetired.test.ts
 *
 * Encashment DA (ENC. DA) is retired from Run Payroll: no input, nothing can set it. ENCASH. stays. A value already saved on
 * a row (an older generated month, or an open draft that held one) keeps counting in its totals, payslip and exports, so
 * history is identical; a row with ENC. DA = 0 adds up exactly as before.
 */
import * as XLSX from "xlsx-js-style";
import { GOV_PREVIEW_EARNING_FIELDS } from "../components/payroll/payrollRunPreviewShared";
import { governmentPayslipEarningPairs } from "./governmentPayslipLayout";
import {
  applyGovernmentSheetMonetaryEdit,
  isGovernmentSheetMonetaryField,
  recalculateGovernmentSheetTotals,
  RETIRED_EARNING_KEYS,
  SHEET_EARNING_KEYS,
  type GovernmentSheetRow,
} from "./runPayrollSheetEdit";
import { buildEmployeeDetailSheet, type PayrollRunExportRow } from "./payrollRunWorkbook";
import { buildPayrollExcelHeaders } from "./payrollExcelExport";
import { roundMoney } from "./money";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const ded = { incomeTax: 0, pt: 200, lic: 0, cpf: 4151, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0, vehCharge: 0, other: 0, quarterRent: 0 };

function gmWith(encashment: number, encashmentDa: number) {
  const earnings = 34590 + 5760 + 25830 + 3000 + encashment + encashmentDa;
  const deductions = 4151 + 200;
  return {
    basicPaid: 34590, daPaid: 0, transportPaid: 5760, hraPaid: 25830, medicalPaid: 3000, extraWorkAllowancePaid: 0, nightAllowancePaid: 0,
    uniformAllowancePaid: 0, educationAllowancePaid: 0, daArrearsPaid: 0, transportArrearsPaid: 0, encashmentPaid: encashment, encashmentDaPaid: encashmentDa,
    customEarnings: {}, customDeductions: {}, deductions: { ...ded }, totalEarnings: earnings, totalDeductions: deductions, netSalary: earnings - deductions,
  };
}

function rowWith(encashment: number, encashmentDa: number): GovernmentSheetRow {
  const gm = gmWith(encashment, encashmentDa);
  return {
    employeeUserId: "emp-a", payDays: 30, grossPay: gm.totalEarnings, deductions: gm.totalDeductions, netPay: gm.netSalary, takeHome: gm.netSalary,
    governmentMonthly: gm,
    govRecalc: { grossBasic: 34590, daPercent: 53, hraPercent: 30, medicalFixed: 3000, payLevel: 10, deductionDefaults: { ...ded } },
    daArrear: 0, transportArrear: 0, grossArrear: 0, cpfArrear: 0, netArrear: 0,
  } as unknown as GovernmentSheetRow;
}

// 1. The screen: no ENC. DA input; ENCASH. stays.
const labels = GOV_PREVIEW_EARNING_FIELDS.map((f) => f.label);
assertEq(labels.includes("Enc. DA"), false, "no Enc. DA field on the Earnings row");
assertEq(labels.includes("Encash."), true, "Encash. stays");
assertEq(GOV_PREVIEW_EARNING_FIELDS.some((f) => String(f.key) === "encashmentDaPaid"), false, "no encashmentDaPaid input key");

// 2. Nothing can set it any more; ENCASH. can.
assertEq(isGovernmentSheetMonetaryField("govEarning_encashmentDaPaid"), false, "ENC. DA is not an editable sheet field");
assertEq(isGovernmentSheetMonetaryField("govEarning_encashmentPaid"), true, "ENCASH. is");
const typed = applyGovernmentSheetMonetaryEdit(rowWith(0, 0), "govEarning_encashmentDaPaid", 999);
assertEq((typed.governmentMonthly as { encashmentDaPaid: number }).encashmentDaPaid, 0, "an edit of ENC. DA is refused");
assertEq(typed.grossPay, rowWith(0, 0).grossPay, "gross unchanged by the refused edit");
const enc = applyGovernmentSheetMonetaryEdit(rowWith(0, 0), "govEarning_encashmentPaid", 1500);
assertEq((enc.governmentMonthly as { totalEarnings: number }).totalEarnings, 34590 + 5760 + 25830 + 3000 + 1500, "ENCASH. still feeds gross");
assertEq(RETIRED_EARNING_KEYS as readonly string[], ["encashmentDaPaid"], "the retired keys");
assertEq((SHEET_EARNING_KEYS as readonly string[]).includes("encashmentDaPaid"), true, "kept in the totals so older values still count");

// 3. ENC. DA = 0: gross, deductions and net add up exactly as before.
const zero = recalculateGovernmentSheetTotals(gmWith(0, 0) as never);
assertEq([zero.totalEarnings, zero.totalDeductions, zero.netSalary], [69180, 4351, 64829], "totals with ENC. DA = 0");
assertEq(zero.netSalary, roundMoney((zero.totalEarnings as number) - (zero.totalDeductions as number)), "gross - deductions = net (screen)");

// 4. Draft save / reload (JSON round trip) without ENC. DA keeps the totals; the field is not added back.
const saved = JSON.parse(JSON.stringify(rowWith(1500, 0)));
const reloaded = recalculateGovernmentSheetTotals(saved.governmentMonthly as never);
assertEq([reloaded.totalEarnings, reloaded.totalDeductions, reloaded.netSalary], [70680, 4351, 66329], "draft reload totals");
assertEq(JSON.stringify(saved.governmentMonthly), JSON.stringify(JSON.parse(JSON.stringify(saved.governmentMonthly))), "stable round trip");

// 5. An older month / draft that holds ENC. DA still totals the same (value carried, not dropped, not editable).
const legacy = recalculateGovernmentSheetTotals(gmWith(0, 700) as never);
assertEq([legacy.totalEarnings, legacy.totalDeductions, legacy.netSalary], [69880, 4351, 65529], "stored ENC. DA keeps counting");
const legacyEdited = applyGovernmentSheetMonetaryEdit(rowWith(0, 700), "govEarning_basicPaid", 30000);
assertEq((legacyEdited.governmentMonthly as { encashmentDaPaid: number }).encashmentDaPaid, 700, "an unrelated edit does not drop the stored ENC. DA");

// 6. Payslip: the printed earning lines add up to gross, with and without a stored ENC. DA.
function slip(da: number) {
  return {
    basic_paid: 34590, da_paid: 0, transport_paid: 5760, hra_paid: 25830, medical_paid: 3000, extra_work_allowance_paid: 0, night_allowance_paid: 0,
    uniform_allowance_paid: 0, education_allowance_paid: 0, da_arrears_paid: 0, transport_arrears_paid: 0, gross_arrear: 0, encashment_paid: 0, encashment_da_paid: da,
  } as never;
}
for (const da of [0, 700]) {
  const pairs = governmentPayslipEarningPairs(slip(da));
  assertEq(pairs.reduce((s, [, v]) => s + v, 0), 69180 + da, `payslip lines add up to gross (ENC. DA ${da})`);
}

// 7. Excel (Run Payroll workbook): the column stays for older months; gross - deductions = net on every row.
const exportRows = [rowWith(0, 0), { ...rowWith(0, 700), employeeUserId: "emp-b" }].map((r, i) => ({
  employeeUserId: r.employeeUserId, employeeName: `Emp ${i}`, payrollMode: "government", payDays: 30, grossPay: r.grossPay, deductions: r.deductions, netPay: r.netPay,
  governmentMonthly: { ...(r.governmentMonthly as Record<string, unknown>), payLevel: 10 },
})) as unknown as PayrollRunExportRow[];
const sheet = buildEmployeeDetailSheet(exportRows, { month: 9, year: 2026, status: "Draft" });
const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
const hi = grid.findIndex((r) => r.includes("EncashmentDA"));
const head = grid[hi] as string[];
assertEq(head, buildPayrollExcelHeaders([]), "the header row is the shared list (EncashmentDA kept for older months)");
const col = (h: string, r: number) => Number(grid[hi + 1 + r][head.indexOf(h)]);
for (let r = 0; r < 2; r++) {
  assertEq(col("GrossTotal", r) - col("TotalDeductions", r), col("NetSalary", r), `Excel row ${r}: gross - deductions = net`);
}
assertEq([col("EncashmentDA", 0), col("EncashmentDA", 1)], [0, 700], "Excel carries the stored ENC. DA");

// 8. When no row carries an Encashment DA amount (every current payroll), the Excel has no such column at all.
const zeroRows = exportRows.slice(0, 1);
const zeroGrid = XLSX.utils.sheet_to_json<unknown[]>(
  buildEmployeeDetailSheet(zeroRows, { month: 9, year: 2026, status: "Draft" }),
  { header: 1 },
) as unknown[][];
const zeroHead = zeroGrid.find((r) => r.includes("GrossTotal")) as string[];
assertEq(zeroHead.includes("EncashmentDA"), false, "no EncashmentDA column when every row is 0");
assertEq(zeroHead, buildPayrollExcelHeaders([], ["EncashmentDA"]), "the rest of the header row is unchanged");

console.log("encashmentDaRetired.test.ts passed");
