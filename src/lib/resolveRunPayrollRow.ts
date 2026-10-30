/**
 * Resolve a Run Payroll API row into the editable government/private shape.
 * Ensures governmentMonthly is computed when the API returns zero stubs.
 */
import { applyAutoArrearsToGovernmentMonthly } from "@/lib/payrollArrearCalc";
import {
  runGovernmentPayrollCompute,
  type GovRecalcPayload,
} from "@/lib/govRunPayrollCompute";
import {
  deserializePayrollDraftEmployee,
  keysToCamelDeep,
  normalizeDraftEmployeeApiRow,
  type DraftEmployeeApiRow,
} from "@/lib/deserializePayrollDraftEmployee";
import {
  recalculateGovernmentSheetTotals,
  SHEET_DEDUCTION_KEYS,
  SHEET_EARNING_KEYS,
  applyDeductionPaidOverridesToGm,
} from "@/lib/runPayrollSheetEdit";
import type { PayrollFieldDefinition } from "@/lib/payrollFieldTypes";
import { hasOwn } from "@/lib/effectivePayrollValue";
import type { ElectricityTariffConfig } from "@/lib/electricityTariffCalculation";
import { freshPayrollLeaveDefaults, payrollPeriodKey } from "@/lib/payrollPeriodIsolation";

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
  /** Keep local sheet edits (audit mode) instead of reloading API values. */
  preserveEdits?: boolean;
  cached?: RunPayrollRowLike | null;
  cachedPeriodKey?: string | null;
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
    const refDefaults = freshPayrollLeaveDefaults(runYear, runMonth);
    const gm0 = r.governmentMonthly as Record<string, unknown> | null | undefined;
    base.govRecalc = {
      ...r.govRecalc,
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
    const frozen = applyFrozenSheetOverridesToComputed(
      gr,
      withArrear as unknown as Record<string, unknown>,
      (payrollConfig as { fields?: PayrollFieldDefinition[] } | null | undefined)?.fields,
    );
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
  payrollFieldDefs?: PayrollFieldDefinition[],
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
      // `gm` is already a fresh full calculation. Reapply only explicitly
      // frozen monthly values; merging every master default here would replace
      // derived values such as tariff-based electricity after a units edit.
      null,
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
      payrollFieldDefs,
    );
    return gm;
  }
  return recalculateGovernmentSheetTotals(gm, payrollFieldDefs);
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

/** A saved units input must be recalculated, not treated as a frozen bill. */
function draftContainsElectricityUnits(draft: DraftEmployeeApiRow): boolean {
  const payload = (draft.rowPayload ?? draft.row_payload) as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return false;
  const gr = (payload.govRecalc ?? payload.gov_recalc) as Record<string, unknown> | null | undefined;
  const gm = (payload.governmentMonthly ?? payload.government_monthly) as Record<string, unknown> | null | undefined;
  return Boolean(
    (gr && (
      Object.prototype.hasOwnProperty.call(gr, "electricityUnitsConsumed") ||
      Object.prototype.hasOwnProperty.call(gr, "electricity_units_consumed")
    )) ||
      (gm && (
        Object.prototype.hasOwnProperty.call(gm, "electricityUnitsConsumed") ||
        Object.prototype.hasOwnProperty.call(gm, "electricity_units_consumed")
      )),
  );
}

function savedDraftElectricityMode(draft: DraftEmployeeApiRow): "unit_based" | "manual_fixed" | undefined {
  const rawPayload = (draft.rowPayload ?? draft.row_payload) as Record<string, unknown> | null | undefined;
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const payload = keysToCamelDeep(rawPayload) as Record<string, unknown>;
  const gm = (payload.governmentMonthly ?? payload.government_monthly ?? {}) as Record<string, unknown>;
  const gr = (payload.govRecalc ?? payload.gov_recalc ?? {}) as Record<string, unknown>;
  const bill = (gm.electricityBill ?? gm.electricity_bill ?? gr.electricityBill ?? gr.electricity_bill ?? {}) as Record<string, unknown>;
  // The saved monthly bill owns its calculation mode; Master mode only seeds a
  // new draft and must not turn a unit-based month into a fixed deduction.
  const mode = bill.mode ?? gm.electricityMode ?? gr.electricityMode;
  return mode === "unit_based" || mode === "manual_fixed" ? mode : undefined;
}

