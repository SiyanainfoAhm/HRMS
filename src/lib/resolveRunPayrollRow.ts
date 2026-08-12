/**
 * Resolve a Run Payroll API row into the editable government/private shape.
 * Ensures governmentMonthly is computed when the API returns zero stubs.
 */
import { applyAutoArrearsToGovernmentMonthly } from "@/lib/payrollArrearCalc";
import {
  runGovernmentPayrollCompute,
  defaultGovRecalcReferencePeriod,
  type GovRecalcPayload,
} from "@/lib/govRunPayrollCompute";
import {
  deserializePayrollDraftEmployee,
  normalizeDraftEmployeeApiRow,
  type DraftEmployeeApiRow,
} from "@/lib/deserializePayrollDraftEmployee";
import {
  recalculateGovernmentSheetTotals,
  SHEET_DEDUCTION_KEYS,
  SHEET_EARNING_KEYS,
  applyDeductionPaidOverridesToGm,
  mergeDeductionDefaultsWithPaidOverrides,
} from "@/lib/runPayrollSheetEdit";
import { hasOwn } from "@/lib/effectivePayrollValue";

export type RunPayrollRowLike = Record<string, unknown> & {
  employeeUserId: string;
  payrollMode?: string;
  payDays?: number;
  rawPayDays?: number;
  grossPay?: number;
  netPay?: number;
  deductions?: number;
  governmentMonthly?: unknown;
  govRecalc?: GovRecalcPayload | null;
};

export type ResolveRunPayrollRowContext = {
  denom: number;
  runYear: number;
  runMonth: number;
  payrollConfig: unknown;
  alreadyRun: boolean;
  draftDirty: boolean;
  cached?: RunPayrollRowLike | null;
  draftStored?: DraftEmployeeApiRow | Record<string, unknown> | null;
};

function arrearSnapshotFromRow(row: RunPayrollRowLike) {
  return {
    daArrear: row.daArrear as number | undefined,
    transportArrear: row.transportArrear as number | undefined,
    cpfArrear: row.cpfArrear as number | undefined,
    grossArrear: row.grossArrear as number | undefined,
    netArrear: row.netArrear as number | undefined,
  };
}

