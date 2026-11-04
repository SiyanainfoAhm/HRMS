/**
 * The Run Payroll row calculation, shared by the screen and by scripts that must produce exactly the row the screen
 * would save (payroll:apply-leave-lines). Moved out of the payroll page unchanged.
 */
import { roundMoney, sumMoney } from "./money";
import type { GovernmentDeductionDefaults, GovernmentMonthlyComputed } from "./governmentPayroll";
import type { GovernmentPreviewMonthly } from "../components/payroll/GovernmentRunPreviewTable";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
import { applyFrozenSheetOverridesToComputed, recalculateGovernmentSheetTotals } from "./runPayrollSheetEdit";
import { isSamePayrollReferencePeriod, referenceSalaryFromGovRecalc } from "./hplEolDeductions";
import { applyAutoArrearsToGovernmentMonthly, arrearChain } from "./payrollArrearCalc";
import type { PayrollConfig, PayrollFieldDefinition } from "./payrollFieldTypes";
import type { TransportAllowanceSettings } from "./transportAllowanceSettings";

export type GovMonthlyWithArrear = ReturnType<
  typeof applyAutoArrearsToGovernmentMonthly<GovernmentMonthlyComputed>
>;

export function governmentRowFromCompute<T extends {
  employeeUserId: string;
  payDays: number;
  incentive?: number;
  prBonus?: number;
  reimbursement?: number;
  governmentMonthly?: unknown;
  daArrear?: number;
  transportArrear?: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
}>(
  row: T,
  gr: GovRecalcPayload,
  comp: GovMonthlyWithArrear,
  capped: number,
  unpaidDays: number,
  incentiveBase: T,
  arrear?: ReturnType<typeof arrearSnapshotFromRow>,
  payrollFieldDefs?: PayrollFieldDefinition[],
) {
  // Re-apply frozen sheet overrides after any full compute (days / EOL / HPL workflow).
  const computedGm = applyFrozenSheetOverridesToComputed(
    gr,
    comp as unknown as Record<string, unknown>,
    payrollFieldDefs,
  );
  // Side-panel payment lines are real payable components. Keep their named
  // values inside the monthly sheet before deriving Gross/Deductions/Net.
  const gm = recalculateGovernmentSheetTotals(
    {
      ...computedGm,
      incentive: Number(incentiveBase.incentive) || 0,
      prBonus: Number(incentiveBase.prBonus) || 0,
      reimbursement: Number(incentiveBase.reimbursement) || 0,
    },
    payrollFieldDefs,
  );
  const totalEarnings = Number(gm.totalEarnings ?? comp.totalEarnings) || 0;
  const totalDeductions = Number(gm.totalDeductions ?? comp.totalDeductions) || 0;
  const netSalary = Number(gm.netSalary ?? comp.netSalary) || 0;
  const ded = (gm.deductions ?? comp.deductions) as GovernmentDeductionDefaults;
  const rowDaArrear = arrear?.daArrear ?? (Number(gm.daArrearsPaid ?? comp.daArrearsPaid) || 0);
  const rowTrArrear = arrear?.transportArrear ?? (Number(gm.transportArrearsPaid ?? comp.transportArrearsPaid) || 0);
  const rowCpfArrear = arrear?.cpfArrear ?? (Number(gm.cpfArrear ?? comp.cpfArrear) || 0);
  const rowArrearChain = arrearChain(rowDaArrear, rowTrArrear, rowCpfArrear);

  return {
    ...row,
    govRecalc: gr,
    payDays: capped,
    unpaidLeaveDays: unpaidDays,
    governmentMonthly: {
      ...gm,
      leaveRemarks: gr.leaveRemarks ?? (row.governmentMonthly as { leaveRemarks?: string | null } | null | undefined)?.leaveRemarks ?? null,
    },
    daArrear: rowDaArrear,
    transportArrear: rowTrArrear,
    grossArrear: rowArrearChain.grossArrear,
    cpfArrear: rowCpfArrear,
    netArrear: rowArrearChain.netArrear,
    grossPay: totalEarnings,
    deductions: totalDeductions,
    netPay: netSalary,
    tds: ded.incomeTax,
    profTax: ded.pt,
    pfEmployee: sumMoney(ded.cpf, ded.daCpf, ded.vpf),
    pfEmployer: 0,
    esicEmployee: 0,
    esicEmployer: 0,
    takeHome: roundMoney(netSalary),
  };
}

export function applyGovernmentPayrollRowCompute(
  row: { governmentMonthly?: unknown; daArrear?: number; transportArrear?: number; grossArrear?: number; cpfArrear?: number; netArrear?: number },
  gr: GovRecalcPayload,
  payDaysVal: number,
  opts: {
    daysInMonth: number;
    runYear: number;
    runMonth: number;
    payrollConfig?: PayrollConfig | null;
    arrearOverride?: ReturnType<typeof arrearSnapshotFromRow>;
    transportSettings?: TransportAllowanceSettings;
  },
) {
  const dim = Math.max(1, Math.floor(opts.daysInMonth));
  const arrear = opts.arrearOverride ?? arrearSnapshotFromRow(row);
  const { comp, capped, unpaidDays } = runGovernmentPayrollCompute(gr, {
    transportArrear: arrear.transportArrear,
    daysInMonth: dim,
    payDays: payDaysVal,
    payrollConfig: opts.payrollConfig,
    runYear: opts.runYear,
    runMonth: opts.runMonth,
    governmentMonthly: (row.governmentMonthly as Record<string, unknown> | null) ?? null,
    transportSettings: opts.transportSettings,
  });
  const withArrear = applyAutoArrearsToGovernmentMonthly(
    comp,
    opts.arrearOverride ?? arrearSnapshotFromRow(row),
  );
  return { comp: withArrear, capped, unpaidDays };
}

export function ensureReferenceSalariesForRecompute(
  gr: GovRecalcPayload,
  runYear: number,
  runMonth: number,
): GovRecalcPayload {
  const eolRefM = gr.eolReferenceMonth ?? runMonth;
  const eolRefY = gr.eolReferenceYear ?? runYear;
  const hplRefM = gr.hplReferenceMonth ?? runMonth;
  const hplRefY = gr.hplReferenceYear ?? runYear;
  let next = { ...gr };
  if (isSamePayrollReferencePeriod(eolRefM, eolRefY, runMonth, runYear)) {
    next = {
      ...next,
      eolReferenceSalary: referenceSalaryFromGovRecalc(gr),
      eolReferenceWarning: undefined,
    };
  }
  if (isSamePayrollReferencePeriod(hplRefM, hplRefY, runMonth, runYear)) {
    next = {
      ...next,
      hplReferenceSalary: referenceSalaryFromGovRecalc(gr),
      hplReferenceWarning: undefined,
    };
  }
  return next;
}

export function arrearSnapshotFromRow(row: {
  daArrear?: number;
  transportArrear?: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
  governmentMonthly?: GovernmentPreviewMonthly | GovMonthlyWithArrear | null | unknown;
}) {
  const g = row.governmentMonthly as GovernmentPreviewMonthly | GovMonthlyWithArrear | null | undefined;
  const daArrear = roundMoney(Number(row.daArrear ?? g?.daArrearsPaid ?? 0) || 0);
  const transportArrear = roundMoney(Number(row.transportArrear ?? g?.transportArrearsPaid ?? 0) || 0);
  const cpfArrear = roundMoney(Number(row.cpfArrear ?? g?.cpfArrear ?? 0) || 0);
  return { daArrear, transportArrear, cpfArrear, ...arrearChain(daArrear, transportArrear, cpfArrear) };
}