function overlayAuthoritativeQuarterContext(
  saved: RunPayrollRowLike,
  calculated: RunPayrollRowLike,
  payrollConfig: unknown,
): RunPayrollRowLike {
  const hasQuarter = Boolean(calculated.hasQuarter ?? calculated.govRecalc?.hasQuarter);
  const calculatedGm = (calculated.governmentMonthly ?? {}) as Record<string, unknown>;
  const savedGm = (saved.governmentMonthly ?? {}) as Record<string, unknown>;
  const calculatedDeductions = (calculatedGm.deductions ?? {}) as Record<string, unknown>;
  const savedDeductions = (savedGm.deductions ?? {}) as Record<string, unknown>;
  const quarterRent = hasQuarter ? Number(calculatedDeductions.quarterRent ?? calculated.govRecalc?.quarterRent ?? 0) : 0;
  const gm = {
    ...savedGm,
    hraActual: hasQuarter ? 0 : Number(calculatedGm.hraActual ?? 0),
    hraPaid: hasQuarter ? 0 : Number(calculatedGm.hraPaid ?? 0),
    hasQuarter,
    quarterId: hasQuarter ? calculated.quarterId ?? null : null,
    quarterName: hasQuarter ? calculated.quarterName ?? null : null,
    quarterType: hasQuarter ? calculated.quarterType ?? null : null,
    quarterTypeId: hasQuarter ? calculated.quarterTypeId ?? null : null,
    quarterRent,
    quarter_rent: quarterRent,
    deductions: { ...savedDeductions, quarterRent },
  };
  const sourceGr: GovRecalcPayload = saved.govRecalc ?? calculated.govRecalc!;
  const { hraPaid: _staleHraOverride, ...earningsOverrides } = sourceGr.earningPaidOverrides ?? {};
  const { quarterRent: _staleRentOverride, ...deductionOverrides } = sourceGr.deductionPaidOverrides ?? {};
  const gr: GovRecalcPayload = {
    ...sourceGr,
    hasQuarter,
    quarterId: hasQuarter ? (calculated.quarterId as string | null | undefined) : null,
    quarterName: hasQuarter ? (calculated.quarterName as string | null | undefined) : null,
    quarterType: hasQuarter ? (calculated.quarterType as string | null | undefined) : null,
    quarterTypeId: hasQuarter ? (calculated.quarterTypeId as string | null | undefined) : null,
    quarterRent,
    quarterRentManualOverride: false,
    earningPaidOverrides: earningsOverrides,
    deductionPaidOverrides: deductionOverrides,
    deductionDefaults: { ...sourceGr.deductionDefaults, quarterRent },
  };
  const fields = (payrollConfig as { fields?: PayrollFieldDefinition[] } | null | undefined)?.fields;
  const totals = recalculateGovernmentSheetTotals(gm, fields);
  const grossPay = Number(totals.totalEarnings ?? 0);
  const deductions = Number(totals.totalDeductions ?? 0);
  const netPay = Number(totals.netSalary ?? 0);
  return {
    ...saved,
    hasQuarter,
    quarterAssigned: hasQuarter,
    quarterId: hasQuarter ? calculated.quarterId ?? null : null,
    quarterName: hasQuarter ? calculated.quarterName ?? null : null,
    quarterType: hasQuarter ? calculated.quarterType ?? null : null,
    quarterTypeId: hasQuarter ? calculated.quarterTypeId ?? null : null,
    quarterRent,
    govRecalc: gr,
    governmentMonthly: totals,
    grossPay,
    deductions,
    netPay,
    takeHome: netPay + Number(saved.incentive ?? 0) + Number(saved.prBonus ?? 0) + Number(saved.reimbursement ?? 0),
  };
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
  const selectedPeriodKey = payrollPeriodKey(ctx.runYear, ctx.runMonth);
  const cachedForSelectedPeriod = ctx.cached && ctx.cachedPeriodKey === selectedPeriodKey ? ctx.cached : null;
  // A dirty flag is period-wide. It must not make every cached employee row
  // authoritative when only one row was edited; callers explicitly identify
  // the row whose in-memory edit must win.
  const preserveEdits = Boolean(ctx.preserveEdits);
  if (preserveEdits && cachedForSelectedPeriod && String(cachedForSelectedPeriod.employeeUserId) === uid) {
    return cachedForSelectedPeriod;
  }

  const draftEmp = !ctx.alreadyRun ? normalizeDraftEmployeeApiRow(ctx.draftStored, uid) : null;
  if (draftEmp) {
    let overlaid = deserializePayrollDraftEmployee(draftEmp, r as Record<string, unknown>) as RunPayrollRowLike;
    if (
      overlaid.payrollMode === "government" &&
      Number(overlaid.quarterContextVersion) !== 1 &&
      ("hasQuarter" in r || r.govRecalc?.hasQuarter !== undefined)
    ) {
      const calculatedQuarterRow = computeGovernmentRow(
        { ...r, governmentMonthly: null },
        ctx.denom,
        ctx.runYear,
        ctx.runMonth,
        ctx.payrollConfig,
      );
      overlaid = overlayAuthoritativeQuarterContext(overlaid, calculatedQuarterRow, ctx.payrollConfig);
    }
    // Electricity units are an input, while the deduction is a derived value.
    // A draft can contain an older browser-calculated bill, so recompute rows
    // that explicitly saved units with the tariff returned for this preview.
    if (
      overlaid.payrollMode === "government" &&
      overlaid.govRecalc &&
      draftContainsElectricityUnits(draftEmp)
    ) {
      const configuredTariff = (ctx.payrollConfig as { electricityTariff?: ElectricityTariffConfig | null } | null)?.electricityTariff;
      const masterRecalc = r.govRecalc;
      const savedMonthly = (overlaid.governmentMonthly ?? {}) as Record<string, unknown>;
      const savedElectricityDeductions = (savedMonthly.deductions ?? {}) as Record<string, unknown>;
      const savedElectricityAmount = Number(
        savedElectricityDeductions.electricity ?? savedMonthly.electricityTotal ?? savedMonthly.electricity_total ?? 0,
      );
      const savedUnits = Number(
        overlaid.govRecalc.electricityUnitsConsumed ?? savedMonthly.electricityUnitsConsumed ?? 0,
      );
      const inferUnitBased = savedUnits > 0
        && savedElectricityAmount === 0
        && overlaid.govRecalc.electricityManualOverride !== true
        && (masterRecalc?.electricityApplicable ?? overlaid.govRecalc.electricityApplicable) !== false;
      const savedMode = savedDraftElectricityMode(draftEmp);
      const freshRow = {
        ...overlaid,
        // Rebuild the derived monthly snapshot from current master/config and
        // saved monthly inputs; the draft's cached totals may predate its tariff.
        governmentMonthly: null,
        govRecalc: {
          ...overlaid.govRecalc,
          // Monthly drafts own consumption, while tariff and applicability are
          // rehydrated from the current period/master response.
          electricityTariff: configuredTariff ?? masterRecalc?.electricityTariff ?? null,
          electricityApplicable: masterRecalc?.electricityApplicable ?? overlaid.govRecalc.electricityApplicable,
          electricityMode: inferUnitBased ? "unit_based" : savedMode ?? overlaid.govRecalc.electricityMode ?? masterRecalc?.electricityMode,
        },
      };
      return computeGovernmentRow(freshRow, ctx.denom, ctx.runYear, ctx.runMonth, ctx.payrollConfig);
    }
    if (
      overlaid.payrollMode === "government" &&
      !hasUsableGovernmentMonthly(overlaid.governmentMonthly) &&
      overlaid.govRecalc
    ) {
      return computeGovernmentRow(overlaid, ctx.denom, ctx.runYear, ctx.runMonth, ctx.payrollConfig);
    }
    return overlaid;
  }

  if (preserveEdits && !ctx.alreadyRun && cachedForSelectedPeriod && String(cachedForSelectedPeriod.employeeUserId) === uid) {
    return cachedForSelectedPeriod;
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