function computeGovernmentRow(
  r: RunPayrollRowLike,
  denom: number,
  runYear: number,
  runMonth: number,
  payrollConfig: unknown,
): RunPayrollRowLike {
  const base: RunPayrollRowLike = {
    ...r,
    grossMonthly:
      r.grossMonthly ??
      Math.round((Number(r.grossPay || 0) * denom) / (Number(r.payDays || r.rawPayDays || 1) || 1)),
    grossPay: Number(r.grossPay ?? 0),
    netPay: Number(r.netPay ?? 0),
    pfEmployee: Number(r.pfEmployee ?? 0),
    pfEmployer: Number(r.pfEmployer ?? 0),
    esicEmployee: Number(r.esicEmployee ?? 0),
    esicEmployer: Number(r.esicEmployer ?? 0),
    profTax: Number(r.profTax ?? 0),
    deductions: Number(r.deductions ?? 0),
    takeHome: Number(r.takeHome ?? 0),
    ctc: Number(r.ctc ?? 0),
    incentive: r.incentive ?? 0,
    prBonus: r.prBonus ?? 0,
    reimbursement: r.reimbursement ?? 0,
    tds: r.tds ?? 0,
    ctcBase: r.ctcBase ?? r.ctc,
    payrollMode: r.payrollMode,
    governmentMonthly: r.governmentMonthly ?? null,
    govRecalc: r.govRecalc,
    bankAccountNumber: r.bankAccountNumber ?? null,
    bankName: r.bankName ?? null,
  };

  if (r.payrollMode === "government" && r.govRecalc) {
    const refDefaults = defaultGovRecalcReferencePeriod(runYear, runMonth);
    const gm0 = r.governmentMonthly as Record<string, unknown> | null | undefined;
    base.govRecalc = {
      ...r.govRecalc,
      ...refDefaults,
      hplDays: r.govRecalc.hplDays ?? Number(gm0?.hplDays ?? 0),
      eolDays: r.govRecalc.eolDays ?? Number(gm0?.eolDays ?? 0),
      leaveRemarks:
        r.govRecalc.leaveRemarks ??
        (typeof gm0?.leaveRemarks === "string" ? gm0.leaveRemarks : null) ??
        (typeof gm0?.leave_remarks === "string" ? gm0.leave_remarks : "") ??
        "",
      eolReferenceMonth: r.govRecalc.eolReferenceMonth ?? Number(gm0?.eolReferenceMonth ?? refDefaults.eolReferenceMonth),
      eolReferenceYear: r.govRecalc.eolReferenceYear ?? Number(gm0?.eolReferenceYear ?? refDefaults.eolReferenceYear),
      hplReferenceMonth: r.govRecalc.hplReferenceMonth ?? Number(gm0?.hplReferenceMonth ?? refDefaults.hplReferenceMonth),
      hplReferenceYear: r.govRecalc.hplReferenceYear ?? Number(gm0?.hplReferenceYear ?? refDefaults.hplReferenceYear),
      electricityUnitsConsumed:
        r.govRecalc.electricityUnitsConsumed ?? Number(gm0?.electricityUnitsConsumed ?? 0),
      nightHours: r.govRecalc.nightHours ?? Number(gm0?.nightHours ?? 0),
      nightAllowanceRate: r.govRecalc.nightAllowanceRate ?? Number(gm0?.nightAllowanceRate ?? 0),
      nightAllowanceSlabNo: r.govRecalc.nightAllowanceSlabNo ?? null,
      nightAllowanceWarning:
        r.govRecalc.nightAllowanceWarning ??
        (typeof gm0?.nightAllowanceWarning === "string" ? gm0.nightAllowanceWarning : undefined),
    };
  }

  if (r.payrollMode === "government" && base.govRecalc && !hasUsableGovernmentMonthly(base.governmentMonthly)) {
    const gr = base.govRecalc as GovRecalcPayload;
    const dim = Math.max(1, Math.floor(Number(denom) || 30));
    const payDays = Number(r.payDays ?? dim);
    const { comp, capped, unpaidDays } = runGovernmentPayrollCompute(gr, {
      daysInMonth: dim,
      payDays,
      payrollConfig: payrollConfig as never,
      runYear,
      runMonth,
      governmentMonthly: (base.governmentMonthly as Record<string, unknown> | null) ?? null,
    });
    const withArrear = applyAutoArrearsToGovernmentMonthly(comp, arrearSnapshotFromRow(r));
    const frozen = applyFrozenSheetOverridesToComputed(gr, withArrear as unknown as Record<string, unknown>);
    base.governmentMonthly = frozen;
    base.grossMonthly = gr.grossBasic;
    base.grossPay = Number(frozen.totalEarnings ?? withArrear.totalEarnings) || 0;
    base.deductions = Number(frozen.totalDeductions ?? withArrear.totalDeductions) || 0;
    base.netPay = Number(frozen.netSalary ?? withArrear.netSalary) || 0;
    base.payDays = capped;
    base.unpaidLeaveDays = unpaidDays;
    base.arrearLineIds = Array.isArray(r.arrearLineIds)
      ? r.arrearLineIds
      : Array.isArray(r.arrearLines)
        ? (r.arrearLines as Array<{ id?: string }>).map((line) => line?.id).filter(Boolean)
        : [];
    base.arrearLines = Array.isArray(r.arrearLines) ? r.arrearLines : [];
    const ded = (frozen.deductions ?? withArrear.deductions) as {
      incomeTax: number;
      pt: number;
      cpf: number;
      daCpf: number;
      vpf: number;
    };
    base.tds = ded.incomeTax;
    base.profTax = ded.pt;
    base.pfEmployee = Math.round(ded.cpf + ded.daCpf + ded.vpf);
    base.takeHome =
      Math.round(Number(frozen.netSalary ?? withArrear.netSalary) || 0) +
      Math.round(Number(r.incentive) || 0) +
      Math.round(Number(r.prBonus) || 0) +
      Math.round(Number(r.reimbursement) || 0);
  }

  return base;
}

function applyFrozenSheetOverridesToComputed(
  gr: GovRecalcPayload,
  comp: Record<string, unknown>,
): Record<string, unknown> {
  const eo = gr.earningPaidOverrides ?? {};
  const paidDed = gr.deductionPaidOverrides ?? {};
  const hasEarningFreeze = SHEET_EARNING_KEYS.some((k) => hasOwn(eo, k));
  const hasDeductionFreeze =
    Object.keys(paidDed).length > 0 ||
    Boolean(
      gr.cpfManualOverride ||
        gr.hplDeductionManualOverride ||
        gr.eolDeductionManualOverride ||
        gr.electricityManualOverride ||
        gr.quarterRentManualOverride,
    );
  if (!hasEarningFreeze && !hasDeductionFreeze) {
    return comp;
  }

  let gm: Record<string, unknown> = { ...comp };
  if (hasEarningFreeze) {
    for (const key of SHEET_EARNING_KEYS) {
      if (hasOwn(eo, key)) {
        const v = Number((eo as Record<string, number>)[key]);
        if (Number.isFinite(v)) gm[key] = Math.max(0, Math.round(v));
      }
    }
  }
  if (hasDeductionFreeze) {
    gm = applyDeductionPaidOverridesToGm(
      gm,
      mergeDeductionDefaultsWithPaidOverrides(gr.deductionDefaults, null),
      {
        ...paidDed,
        ...(gr.cpfManualOverride && hasOwn(gr.deductionDefaults, "cpf")
          ? { cpf: gr.deductionDefaults.cpf }
          : {}),
        ...(gr.hplDeductionManualOverride && hasOwn(gr.deductionDefaults, "hpl")
          ? { hpl: gr.deductionDefaults.hpl }
          : {}),
        ...(gr.eolDeductionManualOverride && hasOwn(gr.deductionDefaults, "eol")
          ? { eol: gr.deductionDefaults.eol }
          : {}),
        ...(gr.electricityManualOverride && hasOwn(gr.deductionDefaults, "electricity")
          ? { electricity: gr.deductionDefaults.electricity }
          : {}),
        ...(gr.quarterRentManualOverride && hasOwn(gr.deductionDefaults, "quarterRent")
          ? { quarterRent: gr.deductionDefaults.quarterRent }
          : {}),
      },
    );
    return gm;
  }
  return recalculateGovernmentSheetTotals(gm);
}

/** True when governmentMonthly looks like a real computed snapshot (not empty/missing). */
export function hasUsableGovernmentMonthly(gm: unknown): boolean {
  if (!gm || typeof gm !== "object") return false;
  const rec = gm as Record<string, unknown>;
  if ("totalEarnings" in rec || "total_earnings" in rec) {
    return Number.isFinite(Number(rec.totalEarnings ?? rec.total_earnings));
  }
  if ("basicPaid" in rec || "basic_paid" in rec) {
    return Number.isFinite(Number(rec.basicPaid ?? rec.basic_paid));
  }
  return false;
}

/**
 * Canonical resolve priority:
 * 1. Unsaved edit cache when dirty
 * 2. Saved draft row_payload overlay
 * 3. Calculated row with governmentMonthly computed when missing
 */
export function resolveRunPayrollRow(
  r: RunPayrollRowLike,
  ctx: ResolveRunPayrollRowContext,
): RunPayrollRowLike {
  const uid = String(r.employeeUserId ?? "");
  if (!ctx.alreadyRun && ctx.draftDirty && ctx.cached && String(ctx.cached.employeeUserId) === uid) {
    return ctx.cached;
  }

  const draftEmp = !ctx.alreadyRun ? normalizeDraftEmployeeApiRow(ctx.draftStored, uid) : null;
  if (draftEmp) {
    const overlaid = deserializePayrollDraftEmployee(draftEmp, r as Record<string, unknown>) as RunPayrollRowLike;
    if (
      overlaid.payrollMode === "government" &&
      !hasUsableGovernmentMonthly(overlaid.governmentMonthly) &&
      overlaid.govRecalc
    ) {
      return computeGovernmentRow(overlaid, ctx.denom, ctx.runYear, ctx.runMonth, ctx.payrollConfig);
    }
    return overlaid;
  }

  if (!ctx.alreadyRun && ctx.cached && String(ctx.cached.employeeUserId) === uid) {
    return ctx.cached;
  }

  return computeGovernmentRow(r, ctx.denom, ctx.runYear, ctx.runMonth, ctx.payrollConfig);
}

/** Detect zero-stub API government rows that must not be persisted as drafts. */
export function isZeroStubPayrollRow(row: RunPayrollRowLike): boolean {
  if (row.payrollMode !== "government") return false;
  if (hasUsableGovernmentMonthly(row.governmentMonthly)) return false;
  const gross = Number(row.grossPay ?? 0);
  const net = Number(row.netPay ?? 0);
  const ded = Number(row.deductions ?? 0);
  return gross === 0 && net === 0 && ded === 0 && Boolean(row.govRecalc);
}
