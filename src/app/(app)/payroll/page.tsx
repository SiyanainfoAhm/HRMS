"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { FormEvent, useEffect, useState, useRef, useMemo, Suspense } from "react";
import { useToast } from "@/components/ToastProvider";
import { dispatchHrmsChange, onHrmsChange } from "@/lib/hrmsChangeBus";
import { AppPageError } from "@/components/ui/AppPageError";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/SelectField";
import { Button } from "@/components/ui/Button";
import { computePayrollFromGross, defaultSalaryBreakup } from "@/lib/payrollCalc";
import {
  computeGovernmentMonthlyPayroll,
  deriveTransportSlabFromLevel,
  GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS,
  type GovernmentDeductionDefaults,
  type GovernmentMonthlyComputed,
} from "@/lib/governmentPayroll";
import {
  masterAmountOr,
  masterRecordToDeductionDefaults,
  resolveMasterMedicalFixed,
} from "@/lib/masterRunPayrollMapping";
import {
  runGovernmentPayrollCompute,
  defaultGovRecalcReferencePeriod,
  type GovRecalcPayload,
} from "@/lib/govRunPayrollCompute";
import { govOptionalFromComputedMonthly } from "@/lib/govRunPayrollOptionalEarnings";
import { fetchReferenceSalary, referenceSalaryToEolHpl } from "@/lib/payrollReferenceSalary";
import {
  isSamePayrollReferencePeriod,
  referenceSalaryFromGovRecalc,
} from "@/lib/hplEolDeductions";
import { customRunFieldsForPreview, type PayrollConfig, type PayrollFieldDefinition } from "@/lib/payrollFieldTypes";
import { applyAutoArrearsToGovernmentMonthly } from "@/lib/payrollArrearCalc";
import {
  GovernmentRunPreviewTable,
  type GovernmentPreviewMonthly,
  type GovernmentRunPreviewRow,
} from "@/components/payroll/GovernmentRunPreviewTable";
import { PayrollPreviewToolbar } from "@/components/payroll/PayrollPreviewToolbar";
import { PrivateRunPreviewCards } from "@/components/payroll/PrivateRunPreviewCards";
import { v as govPreviewV } from "@/components/payroll/payrollRunPreviewShared";
import { downloadPayrollRunWorkbook, type PayrollWorkbookStatus } from "@/lib/payrollRunWorkbook";
import {
  payrollDetailWorkbookFilename,
  payrollExtractWorkbookFilename,
  payrollBankLetterFilename,
} from "@/lib/payrollDownloadFilenames";
import {
  mapRowToBankLetterEmployee,
  validateBankLetterEmployees,
  type BankLetterEmployeeInput,
} from "@/lib/payrollBankLetter";
import {
  sumResolvedPayrollTotals,
  type DraftEmployeeApiRow,
} from "@/lib/deserializePayrollDraftEmployee";
import {
  isZeroStubPayrollRow,
  resolveRunPayrollRow,
  type RunPayrollRowLike,
} from "@/lib/resolveRunPayrollRow";
import {
  applyGovernmentSheetMonetaryEdit,
  applyDeductionPaidOverridesToGm,
  clearMonetaryOverridesFromGovRecalc,
  isGovernmentSheetMonetaryField,
  mergeDeductionDefaultsWithPaidOverrides,
  recalculateGovernmentSheetTotals,
  SHEET_DEDUCTION_KEYS,
  SHEET_EARNING_KEYS,
} from "@/lib/runPayrollSheetEdit";
import { hasOwn } from "@/lib/effectivePayrollValue";
import { isAdminRole } from "@/lib/roles";
import { Download, FileText } from "lucide-react";
import { GovernmentPayslipPrint } from "@/components/payslip/GovernmentPayslipPrint";
import { AdminPayrollRemarksNote } from "@/components/payroll/AdminPayrollRemarksNote";
import type { GovernmentMonthlySlip } from "@/lib/governmentPayslipLayout";
import type { GovernmentLeavePayslipDisplay } from "@/lib/leaveBalancesCompute";
import { resolvePayslipDepartment, resolvePayslipDesignation } from "@/lib/payslipUserFields";
import {
  normalizeDigits,
  normalizeIfscInput,
  validateBankDetails,
} from "@/lib/employeeValidators";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildPaginatedQuery,
  DEFAULT_PAGE_SIZE,
  emptyPaginationMeta,
  SEARCH_DEBOUNCE_MS,
  type PaginationMeta,
} from "@/lib/pagination";

type MasterGridRow = {
  employeeUserId: string;
  employeeName: string | null;
  employeeEmail: string;
  /** `private`: monthly gross salary. `government`: gross basic (pay level). */
  payrollMode: "private" | "government";
  governmentPayLevel: number | null;
  gross: number;
  ctc: number;
  pfEmp: number;
  pfEmpr: number;
  esicEmp: number;
  esicEmpr: number;
  pt: number;
  tds: number;
  /** Government income tax monthly default (mirrors `tds` in grid edits). */
  incomeTaxDefault: number;
  advanceBonus: number;
  takeHome: number;
  effectiveStartDate: string;
  pfEligible: boolean;
  esicEligible: boolean;
  basic: number;
  hra: number;
  medical: number;
  trans: number;
  lta: number;
  personal: number;
  /** Government structure (ignored when private). */
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
  cpfDefault: number;
  daCpfDefault: number;
  /** Monthly rupee defaults (government); mirrored on pay slip deduction side. */
  licDefault: number;
  messDefault: number;
  welfareDefault: number;
  vpfDefault: number;
  pfLoanDefault: number;
  postOfficeDefault: number;
  creditSocietyDefault: number;
  stdLicenceFeeDefault: number;
  electricityDefault: number;
  waterDefault: number;
  loanRecoveryDefault: number;
  vehChargeDefault: number;
  otherDeductionDefault: number;
  hasQuarter: boolean;
  quarterRent: number;
  govTotalEarnings: number;
  govTransportPaid: number;
  govTransportSlabGroup: string;
  govEffectiveCpf: number;
  govNetSalary: number;
};

/** Deduction/earning keys for Run Payroll sheet are defined in runPayrollSheetEdit.ts */

const MASTER_GOVT_DEDUCTION_DEFAULT_COLUMNS: { field: keyof MasterGridRow; label: string }[] = [
  { field: "licDefault", label: "LIC" },
  { field: "messDefault", label: "Mess" },
  { field: "welfareDefault", label: "Welf." },
  { field: "vpfDefault", label: "VPF" },
  { field: "postOfficeDefault", label: "P.O." },
  { field: "creditSocietyDefault", label: "Cr. soc." },
  { field: "electricityDefault", label: "Elec." },
  { field: "waterDefault", label: "Water" },
  { field: "loanRecoveryDefault", label: "Bank Rec." },
  { field: "otherDeductionDefault", label: "Oth." },
];

type GovMonthlyWithArrear = ReturnType<
  typeof applyAutoArrearsToGovernmentMonthly<GovernmentMonthlyComputed>
>;

async function hydrateEolReferenceSalary(
  employeeUserId: string,
  gr: GovRecalcPayload,
  runYear: number,
  runMonth: number,
): Promise<GovRecalcPayload> {
  const refMonth = gr.eolReferenceMonth ?? runMonth;
  const refYear = gr.eolReferenceYear ?? runYear;
  try {
    const ref = await fetchReferenceSalary(employeeUserId, refYear, refMonth);
    return {
      ...gr,
      eolReferenceMonth: refMonth,
      eolReferenceYear: refYear,
      eolReferenceSalary: referenceSalaryToEolHpl(ref),
      eolReferenceDaysInMonth: ref.daysInMonth,
      eolReferenceWarning: ref.warning,
    };
  } catch {
    return gr;
  }
}

async function hydrateHplReferenceSalary(
  employeeUserId: string,
  gr: GovRecalcPayload,
  runYear: number,
  runMonth: number,
): Promise<GovRecalcPayload> {
  const refMonth = gr.hplReferenceMonth ?? runMonth;
  const refYear = gr.hplReferenceYear ?? runYear;
  try {
    const ref = await fetchReferenceSalary(employeeUserId, refYear, refMonth);
    return {
      ...gr,
      hplReferenceMonth: refMonth,
      hplReferenceYear: refYear,
      hplReferenceSalary: referenceSalaryToEolHpl(ref),
      hplReferenceDaysInMonth: ref.daysInMonth,
      hplReferenceWarning: ref.warning,
    };
  } catch {
    return gr;
  }
}

function governmentRowFromCompute<T extends {
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
) {
  // Re-apply frozen sheet overrides after any full compute (days / EOL / HPL workflow).
  const gm = applyFrozenSheetOverridesToComputed(gr, comp as unknown as Record<string, unknown>);
  const totalEarnings = Number(gm.totalEarnings ?? comp.totalEarnings) || 0;
  const totalDeductions = Number(gm.totalDeductions ?? comp.totalDeductions) || 0;
  const netSalary = Number(gm.netSalary ?? comp.netSalary) || 0;
  const ded = (gm.deductions ?? comp.deductions) as GovernmentDeductionDefaults;

  return {
    ...row,
    govRecalc: gr,
    payDays: capped,
    unpaidLeaveDays: unpaidDays,
    governmentMonthly: {
      ...gm,
      leaveRemarks: gr.leaveRemarks ?? (row.governmentMonthly as { leaveRemarks?: string | null } | null | undefined)?.leaveRemarks ?? null,
    },
    daArrear: arrear?.daArrear ?? (Number(gm.daArrearsPaid ?? comp.daArrearsPaid) || 0),
    transportArrear:
      arrear?.transportArrear ?? (Number(gm.transportArrearsPaid ?? comp.transportArrearsPaid) || 0),
    grossArrear: arrear?.grossArrear ?? (Number(gm.grossArrear ?? comp.grossArrear) || 0),
    cpfArrear: arrear?.cpfArrear ?? (Number(gm.cpfArrear ?? comp.cpfArrear) || 0),
    netArrear: arrear?.netArrear ?? (Number(gm.netArrear ?? comp.netArrear) || 0),
    grossPay: totalEarnings,
    deductions: totalDeductions,
    netPay: netSalary,
    tds: ded.incomeTax,
    profTax: ded.pt,
    pfEmployee: Math.round(ded.cpf + ded.daCpf + ded.vpf),
    pfEmployer: 0,
    esicEmployee: 0,
    esicEmployer: 0,
    takeHome:
      Math.round(netSalary) +
      Math.round(Number(incentiveBase.incentive) || 0) +
      Math.round(Number(incentiveBase.prBonus) || 0) +
      Math.round(Number(incentiveBase.reimbursement) || 0),
  };
}

/** After full payroll compute, restore any frozen/manual sheet component values. */
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
    return applyDeductionPaidOverridesToGm(
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
  }
  return recalculateGovernmentSheetTotals(gm);
}

function applyGovernmentPayrollRowCompute(
  row: { governmentMonthly?: unknown; daArrear?: number; transportArrear?: number; grossArrear?: number; cpfArrear?: number; netArrear?: number },
  gr: GovRecalcPayload,
  payDaysVal: number,
  opts: {
    daysInMonth: number;
    runYear: number;
    runMonth: number;
    payrollConfig?: PayrollConfig | null;
    arrearOverride?: ReturnType<typeof arrearSnapshotFromRow>;
  },
) {
  const dim = Math.max(1, Math.floor(opts.daysInMonth));
  const { comp, capped, unpaidDays } = runGovernmentPayrollCompute(gr, {
    daysInMonth: dim,
    payDays: payDaysVal,
    payrollConfig: opts.payrollConfig,
    runYear: opts.runYear,
    runMonth: opts.runMonth,
    governmentMonthly: (row.governmentMonthly as Record<string, unknown> | null) ?? null,
  });
  const withArrear = applyAutoArrearsToGovernmentMonthly(
    comp,
    opts.arrearOverride ?? arrearSnapshotFromRow(row),
  );
  return { comp: withArrear, capped, unpaidDays };
}

function ensureReferenceSalariesForRecompute(
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

function arrearSnapshotFromRow(row: {
  daArrear?: number;
  transportArrear?: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
  governmentMonthly?: GovernmentPreviewMonthly | GovMonthlyWithArrear | null | unknown;
}) {
  const g = row.governmentMonthly as GovernmentPreviewMonthly | GovMonthlyWithArrear | null | undefined;
  return {
    daArrear: Math.round(Number(row.daArrear ?? g?.daArrearsPaid ?? 0) || 0),
    transportArrear: Math.round(Number(row.transportArrear ?? g?.transportArrearsPaid ?? 0) || 0),
    grossArrear: Math.round(Number(row.grossArrear ?? g?.grossArrear ?? 0) || 0),
    cpfArrear: Math.round(Number(row.cpfArrear ?? g?.cpfArrear ?? 0) || 0),
    netArrear: Math.round(Number(row.netArrear ?? g?.netArrear ?? 0) || 0),
  };
}

function govDeductionDefaultsFromMasterRow(row: MasterGridRow): GovernmentDeductionDefaults {
  return masterRecordToDeductionDefaults({
    incomeTaxDefault: row.incomeTaxDefault,
    tds: row.tds,
    pt: row.pt,
    licDefault: row.licDefault,
    cpfDefault: row.cpfDefault,
    daCpfDefault: row.daCpfDefault,
    vpfDefault: row.vpfDefault,
    pfLoanDefault: row.pfLoanDefault,
    postOfficeDefault: row.postOfficeDefault,
    creditSocietyDefault: row.creditSocietyDefault,
    stdLicenceFeeDefault: row.stdLicenceFeeDefault,
    electricityDefault: row.electricityDefault,
    waterDefault: row.waterDefault,
    messDefault: row.messDefault,
    loanRecoveryDefault: row.loanRecoveryDefault,
    welfareDefault: row.welfareDefault,
    vehChargeDefault: row.vehChargeDefault,
    otherDeductionDefault: row.otherDeductionDefault,
    quarterRent: row.quarterRent ?? 0,
  });
}

function computeGovernmentMasterDerived(row: MasterGridRow): Partial<MasterGridRow> {
  if (row.payrollMode !== "government" || row.governmentPayLevel == null) {
    return {
      govTotalEarnings: 0,
      govTransportPaid: 0,
      govTransportSlabGroup: "",
      govEffectiveCpf: 0,
      govNetSalary: 0,
    };
  }
  try {
    const comp = computeGovernmentMonthlyPayroll({
      grossBasic: row.gross,
      daPercent: row.daPercent,
      hraPercent: row.hraPercent,
      medicalFixed: row.medicalFixed,
      payLevel: row.governmentPayLevel,
      daysInMonth: 30,
      unpaidDays: 0,
      hasQuarter: row.hasQuarter,
      quarterRent: row.quarterRent,
      deductionDefaults: govDeductionDefaultsFromMasterRow(row),
    });
    const takeHome = Math.max(0, comp.netSalary + row.advanceBonus);
    const cpfLikeRunPayroll =
      comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf;
    return {
      ctc: row.gross,
      takeHome,
      govTotalEarnings: comp.totalEarnings,
      govTransportPaid: comp.transportPaid,
      govTransportSlabGroup: comp.transportSlab.transportSlabGroup,
      /** Matches Run Payroll “CPF” column (core CPF + DA CPF + VPF + PF loan defaults). */
      govEffectiveCpf: cpfLikeRunPayroll,
      govNetSalary: comp.netSalary,
      pfEmp: 0,
      pfEmpr: 0,
      esicEmp: 0,
      esicEmpr: 0,
      basic: comp.basicPaid,
      hra: comp.hraPaid,
      medical: comp.medicalPaid,
      trans: comp.transportPaid,
    };
  } catch {
    return {
      ctc: row.gross,
      takeHome: Math.max(0, row.advanceBonus),
      govTotalEarnings: 0,
      govTransportPaid: 0,
      govTransportSlabGroup: "",
      govEffectiveCpf: 0,
      govNetSalary: 0,
      pfEmp: 0,
      pfEmpr: 0,
      esicEmp: 0,
      esicEmpr: 0,
    };
  }
}

function breakupIfMatchesGross(row: Pick<MasterGridRow, "basic" | "hra" | "medical" | "trans" | "lta" | "personal" | "gross">) {
  const s = row.basic + row.hra + row.medical + row.trans + row.lta + row.personal;
  return Math.abs(s - row.gross) < 2
    ? { basic: row.basic, hra: row.hra, medical: row.medical, trans: row.trans, lta: row.lta, personal: row.personal }
    : undefined;
}

/** True if the six components match `defaultSalaryBreakup(gross)` within rounding tolerance. */
function isDefaultSalaryBreakupForGross(
  gross: number,
  basic: number,
  hra: number,
  medical: number,
  trans: number,
  lta: number,
  personal: number
): boolean {
  if (gross <= 0) return false;
  const d = defaultSalaryBreakup(gross);
  const tol = 2;
  return (
    Math.abs(basic - d.basic) <= tol &&
    Math.abs(hra - d.hra) <= tol &&
    Math.abs(medical - d.medical) <= tol &&
    Math.abs(trans - d.trans) <= tol &&
    Math.abs(lta - d.lta) <= tol &&
    Math.abs(personal - d.personal) <= tol
  );
}

function computeRowStatutory(
  row: Pick<
    MasterGridRow,
    | "gross"
    | "pt"
    | "tds"
    | "advanceBonus"
    | "pfEligible"
    | "esicEligible"
    | "basic"
    | "hra"
    | "medical"
    | "trans"
    | "lta"
    | "personal"
  >
) {
  const br = breakupIfMatchesGross(row);
  const calc = computePayrollFromGross(row.gross, row.pfEligible, row.esicEligible, row.pt, br);
  const takeHome = Math.max(0, calc.takeHome - row.tds + row.advanceBonus);
  return {
    ctc: calc.ctc,
    pfEmp: calc.pfEmp,
    pfEmpr: calc.pfEmpr,
    esicEmp: calc.esicEmp,
    esicEmpr: calc.esicEmpr,
    takeHome,
    basic: calc.basic,
    hra: calc.hra,
    medical: calc.medical,
    trans: calc.trans,
    lta: calc.lta,
    personal: calc.personal,
  };
}

function emptyGovFields(): Pick<
  MasterGridRow,
  | "daPercent"
  | "hraPercent"
  | "medicalFixed"
  | "cpfDefault"
  | "daCpfDefault"
  | "licDefault"
  | "messDefault"
  | "welfareDefault"
  | "vpfDefault"
  | "pfLoanDefault"
  | "postOfficeDefault"
  | "creditSocietyDefault"
  | "stdLicenceFeeDefault"
  | "electricityDefault"
  | "waterDefault"
  | "loanRecoveryDefault"
  | "vehChargeDefault"
  | "otherDeductionDefault"
  | "hasQuarter"
  | "quarterRent"
  | "govTotalEarnings"
  | "govTransportPaid"
  | "govTransportSlabGroup"
  | "govEffectiveCpf"
  | "govNetSalary"
> {
  return {
    daPercent: 0,
    hraPercent: 0,
    medicalFixed: 0,
    cpfDefault: 0,
    daCpfDefault: 0,
    licDefault: 0,
    messDefault: 0,
    welfareDefault: 0,
    vpfDefault: 0,
    pfLoanDefault: 0,
    postOfficeDefault: 0,
    creditSocietyDefault: 0,
    stdLicenceFeeDefault: 0,
    electricityDefault: 0,
    waterDefault: 0,
    loanRecoveryDefault: 0,
    vehChargeDefault: 0,
    otherDeductionDefault: 0,
    hasQuarter: false,
    quarterRent: 0,
    govTotalEarnings: 0,
    govTransportPaid: 0,
    govTransportSlabGroup: "",
    govEffectiveCpf: 0,
    govNetSalary: 0,
  };
}

/** Salary slip picker: employees plus anyone on payroll master (e.g. superadmin with pay structure). */
function buildPayslipEmployeeOptions(
  rawEmployees: any[],
  payrollMasters: any[],
): { id: string; name: string | null; email: string }[] {
  const masterUserIds = new Set(
    payrollMasters
      .map((m) => String(m.employeeUserId ?? m.employee_user_id ?? m.userId ?? m.user_id ?? ""))
      .filter(Boolean),
  );
  const byId = new Map<string, { id: string; name: string | null; email: string }>();

  for (const e of rawEmployees) {
    const status = String(e.employmentStatus ?? "preboarding");
    if (status === "preboarding") continue;
    const role = String(e.role ?? "").toLowerCase();
    const id = String(e.userId ?? e.user_id ?? e.id);
    if (!id) continue;
    if (role === "employee" || masterUserIds.has(id)) {
      byId.set(id, { id, name: e.name ?? null, email: e.email ?? "" });
    }
  }

  for (const m of payrollMasters) {
    const id = String(m.employeeUserId ?? m.employee_user_id ?? m.userId ?? m.user_id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      name: m.name ?? m.employeeName ?? null,
      email: m.email ?? m.employeeEmail ?? "",
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", undefined, { sensitivity: "base" }),
  );
}

function buildMasterGridRow(apiRow: any, companyPt: number): MasterGridRow | null {
  const m = apiRow.master;
  if (!m) return null;
  const payrollMode = m.payrollMode === "government" ? "government" : "private";
  const governmentPayLevel =
    apiRow.governmentPayLevel != null && Number.isFinite(Number(apiRow.governmentPayLevel))
      ? Number(apiRow.governmentPayLevel)
      : null;

  if (payrollMode === "government") {
    const grossBasic = masterAmountOr(0, m.grossBasic, m.grossSalary, m.grossBasicPay, m.gross_basic_pay);
    const pt = masterAmountOr(companyPt, m.pt, m.ptDefault, m.professionalTax, m.pt_default);
    const tds = masterAmountOr(0, m.tds, m.incomeTax, m.incomeTaxDefault, m.income_tax);
    const incomeTaxDefault = masterAmountOr(0, m.incomeTaxDefault, m.incomeTax, m.income_tax_default, m.tds);
    const advanceBonus = masterAmountOr(0, m.advanceBonus, m.advance, m.advance_bonus);
    const daPercent = masterAmountOr(53, m.daPercent, m.da_percent);
    const hraPercent = masterAmountOr(30, m.hraPercent, m.hra_percent);
    const medicalFixed = resolveMasterMedicalFixed(m as Record<string, unknown>);
    const cpfDefault = masterAmountOr(0, m.cpfDefault, m.cpf_default);
    const daCpfDefault = masterAmountOr(0, m.daCpfDefault, m.daCpf, m.da_cpf_default, m.da_cpf);
    const licDefault = masterAmountOr(0, m.licDefault, m.lic, m.lic_default);
    const messDefault = masterAmountOr(0, m.messDefault, m.mess, m.mess_default);
    const welfareDefault = masterAmountOr(0, m.welfareDefault, m.welfare, m.welfare_default);
    const vpfDefault = masterAmountOr(0, m.vpfDefault, m.vpf, m.vpf_default);
    const pfLoanDefault = masterAmountOr(0, m.pfLoanDefault, m.pfLoan, m.pf_loan_default, m.pf_loan);
    const postOfficeDefault = masterAmountOr(
      0,
      m.postOfficeDefault,
      m.postOffice,
      m.post_office_default,
      m.post_office,
    );
    const creditSocietyDefault = masterAmountOr(
      0,
      m.creditSocietyDefault,
      m.creditSociety,
      m.credit_society_default,
      m.credit_society,
    );
    const stdLicenceFeeDefault = masterAmountOr(
      0,
      m.stdLicenceFeeDefault,
      m.standardLicenceFee,
      m.std_licence_fee_default,
      m.standard_licence_fee,
    );
    const electricityDefault = masterAmountOr(
      0,
      m.electricityDefault,
      m.electricity,
      m.electricity_default,
    );
    const waterDefault = masterAmountOr(0, m.waterDefault, m.water, m.water_default);
    const loanRecoveryDefault = masterAmountOr(
      0,
      m.loanRecoveryDefault,
      m.loanRecovery,
      m.loan_recovery_default,
      m.loan_recovery,
    );
    const vehChargeDefault = masterAmountOr(
      0,
      m.vehChargeDefault,
      m.vehicleCharge,
      m.veh_charge_default,
      m.vehicle_charge,
    );
    const otherDeductionDefault = masterAmountOr(
      0,
      m.otherDeductionDefault,
      m.otherDeduction,
      m.other_deduction_default,
      m.other_deduction,
    );
    const hasQuarter = Boolean(m.hasQuarter);
    const quarterRent = hasQuarter
      ? masterAmountOr(0, m.quarterRent, m.quarter_rent)
      : 0;
    const base: MasterGridRow = {
      employeeUserId: apiRow.employeeUserId,
      employeeName: apiRow.employeeName,
      employeeEmail: apiRow.employeeEmail,
      payrollMode: "government",
      governmentPayLevel,
      gross: grossBasic,
      pt,
      tds,
      incomeTaxDefault,
      advanceBonus,
      effectiveStartDate: m.effectiveStartDate ? String(m.effectiveStartDate).slice(0, 10) : "",
      pfEligible: !!m.pfEligible,
      esicEligible: !!m.esicEligible,
      daPercent,
      hraPercent,
      medicalFixed,
      cpfDefault,
      daCpfDefault,
      licDefault,
      messDefault,
      welfareDefault,
      vpfDefault,
      pfLoanDefault,
      postOfficeDefault,
      creditSocietyDefault,
      stdLicenceFeeDefault,
      electricityDefault,
      waterDefault,
      loanRecoveryDefault,
      vehChargeDefault,
      otherDeductionDefault,
      hasQuarter,
      quarterRent,
      lta: 0,
      personal: 0,
      basic: 0,
      hra: 0,
      medical: 0,
      trans: 0,
      ctc: 0,
      pfEmp: 0,
      pfEmpr: 0,
      esicEmp: 0,
      esicEmpr: 0,
      takeHome: 0,
      govTotalEarnings: 0,
      govTransportPaid: 0,
      govTransportSlabGroup: "",
      govEffectiveCpf: 0,
      govNetSalary: 0,
    };
    return { ...base, ...computeGovernmentMasterDerived(base) };
  }

  const gross = Number(m.grossSalary) || 0;
  const pt = m.pt != null && Number(m.pt) >= 0 ? Number(m.pt) : companyPt;
  const tds = Number(m.tds) || 0;
  const advanceBonus = Number(m.advanceBonus) || 0;
  let basic = Number(m.basic) || 0;
  let hra = Number(m.hra) || 0;
  let medical = Number(m.medical) || 0;
  let trans = Number(m.trans) || 0;
  let lta = Number(m.lta) || 0;
  let personal = Number(m.personal) || 0;
  if (basic + hra + medical + trans + lta + personal === 0 && gross > 0) {
    const d = defaultSalaryBreakup(gross);
    basic = d.basic;
    hra = d.hra;
    medical = d.medical;
    trans = d.trans;
    lta = d.lta;
    personal = d.personal;
  }
  const base: MasterGridRow = {
    employeeUserId: apiRow.employeeUserId,
    employeeName: apiRow.employeeName,
    employeeEmail: apiRow.employeeEmail,
    payrollMode: "private",
    governmentPayLevel: null,
    gross,
    pt,
    tds,
    incomeTaxDefault: tds,
    advanceBonus,
    effectiveStartDate: m.effectiveStartDate ? String(m.effectiveStartDate).slice(0, 10) : "",
    pfEligible: !!m.pfEligible,
    esicEligible: !!m.esicEligible,
    basic,
    hra,
    medical,
    trans,
    lta,
    personal,
    ctc: 0,
    pfEmp: 0,
    pfEmpr: 0,
    esicEmp: 0,
    esicEmpr: 0,
    takeHome: 0,
    ...emptyGovFields(),
  };
  const stat = computeRowStatutory(base);
  return { ...base, ...stat };
}

function PayrollPageContent() {
  const { role } = useAuth();
  const { showToast } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") || "run";

  useEffect(() => {
    if (params.get("tab") === "master") {
      router.replace("/payroll/master");
    }
  }, [params, router]);

  const canManage = isAdminRole(role);

  useEffect(() => {
    if (!canManage) {
      router.replace("/employee/dashboard");
    }
  }, [canManage, router]);

  const [masters, setMasters] = useState<any[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);
  const [companyPt, setCompanyPt] = useState(200);
  const [masterGrid, setMasterGrid] = useState<MasterGridRow[]>([]);
  const [masterRowSaving, setMasterRowSaving] = useState<string | null>(null);
  const [masterFocusId, setMasterFocusId] = useState<string | null>(null);
  const [editMasterOpen, setEditMasterOpen] = useState<any>(null);
  const [editGross, setEditGross] = useState("");
  const [editBasic, setEditBasic] = useState("");
  const [editHra, setEditHra] = useState("");
  const [editMedical, setEditMedical] = useState("");
  const [editTrans, setEditTrans] = useState("");
  const [editLta, setEditLta] = useState("");
  const [editPersonal, setEditPersonal] = useState("");
  const [editPfEligible, setEditPfEligible] = useState(false);
  const [editEsicEligible, setEditEsicEligible] = useState(false);
  const [editEffectiveDate, setEditEffectiveDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editPt, setEditPt] = useState("");
  const [editTds, setEditTds] = useState("");
  const [editAdvanceBonus, setEditAdvanceBonus] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editMasterTab, setEditMasterTab] = useState<"structure" | "bank">("structure");
  const [editBankName, setEditBankName] = useState("");
  const [editBankAccountHolderName, setEditBankAccountHolderName] = useState("");
  const [editBankAccountNumber, setEditBankAccountNumber] = useState("");
  const [editBankIfsc, setEditBankIfsc] = useState("");
  const [editBankError, setEditBankError] = useState<string | null>(null);
  const [editPayrollMode, setEditPayrollMode] = useState<"private" | "government">("private");
  const [editGrossBasic, setEditGrossBasic] = useState("");
  const [editDaPercent, setEditDaPercent] = useState("53");
  const [editHraPercent, setEditHraPercent] = useState("30");
  const [editMedicalFixed, setEditMedicalFixed] = useState("3000");
  const [editGovPtDefault, setEditGovPtDefault] = useState("200");
  const [editCpfDefault, setEditCpfDefault] = useState("0");
  const [editDaCpfDefault, setEditDaCpfDefault] = useState("0");
  const [editGovLevel, setEditGovLevel] = useState<number | null>(null);

  const [runMonth, setRunMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  const [runYear, setRunYear] = useState(() => String(new Date().getFullYear()));
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [previewSearch, setPreviewSearch] = useState("");
  const debouncedPreviewSearch = useDebouncedValue(previewSearch, SEARCH_DEBOUNCE_MS);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPerPage, setPreviewPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [previewMeta, setPreviewMeta] = useState<PaginationMeta>(emptyPaginationMeta());
  const runRowEditsRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  /** Canonical full-period payroll rows keyed by employee_user_id (not page/filter). */
  const resolvedPayrollByUserIdRef = useRef<Map<string, RunPayrollRowLike>>(new Map());
  const draftPayloadByUserRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const [draftMeta, setDraftMeta] = useState<{
    id: string;
    version: number;
    updatedAt: string | null;
    employeeCount: number;
  } | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const draftDirtyRef = useRef(false);
  /** Bumps when draft payloads load so editable rows re-hydrate after preview. */
  const [draftRevision, setDraftRevision] = useState(0);
  /** Bumps when the canonical full collection is rebuilt (for header totals). */
  const [resolvedRevision, setResolvedRevision] = useState(0);
  const [draftSaving, setDraftSaving] = useState(false);
  const [bankLetterLoading, setBankLetterLoading] = useState(false);
  const [previewDivisionFilter, setPreviewDivisionFilter] = useState("");
  const [previewDepartmentFilter, setPreviewDepartmentFilter] = useState("");
  const [runDivisions, setRunDivisions] = useState<Array<{ id: string; name: string }>>([]);
  const [runDepartments, setRunDepartments] = useState<Array<{ id: string; name: string; divisionId: string | null }>>([]);
  const [runOrgFiltersLoading, setRunOrgFiltersLoading] = useState(false);

  const previewDivisionName = useMemo(
    () => runDivisions.find((d) => d.id === previewDivisionFilter)?.name ?? "",
    [runDivisions, previewDivisionFilter],
  );
  const previewDepartmentName = useMemo(
    () => runDepartments.find((d) => d.id === previewDepartmentFilter)?.name ?? "",
    [runDepartments, previewDepartmentFilter],
  );

  useEffect(() => {
    if (tab !== "run" || !canManage) return;
    let cancelled = false;
    setRunOrgFiltersLoading(true);
    (async () => {
      try {
        const [divRes, depRes] = await Promise.all([
          fetch("/api/settings/divisions"),
          fetch("/api/settings/departments"),
        ]);
        if (cancelled) return;
        const divData = await divRes.json();
        const depData = await depRes.json();
        if (divRes.ok) {
          setRunDivisions(
            (divData.divisions ?? [])
              .filter((d: { is_active?: boolean }) => d.is_active !== false)
              .map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })),
          );
        }
        if (depRes.ok) {
          setRunDepartments(
            (depData.departments ?? [])
              .filter((d: { is_active?: boolean }) => d.is_active !== false)
              .map((d: { id: string; name: string; division_id?: string | null }) => ({
                id: d.id,
                name: d.name,
                divisionId: d.division_id ?? null,
              })),
          );
        }
      } catch {
        /* optional */
      } finally {
        if (!cancelled) setRunOrgFiltersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, canManage]);

  const [preview, setPreview] = useState<{
    periodName: string;
    periodStart: string;
    periodEnd: string;
    daysInMonth: number;
    workingDaysInFullMonth?: number;
    workingDaysThroughRunDay?: number;
    effectiveRunDay: number;
    alreadyRun: boolean;
    existingPeriodId: string | null;
    payrollComplete?: boolean;
    missingPayslipCount?: number;
    arrearWarnings?: string[];
    arrearPeriods?: {
      from?: string | null;
      to?: string | null;
      status?: string;
      monthCount?: number;
      periodLabel?: string | null;
    }[];
    meta?: PaginationMeta;
    rows: {
      employeeUserId: string;
      employeeName: string | null;
      employeeEmail: string;
      payDays: number;
      rawPayDays?: number;
      attendanceQualifyingDays?: number;
      payDaysSuppressedMinAttendance?: boolean;
      unpaidLeaveDays: number;
      grossPay: number;
      pfEmployee: number;
      pfEmployer: number;
      esicEmployee: number;
      esicEmployer: number;
      profTax: number;
      profTaxMonthly?: number;
      deductions: number;
      netPay: number;
      takeHome: number;
      ctc: number;
      grossMonthly?: number;
      incentive?: number;
      prBonus?: number;
      reimbursement?: number;
      tds?: number;
      payrollMode?: string;
      governmentMonthly?: unknown;
      govRecalc?: GovRecalcPayload;
      error?: string;
      payslipPending?: boolean;
    }[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(tab === "run");
  const [payrollConfig, setPayrollConfig] = useState<PayrollConfig | null>(null);
  const [pastPeriods, setPastPeriods] = useState<{ id: string; periodName: string; periodStart: string; periodEnd: string; excelFilePath: string | null }[]>([]);
  const [pastPeriodsLoading, setPastPeriodsLoading] = useState(false);
  const [editableRows, setEditableRows] = useState<
    {
      employeeUserId: string;
      employeeName: string | null;
      employeeEmail: string;
      department?: string | null;
      division?: string | null;
      departmentId?: string | null;
      divisionId?: string | null;
      payDays: number;
      rawPayDays?: number;
      attendanceQualifyingDays?: number;
      payDaysSuppressedMinAttendance?: boolean;
      unpaidLeaveDays: number;
      grossMonthly?: number;
      grossPay: number;
      pfEmployee: number;
      pfEmployer: number;
      esicEmployee: number;
      esicEmployer: number;
      profTax: number;
      profTaxMonthly?: number;
      deductions: number;
      netPay: number;
      incentive: number;
      prBonus: number;
      reimbursement: number;
      tds: number;
      takeHome: number;
      ctc: number;
      ctcBase?: number;
      payrollMode?: string;
      governmentMonthly?: unknown;
      govRecalc?: GovRecalcPayload;
      payslipPending?: boolean;
      arrearLineIds?: string[];
      arrearLines?: Array<{ id?: string }>;
      daArrear?: number;
      transportArrear?: number;
      grossArrear?: number;
      cpfArrear?: number;
      netArrear?: number;
    }[]
  >([]);

  const runPayrollCustomEarningFields = useMemo(
    (): PayrollFieldDefinition[] =>
      customRunFieldsForPreview(payrollConfig?.fields ?? [], editableRows, "earnings"),
    [payrollConfig?.fields, editableRows],
  );

  const runPayrollCustomDeductionFields = useMemo(
    (): PayrollFieldDefinition[] =>
      customRunFieldsForPreview(payrollConfig?.fields ?? [], editableRows, "deductions"),
    [payrollConfig?.fields, editableRows],
  );

  const previewHasGovernment = useMemo(
    () => !!(preview?.rows?.length && preview.rows.some((r: any) => r.payrollMode === "government")),
    [preview?.rows],
  );

  const previewAllGovernment = useMemo(() => {
    const rows = preview?.rows;
    if (!rows?.length) return false;
    return rows.every((r: any) => r.payrollMode === "government" && !r.error);
  }, [preview?.rows]);

  const filteredEditableRows = useMemo(() => editableRows, [editableRows]);

  const runDivisionFilterOptions = useMemo(
    () => [
      { value: "", label: "All divisions" },
      ...runDivisions
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ value: d.id, label: d.name })),
    ],
    [runDivisions],
  );

  const runDepartmentFilterOptions = useMemo(() => {
    const deps = previewDivisionFilter
      ? runDepartments.filter((d) => d.divisionId === previewDivisionFilter)
      : runDepartments;
    return [
      { value: "", label: previewDivisionFilter ? "All in division" : "All departments" },
      ...deps
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ value: d.id, label: d.name })),
    ];
  }, [runDepartments, previewDivisionFilter]);

  const hasActiveRunFilters = Boolean(
    previewDivisionFilter || previewDepartmentFilter || debouncedPreviewSearch.trim(),
  );

  const payrollExportUrl = useMemo(() => {
    if (!preview?.existingPeriodId) return null;
    const params = new URLSearchParams({ periodId: preview.existingPeriodId });
    if (previewDivisionFilter) params.set("divisionId", previewDivisionFilter);
    if (previewDepartmentFilter) params.set("departmentId", previewDepartmentFilter);
    if (hasActiveRunFilters && filteredEditableRows.length > 0) {
      params.set(
        "employeeUserIds",
        filteredEditableRows.map((r) => r.employeeUserId).join(","),
      );
    }
    return `/api/payroll/export?${params.toString()}`;
  }, [
    preview?.existingPeriodId,
    previewDivisionFilter,
    previewDepartmentFilter,
    hasActiveRunFilters,
    filteredEditableRows,
  ]);

  const previewTotals = useMemo(() => {
    const allResolved = Array.from(resolvedPayrollByUserIdRef.current.values());
    const source =
      allResolved.length > 0
        ? allResolved
        : (filteredEditableRows as unknown as Array<Record<string, unknown>>);
    const totals = sumResolvedPayrollTotals(source as Array<Record<string, unknown>>);
    return {
      employees: previewMeta.total || totals.employees,
      gross: totals.gross,
      deductions: totals.deductions,
      net: totals.net,
    };
    // resolvedRevision forces recompute when the canonical map is refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEditableRows, previewMeta.total, resolvedRevision]);

  // Salary slips tab (admin/HR view employee payslips)
  const [employees, setEmployees] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(tab === "slips");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [slipsData, setSlipsData] = useState<{
    company: { name: string; address: string; logoUrl: string | null } | null;
    user: {
      name: string;
      employeeCode: string;
      designation: string;
      department?: string;
      departmentName?: string;
      dateOfJoining: string;
      aadhaar: string;
      pan: string;
      uanNumber: string;
      pfNumber: string;
      cpfNumber?: string;
      esicNumber: string;
    } | null;
    payslips: {
      id: string;
      periodMonth: string;
      periodStart: string;
      periodFormatted: string;
      generatedAt: string;
      payDays: number;
      unpaidLeaves: number;
      netPay: number;
      grossPay: number;
      basic: number;
      hra: number;
      allowances: number;
      medical: number;
      trans: number;
      lta: number;
      personal: number;
      deductions: number;
      pfEmployee: number;
      esicEmployee: number;
      professionalTax: number;
      incentive: number;
      prBonus: number;
      reimbursement: number;
      tds: number;
      bankName?: string;
      bankAccountNumber?: string;
      payrollMode?: string;
      governmentMonthly?: Record<string, number> | null;
      leaveRemarks?: string | null;
      leavePayslip?: GovernmentLeavePayslipDisplay | null;
    }[];
  } | null>(null);
  const [slipsLoading, setSlipsLoading] = useState(false);
  const [slipsError, setSlipsError] = useState<string | null>(null);
  const [slipMonth, setSlipMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  const [slipYear, setSlipYear] = useState(() => String(new Date().getFullYear()));
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const payslipRef = useRef<HTMLDivElement>(null);
  const slipPeriodKey = `${slipYear}-${slipMonth}`;
  const hasSlipForPeriod = Boolean(
    selectedEmployeeId && slipsData?.payslips.some((p) => p.periodMonth === slipPeriodKey),
  );

  useEffect(() => {
    if (!previewDepartmentFilter) return;
    const allowed = new Set(runDepartmentFilterOptions.map((o) => o.value));
    if (!allowed.has(previewDepartmentFilter)) {
      setPreviewDepartmentFilter("");
    }
  }, [previewDepartmentFilter, runDepartmentFilterOptions]);

  useEffect(() => {
    const denom = preview?.daysInMonth ?? preview?.workingDaysInFullMonth;
    if (preview?.rows?.length && denom) {
      const runY = parseInt(runYear, 10);
      const runM = parseInt(runMonth, 10);
      const alreadyRun = Boolean(preview.alreadyRun);
      setEditableRows(
        preview.rows.map((r: any) => {
          const uid = String(r.employeeUserId ?? "");
          const cached =
            (runRowEditsRef.current.get(uid) as RunPayrollRowLike | undefined) ??
            resolvedPayrollByUserIdRef.current.get(uid);
          const resolved = resolveRunPayrollRow(r as RunPayrollRowLike, {
            denom,
            runYear: runY,
            runMonth: runM,
            payrollConfig,
            alreadyRun,
            draftDirty: draftDirtyRef.current,
            cached: cached ?? null,
            draftStored: draftPayloadByUserRef.current.get(uid) ?? null,
          });
          resolvedPayrollByUserIdRef.current.set(uid, resolved);
          if (!alreadyRun) {
            runRowEditsRef.current.set(uid, resolved);
          }
          return resolved as typeof r;
        }),
      );
      setResolvedRevision((n) => n + 1);
    } else if (!preview?.rows?.length) {
      // Keep canonical map; only clear the visible page when API returns empty.
      setEditableRows([]);
    }
  }, [
    preview?.rows,
    preview?.daysInMonth,
    preview?.workingDaysInFullMonth,
    preview?.alreadyRun,
    payrollConfig,
    runYear,
    runMonth,
    draftRevision,
  ]);

  useEffect(() => {
    for (const row of editableRows) {
      const uid = String(row.employeeUserId ?? "");
      if (!uid) continue;
      runRowEditsRef.current.set(uid, row);
      resolvedPayrollByUserIdRef.current.set(uid, row as RunPayrollRowLike);
    }
  }, [editableRows]);

  useEffect(() => {
    if (tab !== "slips" || !canManage) return;
    let cancelled = false;
    (async () => {
      setEmployeesLoading(true);
      try {
        const res = await fetch("/api/employees");
        const data = await res.json();
        if (!cancelled && res.ok) {
          const raw = data.employees ?? [];
          const list = buildPayslipEmployeeOptions(raw, masters);
          setEmployees(list);
          setSelectedEmployeeId((prev) => (prev && list.some((e) => e.id === prev) ? prev : ""));
        }
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, canManage, masters]);

  useEffect(() => {
    if (tab !== "slips" || !selectedEmployeeId) {
      setSlipsData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSlipsLoading(true);
      setSlipsError(null);
      try {
        const qs = new URLSearchParams({
          user_id: selectedEmployeeId,
          employeeUserId: selectedEmployeeId,
        });
        const res = await fetch(`/api/payslips/employee?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load payslips");
        if (!cancelled) {
          setSlipsData({
            company: data.company,
            user: data.user,
            payslips: data.payslips || [],
          });
          const slips = data.payslips || [];
          const first = slips[0];
          const now = new Date();
          if (first?.periodMonth) {
            const [y, m] = first.periodMonth.split("-");
            setSlipYear(y || String(now.getFullYear()));
            setSlipMonth(m || String(now.getMonth() + 1).padStart(2, "0"));
          } else {
            setSlipYear(String(now.getFullYear()));
            setSlipMonth(String(now.getMonth() + 1).padStart(2, "0"));
          }
        }
      } catch (e: any) {
        if (!cancelled) setSlipsError(e?.message || "Failed to load payslips");
      } finally {
        if (!cancelled) setSlipsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, selectedEmployeeId]);

  async function handleSlipDownloadPdf() {
    if (!selectedEmployeeId || !slipsData) return;
    if (!slipsData.payslips.some((p) => p.periodMonth === slipPeriodKey)) return;
    const el = payslipRef.current;
    if (!el) return;
    setPdfDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, (pdf.internal.pageSize.getHeight() / imgHeight)) * 0.95;
      pdf.addImage(imgData, "PNG", (pdfWidth - imgWidth * ratio) / 2, 5, imgWidth * ratio, imgHeight * ratio);
      const namePart = (slipsData?.user?.name || "Employee").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-") || "Employee";
      const fileName = `Salary-Slip-${namePart}-${slipMonth}-${slipYear}.pdf`;
      pdf.save(fileName);
    } catch (err) {
      console.error("PDF download failed:", err);
      window.print();
    } finally {
      setPdfDownloading(false);
    }
  }

  function updateEditableRow(
    employeeUserId: string,
    field: string,
    value: number | string
  ) {
    if (!preview?.alreadyRun) {
      setDraftDirty(true);
    }
    const payDenom = preview?.daysInMonth ?? preview?.workingDaysInFullMonth ?? 30;
    const payDaysMax = preview?.effectiveRunDay ?? preview?.workingDaysThroughRunDay ?? preview?.daysInMonth ?? 31;
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.employeeUserId !== employeeUserId) return row;

        if (row.payrollMode === "government" && row.govRecalc) {
          const dim = Math.max(1, Math.floor(Number(payDenom) || 30));
          const gr0 = row.govRecalc;
          const runY = parseInt(runYear, 10);
          const runM = parseInt(runMonth, 10);
          const computeOpts = {
            daysInMonth: dim,
            runYear: runY,
            runMonth: runM,
            payrollConfig,
          };

          if (field === "leaveRemarks") {
            const text = String(value ?? "").slice(0, 2000);
            const gm =
              row.governmentMonthly && typeof row.governmentMonthly === "object"
                ? { ...(row.governmentMonthly as Record<string, unknown>), leaveRemarks: text }
                : row.governmentMonthly;
            return {
              ...row,
              govRecalc: { ...gr0, leaveRemarks: text },
              governmentMonthly: gm,
            };
          }

          const numValue = typeof value === "number" ? value : Number(value) || 0;

          // Monetary sheet edits: patch the field and totals only — never full recompute.
          if (isGovernmentSheetMonetaryField(field)) {
            const fieldDefs =
              (payrollConfig?.fields as PayrollFieldDefinition[] | undefined) ?? undefined;
            return applyGovernmentSheetMonetaryEdit(row, field, value, {
              payrollFieldDefs: fieldDefs,
            }) as typeof row;
          }

          const recompute = (
            gr: GovRecalcPayload,
            payDaysVal: number,
            arrear?: ReturnType<typeof arrearSnapshotFromRow>,
            incentiveBase: typeof row = row,
            opts?: { clearMonetaryOverrides?: boolean },
          ) => {
            // Calculation drivers: wipe monthly monetary overrides, then full calc.
            const grForCalc = opts?.clearMonetaryOverrides
              ? clearMonetaryOverridesFromGovRecalc(gr)
              : gr;
            const grReady = ensureReferenceSalariesForRecompute(grForCalc, runY, runM);
            const { comp, capped, unpaidDays } = applyGovernmentPayrollRowCompute(row, grReady, payDaysVal, {
              ...computeOpts,
              arrearOverride: arrear,
            });
            return governmentRowFromCompute(row, grReady, comp, capped, unpaidDays, incentiveBase, arrear) as typeof row;
          };

          if (field === "eolReferenceMonth" || field === "eolReferenceYear") {
            const refMonth =
              field === "eolReferenceMonth"
                ? Math.max(1, Math.min(12, Math.round(Number(value) || 1)))
                : gr0.eolReferenceMonth ?? runM;
            const refYear =
              field === "eolReferenceYear"
                ? Math.max(2000, Math.round(Number(value) || runY))
                : gr0.eolReferenceYear ?? runY;
            const grNext: GovRecalcPayload = {
              ...gr0,
              eolReferenceMonth: refMonth,
              eolReferenceYear: refYear,
              eolDeductionManualOverride: false,
              eolReferenceSalary: undefined,
              eolReferenceWarning: undefined,
            };
            if (isSamePayrollReferencePeriod(refMonth, refYear, runM, runY)) {
              return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
            }
            void hydrateEolReferenceSalary(employeeUserId, clearMonetaryOverridesFromGovRecalc(grNext), runY, runM).then((grHydrated) => {
              setEditableRows((prev) =>
                prev.map((r) =>
                  r.employeeUserId === employeeUserId && r.govRecalc
                    ? recompute(grHydrated, r.payDays, undefined, r, { clearMonetaryOverrides: true })
                    : r,
                ),
              );
            });
            return row;
          }

          if (field === "hplReferenceMonth" || field === "hplReferenceYear") {
            const refMonth =
              field === "hplReferenceMonth"
                ? Math.max(1, Math.min(12, Math.round(Number(value) || 1)))
                : gr0.hplReferenceMonth ?? runM;
            const refYear =
              field === "hplReferenceYear"
                ? Math.max(2000, Math.round(Number(value) || runY))
                : gr0.hplReferenceYear ?? runY;
            const grNext: GovRecalcPayload = {
              ...gr0,
              hplReferenceMonth: refMonth,
              hplReferenceYear: refYear,
              hplDeductionManualOverride: false,
              hplReferenceSalary: undefined,
              hplReferenceWarning: undefined,
            };
            if (isSamePayrollReferencePeriod(refMonth, refYear, runM, runY)) {
              return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
            }
            void hydrateHplReferenceSalary(employeeUserId, clearMonetaryOverridesFromGovRecalc(grNext), runY, runM).then((grHydrated) => {
              setEditableRows((prev) =>
                prev.map((r) =>
                  r.employeeUserId === employeeUserId && r.govRecalc
                    ? recompute(grHydrated, r.payDays, undefined, r, { clearMonetaryOverrides: true })
                    : r,
                ),
              );
            });
            return row;
          }

          if (field === "electricityUnitsConsumed") {
            const grNext: GovRecalcPayload = {
              ...gr0,
              electricityUnitsConsumed: Math.max(0, Number(value) || 0),
              electricityManualOverride: false,
            };
            return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
          }

          if (field === "nightHours") {
            const grNext: GovRecalcPayload = {
              ...gr0,
              nightHours: Math.max(0, Number(value) || 0),
              nightAllowanceManualOverride: false,
            };
            return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
          }

          if (field === "nightAllowanceRate") {
            const grNext: GovRecalcPayload = {
              ...gr0,
              nightAllowanceRate: Math.max(0, Number(value) || 0),
              nightAllowanceManualOverride: false,
            };
            return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
          }

          if (field === "hplDays" || field === "eolDays") {
            const grNext: GovRecalcPayload = {
              ...gr0,
              [field]: Math.max(0, Math.min(dim, Math.round(Number(value) || 0))),
            };
            return recompute(grNext, row.payDays, undefined, row, { clearMonetaryOverrides: true });
          }

          const next = { ...row, [field]: numValue } as typeof row;
          const recalcGovTakeHome = () => {
            next.takeHome =
              Math.round(Number(next.netPay) || 0) +
              Math.round(Number(next.incentive) || 0) +
              Math.round(Number(next.prBonus) || 0) +
              Math.round(Number(next.reimbursement) || 0);
          };
          if (field === "payDays") {
            return recompute(gr0, numValue, undefined, next, { clearMonetaryOverrides: true });
          }
          if (field === "unpaidLeaveDays") {
            const unpaid = Math.max(0, Math.min(dim, Math.round(Number(numValue) || 0)));
            const capped = Math.max(0, dim - unpaid);
            return recompute(gr0, capped, undefined, next, { clearMonetaryOverrides: true });
          }
          if (["incentive", "prBonus", "reimbursement", "tds"].includes(field)) {
            recalcGovTakeHome();
            return next;
          }
          if (field === "takeHome") {
            next.takeHome = numValue;
            return next;
          }
          if (field === "ctc") {
            next.ctc = numValue;
            return next;
          }
          return next;
        }

        const numValue = typeof value === "number" ? value : Number(value) || 0;
        const next = { ...row, [field]: numValue } as typeof row;
        const recalcTakeHome = () => {
          next.takeHome = next.netPay - (next.tds ?? 0) + (next.incentive ?? 0) + (next.prBonus ?? 0) + (next.reimbursement ?? 0);
        };
        const recalcCtc = () => {
          const base = row.ctcBase ?? row.ctc;
          next.ctc = base + (next.incentive ?? 0) + (next.prBonus ?? 0);
        };
        if (field === "payDays") {
          const newPayDays = Math.max(0, Math.min(payDaysMax, numValue));
          const grossMonthly =
            row.grossMonthly ?? Math.round((row.grossPay * payDenom) / (row.payDays || row.rawPayDays || 1));
          next.payDays = newPayDays;
          if (newPayDays > 0) next.payDaysSuppressedMinAttendance = false;
          next.grossPay = newPayDays === 0 ? 0 : Math.round((grossMonthly * newPayDays) / payDenom);
          if (newPayDays === 0) {
            next.profTax = 0;
          } else if (row.payDays === 0 && row.profTax === 0) {
            next.profTax = row.profTaxMonthly ?? companyPt;
          }
          const ratio = row.payDays > 0 && newPayDays > 0 ? newPayDays / row.payDays : newPayDays === 0 ? 0 : 1;
          next.pfEmployee = Math.round(row.pfEmployee * ratio);
          next.pfEmployer = Math.round(row.pfEmployer * ratio);
          next.esicEmployee = Math.round(row.esicEmployee * ratio);
          next.esicEmployer = Math.round(row.esicEmployer * ratio);
          next.deductions = next.pfEmployee + next.esicEmployee + next.profTax;
          next.netPay = next.grossPay - next.deductions;
          recalcTakeHome();
          recalcCtc();
        } else if (["grossPay", "pfEmployee", "esicEmployee", "profTax"].includes(field)) {
          next.deductions = next.pfEmployee + next.esicEmployee + next.profTax;
          next.netPay = next.grossPay - next.deductions;
          recalcTakeHome();
          recalcCtc();
        } else if (field === "deductions") {
          next.netPay = next.grossPay - numValue;
          recalcTakeHome();
          recalcCtc();
        } else if (["incentive", "prBonus", "reimbursement", "tds"].includes(field)) {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "netPay") {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "takeHome") {
          next.takeHome = numValue;
          recalcCtc();
        } else if (field === "ctc") {
          next.ctc = numValue;
        }
        return next;
      })
    );
  }

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setMastersLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/payroll/master?all=1");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load masters");
        if (!cancelled) setMasters(data.masters || []);
      } catch {
        if (!cancelled) setMasters([]);
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  useEffect(() => {
    if (!canManage) return;
    return onHrmsChange(
      (kind) => {
        if (kind !== "payroll_master" && kind !== "employee") return;

        if (kind === "employee" && tab === "slips") {
          setEmployeesLoading(true);
          (async () => {
            try {
              const res = await fetch("/api/employees");
              const data = await res.json();
              const raw = data.employees ?? [];
              const list = buildPayslipEmployeeOptions(raw, masters);
              setEmployees(list);
              setSelectedEmployeeId((prev) => (prev && list.some((e) => e.id === prev) ? prev : ""));
            } catch {
              setEmployees([]);
              setSelectedEmployeeId("");
            } finally {
              setEmployeesLoading(false);
            }
          })();
        }

        if (kind === "payroll_master" || kind === "employee") {
          setMastersLoading(true);
          (async () => {
            try {
              const res = await fetch("/api/payroll/master?all=1");
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error || "Failed to load masters");
              setMasters(data.masters || []);
            } catch {
              setMasters([]);
            } finally {
              setMastersLoading(false);
            }
          })();
        }
      },
      { kinds: ["payroll_master", "employee"] },
    );
  }, [canManage, tab, masters]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company/me");
        const data = await res.json();
        if (cancelled) return;
        const pt = data?.company?.professional_tax_monthly;
        setCompanyPt(pt != null && Number(pt) >= 0 ? Number(pt) : 200);
      } catch {
        if (!cancelled) setCompanyPt(200);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  useEffect(() => {
    if (!masters.length) {
      setMasterGrid([]);
      return;
    }
    setMasterGrid(
      masters
        .map((row) => buildMasterGridRow(row, companyPt))
        .filter((r): r is MasterGridRow => r != null)
    );
  }, [masters, companyPt]);

  const daysInSelectedMonth = new Date(
    parseInt(runYear, 10),
    parseInt(runMonth, 10),
    0
  ).getDate();
  const runDay = String(daysInSelectedMonth);

  useEffect(() => {
    runRowEditsRef.current.clear();
    resolvedPayrollByUserIdRef.current.clear();
    draftPayloadByUserRef.current.clear();
    setDraftMeta(null);
    setDraftDirty(false);
    setDraftRevision(0);
    setResolvedRevision((n) => n + 1);
  }, [runYear, runMonth]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/payroll/drafts?year=${encodeURIComponent(runYear)}&month=${encodeURIComponent(String(parseInt(runMonth, 10)))}`,
        );
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const map = new Map<string, Record<string, unknown>>();
        for (const emp of (data.employees ?? []) as DraftEmployeeApiRow[]) {
          const uid = String(emp.employeeUserId ?? emp.employee_user_id ?? "");
          const payload = (emp.rowPayload ?? emp.row_payload ?? null) as Record<string, unknown> | null;
          if (!uid || !payload) continue;
          map.set(uid, {
            employeeUserId: uid,
            employeeCode: emp.employeeCode ?? emp.employee_code ?? null,
            payrollMasterId: emp.payrollMasterId ?? emp.payroll_master_id ?? null,
            payDays: emp.payDays ?? emp.pay_days ?? null,
            grossPay: emp.grossPay ?? emp.gross_pay ?? null,
            totalEarnings: emp.totalEarnings ?? emp.total_earnings ?? null,
            totalDeductions: emp.totalDeductions ?? emp.total_deductions ?? null,
            totalArrears: emp.totalArrears ?? emp.total_arrears ?? null,
            netPay: emp.netPay ?? emp.net_pay ?? null,
            remarks: emp.remarks ?? null,
            rowPayload: payload,
          });
        }
        draftPayloadByUserRef.current = map;
        // Drop calculated cache so draft payloads win on re-hydrate (keep unsaved edits).
        if (!draftDirtyRef.current) {
          runRowEditsRef.current.clear();
          resolvedPayrollByUserIdRef.current.clear();
        }
        if (data.exists && data.draft) {
          setDraftMeta({
            id: String(data.draft.id),
            version: Number(data.draft.version ?? 1),
            updatedAt: data.draft.updatedAt ?? null,
            employeeCount: Number(data.draft.employeeCount ?? map.size),
          });
          setDraftDirty(false);
        } else {
          setDraftMeta(null);
        }
        setDraftRevision((n) => n + 1);
      } catch {
        /* ignore draft load errors; preview still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, tab, runYear, runMonth]);

  useEffect(() => {
    draftDirtyRef.current = draftDirty;
  }, [draftDirty]);

  useEffect(() => {
    if (!draftDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [draftDirty]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      try {
        const qs = buildPaginatedQuery({
          page: previewPage,
          perPage: previewPerPage,
          search: debouncedPreviewSearch,
          filters: {
            division: previewDivisionName || undefined,
            department: previewDepartmentName || undefined,
          },
        });
        const res = await fetch(
          `/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}&${qs}`,
        );
        const data = await res.json();
        if (!cancelled && res.ok) {
          setPreview(data.preview ?? null);
          setPreviewMeta((data.preview?.meta as PaginationMeta) ?? emptyPaginationMeta(previewPerPage));
          setPayrollConfig(data.payrollConfig ?? data.preview?.payrollConfig ?? null);
        }
        else if (!cancelled) {
          setPreview(null);
          setPreviewMeta(emptyPaginationMeta(previewPerPage));
          setPayrollConfig(null);
        }
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    canManage,
    tab,
    runYear,
    runMonth,
    runDay,
    daysInSelectedMonth,
    previewPage,
    previewPerPage,
    debouncedPreviewSearch,
    previewDivisionName,
    previewDepartmentName,
  ]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    setPastPeriodsLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/payroll/periods");
        const data = await res.json();
        if (!cancelled && res.ok) setPastPeriods(data.periods ?? []);
        else if (!cancelled) setPastPeriods([]);
      } catch {
        if (!cancelled) setPastPeriods([]);
      } finally {
        if (!cancelled) setPastPeriodsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage, tab]);

  /** Master edit dialog is global; close it when navigating to Run / Slips so it cannot look “stuck” after tab switches or refresh confusion. */
  useEffect(() => {
    if (tab !== "master" && editMasterOpen) setEditMasterOpen(null);
  }, [tab, editMasterOpen]);

  const editMasterPreview = useMemo(() => {
    if (!editMasterOpen) return null;
    if (editPayrollMode === "government" && editGovLevel != null) {
      const gb = parseFloat(editGrossBasic) || 0;
      const da = parseFloat(editDaPercent) || 0;
      const hra = parseFloat(editHraPercent) || 0;
      const med = parseFloat(editMedicalFixed) || 0;
      const pt = parseFloat(editGovPtDefault) || 0;
      const cpf = parseFloat(editCpfDefault) || 0;
      const daCpf = parseFloat(editDaCpfDefault) || 0;
      const tds = parseFloat(editTds) || 0;
      const adv = parseFloat(editAdvanceBonus) || 0;
      try {
        const comp = computeGovernmentMonthlyPayroll({
          grossBasic: gb,
          daPercent: da,
          hraPercent: hra,
          medicalFixed: med,
          payLevel: editGovLevel,
          daysInMonth: 30,
          unpaidDays: 0,
          deductionDefaults: {
            incomeTax: tds,
            pt,
            lic: 0,
            cpf,
            daCpf,
            vpf: 0,
            pfLoan: 0,
            postOffice: 0,
            creditSociety: 0,
            stdLicenceFee: 0,
            electricity: 0,
            water: 0,
            mess: 0,
            loanRecovery: 0,
            welfare: 0,
            hpl: 0,
            eol: 0,
            vehCharge: 0,
            other: 0,
            quarterRent: 0,
          },
        });
        const slab = deriveTransportSlabFromLevel(editGovLevel);
        const statutoryCpf =
          comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf;
        return {
          takeHome: comp.netSalary + adv,
          netSalary: comp.netSalary,
          totalEarnings: comp.totalEarnings,
          transportSlab: slab.transportSlabGroup,
          transportBase: slab.transportBase,
          transportAmount: comp.transportPaid,
          effectiveCpfCore: comp.deductions.cpf,
          statutoryCpf,
          storedCpfDefault: cpf,
        };
      } catch {
        return null;
      }
    }
    const gross = parseFloat(editGross) || 0;
    const basic = parseFloat(editBasic) || 0;
    const hra = parseFloat(editHra) || 0;
    const medical = parseFloat(editMedical) || 0;
    const trans = parseFloat(editTrans) || 0;
    const lta = parseFloat(editLta) || 0;
    const personal = parseFloat(editPersonal) || 0;
    const componentsSum = basic + hra + medical + trans + lta + personal;
    const salaryBreakup =
      componentsSum > 0 ? { basic, hra, medical, trans, lta, personal } : undefined;
    const ptParsed = parseFloat(editPt);
    const ptMonthly = Number.isFinite(ptParsed) && ptParsed >= 0 ? ptParsed : companyPt;
    const tds = parseFloat(editTds) || 0;
    const advanceBonus = parseFloat(editAdvanceBonus) || 0;
    const calc = computePayrollFromGross(gross, editPfEligible, editEsicEligible, ptMonthly, salaryBreakup);
    const takeHome = Math.max(0, calc.takeHome - tds + advanceBonus);
    return { ...calc, takeHome, ptMonthly, tds, advanceBonus };
  }, [
    editMasterOpen,
    editPayrollMode,
    editGovLevel,
    editGrossBasic,
    editDaPercent,
    editHraPercent,
    editMedicalFixed,
    editGovPtDefault,
    editCpfDefault,
    editDaCpfDefault,
    editGross,
    editBasic,
    editHra,
    editMedical,
    editTrans,
    editLta,
    editPersonal,
    editPfEligible,
    editEsicEligible,
    editPt,
    editTds,
    editAdvanceBonus,
    companyPt,
  ]);

  const masterHasGovernment = useMemo(
    () => masterGrid.some((r) => r.payrollMode === "government"),
    [masterGrid]
  );

  function patchMasterGridRow(employeeUserId: string, patch: Partial<MasterGridRow>) {
    setMasterGrid((prev) =>
      prev.map((r) => {
        if (r.employeeUserId !== employeeUserId) return r;
        const next = { ...r, ...patch };
        if (next.payrollMode === "government") {
          if (patch.tds !== undefined && patch.incomeTaxDefault === undefined) {
            next.incomeTaxDefault = next.tds;
          }
          if (patch.incomeTaxDefault !== undefined && patch.tds === undefined) {
            next.tds = next.incomeTaxDefault;
          }
          return { ...next, ...computeGovernmentMasterDerived(next) };
        }
        const stat = computeRowStatutory(next);
        return { ...next, ...stat };
      })
    );
  }

  function undoMasterGridRow(employeeUserId: string) {
    const snap = masters.find((m) => m.employeeUserId === employeeUserId);
    if (!snap) return;
    const rebuilt = buildMasterGridRow(snap, companyPt);
    if (!rebuilt) return;
    setMasterGrid((prev) => prev.map((r) => (r.employeeUserId === employeeUserId ? rebuilt : r)));
  }

  /** Opens the salary breakup modal from the current grid row (includes unsaved inline edits). */
  function openPayrollMasterEditDialog(gridRow: MasterGridRow, apiRow?: any) {
    const gross = gridRow.gross;
    const componentsSum =
      gridRow.basic + gridRow.hra + gridRow.medical + gridRow.trans + gridRow.lta + gridRow.personal;
    /** If stored components don’t add up to gross, use the standard split for gross (Basic 50%, HRA 20%, etc.). */
    const split =
      gross > 0 &&
      (componentsSum === 0 || Math.abs(componentsSum - gross) > 2)
        ? defaultSalaryBreakup(gross)
        : componentsSum > 0
          ? {
              basic: gridRow.basic,
              hra: gridRow.hra,
              medical: gridRow.medical,
              trans: gridRow.trans,
              lta: gridRow.lta,
              personal: gridRow.personal,
            }
          : defaultSalaryBreakup(gross);
    setEditMasterTab("structure");
    setEditBankName(String(apiRow?.bankName ?? ""));
    setEditBankAccountHolderName(
      String(apiRow?.bankAccountHolderName ?? apiRow?.employeeName ?? gridRow.employeeName ?? ""),
    );
    setEditBankAccountNumber(String(apiRow?.bankAccountNumber ?? ""));
    setEditBankIfsc(String(apiRow?.bankIfsc ?? ""));
    setEditBankError(null);
    setEditMasterOpen({
      employeeUserId: gridRow.employeeUserId,
      employeeName: gridRow.employeeName,
      employeeEmail: gridRow.employeeEmail,
      master: { grossSalary: gross },
    });
    setEditGross(String(gross || ""));
    setEditBasic(String(split.basic));
    setEditHra(String(split.hra));
    setEditMedical(String(split.medical));
    setEditTrans(String(split.trans));
    setEditLta(String(split.lta));
    setEditPersonal(String(split.personal));
    setEditPfEligible(gridRow.pfEligible);
    setEditEsicEligible(gridRow.esicEligible);
    setEditEffectiveDate(
      gridRow.effectiveStartDate
        ? String(gridRow.effectiveStartDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    );
    const mpt = gridRow.pt;
    setEditPt(mpt != null && Number(mpt) >= 0 ? String(mpt) : String(companyPt));
    setEditTds(String(gridRow.tds ?? 0));
    setEditAdvanceBonus(String(gridRow.advanceBonus ?? 0));
    setEditReason("UpdateOnly");

    const m = apiRow?.master;
    setEditPayrollMode(gridRow.payrollMode === "government" ? "government" : "private");
    setEditGovLevel(gridRow.governmentPayLevel);
    if (gridRow.payrollMode === "government") {
      setEditGrossBasic(String(gridRow.gross));
      setEditDaPercent(String(gridRow.daPercent));
      setEditHraPercent(String(gridRow.hraPercent));
      setEditMedicalFixed(String(gridRow.medicalFixed));
      setEditGovPtDefault(String(gridRow.pt));
      setEditCpfDefault(String(gridRow.cpfDefault));
      setEditDaCpfDefault(String(gridRow.daCpfDefault));
      setEditTds(String(gridRow.incomeTaxDefault ?? gridRow.tds ?? 0));
    } else {
      setEditGrossBasic(String(m?.grossBasic ?? gridRow.gross ?? ""));
      setEditDaPercent(String(m?.daPercent ?? 53));
      setEditHraPercent(String(m?.hraPercent ?? 30));
      setEditMedicalFixed(String(m?.medicalFixed ?? 3000));
      setEditGovPtDefault(String(m?.ptDefault ?? m?.pt ?? 200));
      setEditCpfDefault(String(m?.cpfDefault ?? 0));
      setEditDaCpfDefault(String(m?.daCpfDefault ?? 0));
    }
  }

  async function saveMasterGridRow(employeeUserId: string) {
    const row = masterGrid.find((r) => r.employeeUserId === employeeUserId);
    if (!row) return;
    if (!row.effectiveStartDate) {
      showToast("error", "Set applicable month / effective start date before saving.");
      return;
    }
    setMasterRowSaving(employeeUserId);
    try {
      if (row.payrollMode === "government") {
        if (row.governmentPayLevel == null) {
          showToast("error", "Set Government pay level on the employee profile before saving.");
          setMasterRowSaving(null);
          return;
        }
        const res = await fetch("/api/payroll/master", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeUserId,
            payrollMode: "government",
            grossBasic: row.gross,
            daPercent: row.daPercent,
            hraPercent: row.hraPercent,
            medicalFixed: row.medicalFixed,
            pfEligible: true,
            esicEligible: false,
            effectiveStartDate: row.effectiveStartDate,
            reasonForChange: "Payroll master grid",
            ptDefault: row.pt,
            cpfDefault: row.cpfDefault,
            daCpfDefault: row.daCpfDefault,
            incomeTaxDefault: row.incomeTaxDefault,
            tds: row.tds,
            advanceBonus: row.advanceBonus,
            licDefault: row.licDefault,
            messDefault: row.messDefault,
            welfareDefault: row.welfareDefault,
            vpfDefault: row.vpfDefault,
            pfLoanDefault: row.pfLoanDefault,
            postOfficeDefault: row.postOfficeDefault,
            creditSocietyDefault: row.creditSocietyDefault,
            stdLicenceFeeDefault: row.stdLicenceFeeDefault,
            electricityDefault: row.electricityDefault,
            waterDefault: row.waterDefault,
            loanRecoveryDefault: row.loanRecoveryDefault,
            vehChargeDefault: row.vehChargeDefault,
            otherDeductionDefault: row.otherDeductionDefault,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to update");
        showToast("success", "Payroll master updated");
        dispatchHrmsChange("payroll_master");
        const refresh = await fetch("/api/payroll/master?all=1");
        const refreshData = await refresh.json();
        if (refresh.ok) setMasters(refreshData.masters || []);
        setMasterRowSaving(null);
        return;
      }
      const res = await fetch("/api/payroll/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeUserId,
          grossSalary: row.gross,
          basic: row.basic,
          hra: row.hra,
          medical: row.medical,
          trans: row.trans,
          lta: row.lta,
          personal: row.personal,
          pfEligible: row.pfEligible,
          esicEligible: row.esicEligible,
          effectiveStartDate: row.effectiveStartDate,
          reasonForChange: "Payroll master grid",
          pt: row.pt,
          tds: row.tds,
          advanceBonus: row.advanceBonus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update");
      showToast("success", "Payroll master updated");
      dispatchHrmsChange("payroll_master");
      const refresh = await fetch("/api/payroll/master?all=1");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to update");
    } finally {
      setMasterRowSaving(null);
    }
  }

  async function saveEditMasterBank() {
    if (!editMasterOpen) return;
    const bankErr = validateBankDetails({
      bankName: editBankName,
      bankAccountHolderName: editBankAccountHolderName,
      bankAccountNumber: normalizeDigits(editBankAccountNumber),
      bankIfsc: editBankIfsc,
      legalName: editMasterOpen.employeeName ?? "",
    });
    if (bankErr) {
      setEditBankError(bankErr);
      showToast("error", bankErr);
      return;
    }
    setEditSaving(true);
    setEditBankError(null);
    try {
      const res = await fetch("/api/payroll/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeUserId: editMasterOpen.employeeUserId,
          updateBankOnly: true,
          bankName: editBankName.trim(),
          bankAccountHolderName: editBankAccountHolderName.trim(),
          bankAccountNumber: normalizeDigits(editBankAccountNumber),
          bankIfsc: normalizeIfscInput(editBankIfsc),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save bank details");
      showToast("success", "Bank details updated");
      dispatchHrmsChange("payroll_master");
      setEditMasterOpen(null);
      setEditMasterTab("structure");
      const refresh = await fetch("/api/payroll/master?all=1");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to save bank details");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSaveMaster(e: FormEvent) {
    e.preventDefault();
    if (!editMasterOpen) return;
    if (editMasterTab === "bank") {
      await saveEditMasterBank();
      return;
    }
    setEditSaving(true);
    try {
      const pt = parseFloat(editPt);
      const tds = parseFloat(editTds) || 0;
      const advanceBonus = parseFloat(editAdvanceBonus) || 0;
      if (editPayrollMode === "government") {
        if (editGovLevel == null) {
          showToast("error", "Set Government pay level on the employee profile before saving.");
          setEditSaving(false);
          return;
        }
        const gb = parseFloat(editGrossBasic) || 0;
        if (gb <= 0) {
          showToast("error", "Gross basic is required.");
          setEditSaving(false);
          return;
        }
        const res = await fetch("/api/payroll/master", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeUserId: editMasterOpen.employeeUserId,
            payrollMode: "government",
            grossBasic: gb,
            daPercent: parseFloat(editDaPercent) || 53,
            hraPercent: parseFloat(editHraPercent) || 30,
            medicalFixed: parseFloat(editMedicalFixed) || 3000,
            pfEligible: true,
            esicEligible: false,
            effectiveStartDate: editEffectiveDate,
            reasonForChange: editReason,
            tds,
            advanceBonus,
            ptDefault: parseFloat(editGovPtDefault) || 200,
            cpfDefault: parseFloat(editCpfDefault) || 0,
            daCpfDefault: parseFloat(editDaCpfDefault) || 0,
            incomeTaxDefault: tds,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to update");
        showToast("success", "Payroll master updated");
      dispatchHrmsChange("payroll_master");
        setEditMasterOpen(null);
        const refresh = await fetch("/api/payroll/master?all=1");
        const refreshData = await refresh.json();
        if (refresh.ok) setMasters(refreshData.masters || []);
        setEditSaving(false);
        return;
      }
      const gross = parseFloat(editGross) || 0;
      const basic = parseFloat(editBasic) || 0;
      const hra = parseFloat(editHra) || 0;
      const medical = parseFloat(editMedical) || 0;
      const trans = parseFloat(editTrans) || 0;
      const lta = parseFloat(editLta) || 0;
      const personal = parseFloat(editPersonal) || 0;
      const res = await fetch("/api/payroll/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeUserId: editMasterOpen.employeeUserId,
          payrollMode: "private",
          grossSalary: gross,
          basic: basic || undefined,
          hra: hra || undefined,
          medical: medical || undefined,
          trans: trans || undefined,
          lta: lta || undefined,
          personal: personal || undefined,
          pfEligible: editPfEligible,
          esicEligible: editEsicEligible,
          effectiveStartDate: editEffectiveDate,
          reasonForChange: editReason,
          pt: Number.isFinite(pt) && pt >= 0 ? pt : undefined,
          tds,
          advanceBonus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update");
      showToast("success", "Payroll master updated");
      dispatchHrmsChange("payroll_master");
      setEditMasterOpen(null);
      const refresh = await fetch("/api/payroll/master?all=1");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to update");
    } finally {
      setEditSaving(false);
    }
  }

  function mergeRunRowWithEditsAndDraft(r: (typeof editableRows)[number]): (typeof editableRows)[number] {
    const uid = String(r.employeeUserId ?? "");
    const denom = preview?.daysInMonth ?? preview?.workingDaysInFullMonth ?? 30;
    const cached =
      (runRowEditsRef.current.get(uid) as RunPayrollRowLike | undefined) ??
      resolvedPayrollByUserIdRef.current.get(uid);
    const resolved = resolveRunPayrollRow(r as RunPayrollRowLike, {
      denom,
      runYear: parseInt(runYear, 10),
      runMonth: parseInt(runMonth, 10),
      payrollConfig,
      alreadyRun: Boolean(preview?.alreadyRun),
      draftDirty: draftDirtyRef.current,
      cached: cached ?? null,
      draftStored: draftPayloadByUserRef.current.get(uid) ?? null,
    });
    resolvedPayrollByUserIdRef.current.set(uid, resolved);
    return resolved as (typeof editableRows)[number];
  }

  /** Full canonical payroll set for save/export/totals (never page/filter-limited). */
  async function collectAllRunRowsForExport(): Promise<typeof editableRows> {
    const params = new URLSearchParams({
      year: runYear,
      month: runMonth,
      runDay,
      all: "1",
    });
    const previewRes = await fetch(`/api/payroll/run?${params.toString()}`);
    const previewData = await previewRes.json();
    if (!previewRes.ok) {
      throw new Error(previewData?.error || "Failed to load payroll rows");
    }
    const allRows = (previewData.preview?.rows ?? []) as typeof editableRows;
    const denom =
      previewData.preview?.daysInMonth ??
      previewData.preview?.workingDaysInFullMonth ??
      preview?.daysInMonth ??
      preview?.workingDaysInFullMonth ??
      30;
    const runY = parseInt(runYear, 10);
    const runM = parseInt(runMonth, 10);
    const alreadyRun = Boolean(previewData.preview?.alreadyRun ?? preview?.alreadyRun);
    const resolved = allRows.map((r) => {
      const uid = String(r.employeeUserId ?? "");
      const cached =
        (runRowEditsRef.current.get(uid) as RunPayrollRowLike | undefined) ??
        resolvedPayrollByUserIdRef.current.get(uid);
      const row = resolveRunPayrollRow(r as RunPayrollRowLike, {
        denom,
        runYear: runY,
        runMonth: runM,
        payrollConfig: previewData.payrollConfig ?? payrollConfig,
        alreadyRun,
        draftDirty: draftDirtyRef.current,
        cached: cached ?? null,
        draftStored: draftPayloadByUserRef.current.get(uid) ?? null,
      });
      resolvedPayrollByUserIdRef.current.set(uid, row);
      return row as (typeof editableRows)[number];
    });
    setResolvedRevision((n) => n + 1);
    const stubs = resolved.filter((r) => isZeroStubPayrollRow(r as RunPayrollRowLike));
    if (stubs.length > 0) {
      throw new Error(
        `Cannot continue: ${stubs.length} employee row(s) still lack computed payroll values. Reload and try again.`,
      );
    }
    return resolved;
  }

  // Prefetch full period into the canonical map so totals/save/export never depend on the current page.
  useEffect(() => {
    if (!canManage || tab !== "run") return;
    if (preview?.alreadyRun) return;
    const expected = Number(previewMeta.total || 0);
    if (expected <= 0 && draftPayloadByUserRef.current.size === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await collectAllRunRowsForExport();
        if (cancelled) return;
      } catch {
        /* prefetch is best-effort; save/export still resolve on demand */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canManage,
    tab,
    runYear,
    runMonth,
    runDay,
    draftRevision,
    preview?.alreadyRun,
    previewMeta.total,
  ]);

  function workbookStatus(): PayrollWorkbookStatus {
    if (preview?.alreadyRun) return "Finalized";
    if (draftDirty) return "Unsaved Preview";
    if (draftMeta) return "Draft";
    return "Calculated Preview";
  }

  async function savePayrollDraft(): Promise<boolean> {
    if (preview?.alreadyRun) {
      showToast("error", "Finalized payroll cannot be saved as a draft.");
      return false;
    }
    setDraftSaving(true);
    try {
      const rows = await collectAllRunRowsForExport();
      if (rows.length === 0) {
        throw new Error("No employees to save in draft.");
      }
      const employees = rows.map((r) => {
        const anyRow = r as Record<string, unknown>;
        const gm = (anyRow.governmentMonthly ?? null) as Record<string, unknown> | null;
        const totalEarnings =
          typeof gm?.totalEarnings === "number"
            ? gm.totalEarnings
            : typeof r.grossPay === "number"
              ? r.grossPay
              : null;
        const daArr = Number(anyRow.daArrear ?? gm?.daArrearsPaid ?? 0) || 0;
        const trArr = Number(anyRow.transportArrear ?? gm?.transportArrearsPaid ?? 0) || 0;
        const grossArr = Number(anyRow.grossArrear ?? gm?.grossArrear ?? 0) || 0;
        return {
          employeeUserId: r.employeeUserId,
          employeeCode: (anyRow.employeeCode as string | null | undefined) ?? null,
          payrollMasterId: (anyRow.payrollMasterId as string | null | undefined) ?? null,
          payDays: r.payDays,
          grossPay: r.grossPay,
          totalEarnings,
          totalDeductions: r.deductions,
          totalArrears: Math.round(daArr + trArr + grossArr),
          netPay: r.netPay,
          remarks: r.govRecalc?.leaveRemarks ?? null,
          rowPayload: r,
        };
      });
      const res = await fetch("/api/payroll/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(runYear, 10),
          month: parseInt(runMonth, 10),
          version: draftMeta?.version ?? undefined,
          replaceAllEmployees: true,
          employees,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.message || data?.errors?.version?.[0] || "Failed to save draft");
      }
      const expected = employees.length;
      const savedCount = Number(
        data.savedEmployeeCount ?? data.saved_employee_count ?? data.saved ?? expected,
      );
      const distinctCount = Number(
        data.distinctEmployeeCount ?? data.distinct_employee_count ?? savedCount,
      );
      if (savedCount !== expected || distinctCount !== expected) {
        throw new Error(
          `Draft save incomplete: expected ${expected} employees, saved ${savedCount} (distinct ${distinctCount}).`,
        );
      }
      const map = new Map<string, Record<string, unknown>>();
      for (const emp of (data.employees ?? []) as DraftEmployeeApiRow[]) {
        const uid = String(emp.employeeUserId ?? emp.employee_user_id ?? "");
        const payload = (emp.rowPayload ?? emp.row_payload ?? null) as Record<string, unknown> | null;
        if (!uid || !payload) continue;
        map.set(uid, {
          employeeUserId: uid,
          employeeCode: emp.employeeCode ?? emp.employee_code ?? null,
          payrollMasterId: emp.payrollMasterId ?? emp.payroll_master_id ?? null,
          payDays: emp.payDays ?? emp.pay_days ?? null,
          grossPay: emp.grossPay ?? emp.gross_pay ?? null,
          totalEarnings: emp.totalEarnings ?? emp.total_earnings ?? null,
          totalDeductions: emp.totalDeductions ?? emp.total_deductions ?? null,
          totalArrears: emp.totalArrears ?? emp.total_arrears ?? null,
          netPay: emp.netPay ?? emp.net_pay ?? null,
          remarks: emp.remarks ?? null,
          rowPayload: payload,
        });
      }
      if (map.size !== expected) {
        throw new Error(
          `Draft save incomplete: expected ${expected} employee payloads, received ${map.size}.`,
        );
      }
      draftPayloadByUserRef.current = map;
      setDraftMeta({
        id: String(data.draft.id),
        version: Number(data.draft.version ?? 1),
        updatedAt: data.draft.updatedAt ?? null,
        employeeCount: Number(data.draft.employeeCount ?? map.size),
      });
      setDraftDirty(false);
      setDraftRevision((n) => n + 1);
      showToast("success", `Draft saved (${expected} employees).`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save draft";
      showToast("error", msg);
      return false;
    } finally {
      setDraftSaving(false);
    }
  }

  async function resetPayrollDraft() {
    if (preview?.alreadyRun) return;
    const hasDraft = Boolean(draftMeta);
    const ok = window.confirm(
      hasDraft
        ? "Discard the saved draft and recalculate from Payroll Master? This cannot be undone."
        : "Discard unsaved edits and recalculate from Payroll Master?",
    );
    if (!ok) return;
    setDraftSaving(true);
    try {
      if (hasDraft) {
        const res = await fetch(
          `/api/payroll/drafts?year=${encodeURIComponent(runYear)}&month=${encodeURIComponent(String(parseInt(runMonth, 10)))}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || data?.message || "Failed to reset draft");
      }
      runRowEditsRef.current.clear();
      resolvedPayrollByUserIdRef.current.clear();
      draftPayloadByUserRef.current.clear();
      setDraftMeta(null);
      setDraftDirty(false);
      // Force preview reload
      setPreview(null);
      setPreviewLoading(true);
      const qs = buildPaginatedQuery({
        page: previewPage,
        perPage: previewPerPage,
        search: debouncedPreviewSearch,
        filters: {
          division: previewDivisionName || undefined,
          department: previewDepartmentName || undefined,
        },
      });
      const res = await fetch(`/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}&${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to reload calculation");
      setPreview(data.preview ?? null);
      setPreviewMeta((data.preview?.meta as PaginationMeta) ?? emptyPaginationMeta(previewPerPage));
      setPayrollConfig(data.payrollConfig ?? data.preview?.payrollConfig ?? null);
      showToast("success", "Reset to calculation.");
    } catch (err: unknown) {
      showToast("error", err instanceof Error ? err.message : "Reset failed");
    } finally {
      setDraftSaving(false);
      setPreviewLoading(false);
    }
  }

  async function downloadRunExcel(kind: "detail" | "summary") {
    try {
      const rows = await collectAllRunRowsForExport();
      if (rows.length === 0) {
        showToast("error", "No employees to export.");
        return;
      }
      downloadPayrollRunWorkbook(
        rows.map((r) => {
          const anyRow = r as Record<string, unknown>;
          return {
            employeeUserId: r.employeeUserId,
            employeeName: r.employeeName,
            employeeCode: (anyRow.employeeCode as string | null | undefined) ?? null,
            payDays: r.payDays,
            grossPay: r.grossPay,
            netPay: r.netPay,
            deductions: r.deductions,
            incentive: r.incentive,
            prBonus: r.prBonus,
            reimbursement: r.reimbursement,
            tds: r.tds,
            ctc: r.ctc,
            takeHome: r.takeHome,
            bankAccountNumber: (anyRow.bankAccountNumber as string | null | undefined) ?? null,
            payrollMode: r.payrollMode,
            governmentMonthly: r.governmentMonthly as Record<string, unknown> | null,
          };
        }),
        {
          month: parseInt(runMonth, 10),
          year: parseInt(runYear, 10),
          status: workbookStatus(),
          includeDetail: kind === "detail",
          includeSummary: kind === "summary" || kind === "detail",
          filename:
            kind === "summary"
              ? payrollExtractWorkbookFilename(runMonth, runYear)
              : payrollDetailWorkbookFilename(runMonth, runYear),
        },
      );
    } catch (err: unknown) {
      showToast("error", err instanceof Error ? err.message : "Export failed");
    }
  }

  async function downloadBankLetter() {
    setBankLetterLoading(true);
    try {
      const rows = await collectAllRunRowsForExport();
      if (rows.length === 0) {
        showToast("error", "Bank letter cannot be generated. No employees were provided.");
        return;
      }
      const employees = rows.map((r) =>
        mapRowToBankLetterEmployee(r as BankLetterEmployeeInput & Record<string, unknown>),
      );
      const validated = validateBankLetterEmployees(employees);
      if (!validated.ok) {
        showToast("error", validated.message);
        return;
      }

      const source = preview?.alreadyRun
        ? "finalized"
        : draftDirty
          ? "unsaved"
          : draftMeta
            ? "draft"
            : "calculated";

      const res = await fetch("/api/payroll/bank-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(runYear, 10),
          month: parseInt(runMonth, 10),
          source,
          employeeCount: employees.length,
          draftId: draftMeta?.id ?? undefined,
          draftVersion: draftMeta?.version ?? undefined,
          employees,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        let message = "Failed to download bank letter";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          message =
            data?.error ||
            data?.message ||
            data?.errors?.employees?.[0] ||
            (typeof data?.errors === "object"
              ? Object.values(data.errors as Record<string, string[]>).flat()[0]
              : null) ||
            message;
        }
        showToast("error", message);
        return;
      }

      const blob = await res.blob();
      const filename = payrollBankLetterFilename(runMonth, runYear);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      showToast("error", err instanceof Error ? err.message : "Failed to download bank letter");
    } finally {
      setBankLetterLoading(false);
    }
  }

  async function handleRunPayroll(e: FormEvent) {
    e.preventDefault();
    if (draftDirty) {
      const ok = window.confirm(
        "You have unsaved draft changes. Save Draft before Generate so finalized values stay auditable.\n\nClick OK to save draft first, or Cancel to abort.",
      );
      if (!ok) return;
      const saved = await savePayrollDraft();
      if (!saved) return;
    }
    const sourceLabel = draftMeta
      ? "saved draft values"
      : "current calculated preview values";
    if (
      !window.confirm(
        `Generate / finalize payroll for ${runMonth}/${runYear} using ${sourceLabel}?\n\nThis creates salary slips and cannot be undone from this screen.`,
      )
    ) {
      return;
    }
    setRunError(null);
    setRunning(true);
    try {
      const useCompleteMissing = Boolean(preview?.alreadyRun && preview?.payrollComplete === false);
      const params = new URLSearchParams({
        year: runYear,
        month: runMonth,
        runDay,
        all: "1",
      });

      const previewRes = await fetch(`/api/payroll/run?${params.toString()}`);
      const previewData = await previewRes.json();
      if (!previewRes.ok) {
        throw new Error(previewData?.error || "Failed to load payroll rows for generation");
      }

      const allRows = (previewData.preview?.rows ?? []) as typeof editableRows;
      const sourceRows = (useCompleteMissing
        ? allRows.filter((r) => r.payslipPending)
        : allRows
      ).map((r) => mergeRunRowWithEditsAndDraft(r));

      if (useCompleteMissing && sourceRows.length === 0) {
        throw new Error("No pending employees to add payslips for.");
      }
      if (!useCompleteMissing && sourceRows.length === 0) {
        throw new Error("No employees to generate payroll for.");
      }
      const rowsPayload = sourceRows.map((r) => ({
        employeeUserId: r.employeeUserId,
        payDays: r.payDays,
        grossPay: r.grossPay,
        netPay: r.netPay,
        pfEmployee: r.pfEmployee,
        pfEmployer: r.pfEmployer,
        esicEmployee: r.esicEmployee,
        esicEmployer: r.esicEmployer,
        profTax: r.profTax,
        deductions: r.deductions,
        incentive: r.incentive ?? 0,
        prBonus: r.prBonus ?? 0,
        reimbursement: r.reimbursement ?? 0,
        tds: r.tds ?? 0,
        takeHome: r.takeHome,
        ctc: r.ctc,
        arrearLineIds: Array.isArray(r.arrearLineIds)
          ? r.arrearLineIds
          : Array.isArray(r.arrearLines)
            ? r.arrearLines
                .map((line) => line?.id)
                .filter((id): id is string => typeof id === "string" && id.length > 0)
            : [],
        ...(r.payrollMode === "government" && r.govRecalc
          ? {
              payrollMode: r.payrollMode,
              leaveRemarks: r.govRecalc.leaveRemarks ?? null,
              governmentMonthly: {
                ...(typeof r.governmentMonthly === "object" && r.governmentMonthly
                  ? (r.governmentMonthly as Record<string, unknown>)
                  : {}),
                leaveRemarks: r.govRecalc.leaveRemarks ?? null,
              },
              governmentDeductionDefaults: r.govRecalc.deductionDefaults,
              governmentEarningPaidOverrides: r.govRecalc.earningPaidOverrides,
            }
          : {}),
      }));
      const res = await fetch("/api/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useCompleteMissing
            ? {
                year: parseInt(runYear, 10),
                month: parseInt(runMonth, 10),
                runDay: parseInt(runDay, 10),
                completeMissingPayslips: true,
                rows: rowsPayload,
              }
            : {
                year: parseInt(runYear, 10),
                month: parseInt(runMonth, 10),
                runDay: parseInt(runDay, 10),
                rows: rowsPayload,
              },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        const firstFieldError =
          data?.errors && typeof data.errors === "object"
            ? Object.values(data.errors as Record<string, string[]>).flat()[0]
            : undefined;
        throw new Error(data?.message || firstFieldError || data?.error || "Failed to run payroll");
      }
      showToast(
        "success",
        useCompleteMissing
          ? `Added ${data.payslipsGenerated} missing payslip(s). Excel updated.`
          : `Payroll generated: ${data.payslipsGenerated} payslips. Excel saved to storage.`,
      );
      dispatchHrmsChange("payroll_period");
      runRowEditsRef.current.clear();
      resolvedPayrollByUserIdRef.current.clear();
      draftPayloadByUserRef.current.clear();
      setDraftMeta(null);
      setDraftDirty(false);
      // Stay on Run tab and refetch preview to show generated records + Download Excel
      const refreshRes = await fetch(
        `/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}`
      );
      const refreshData = await refreshRes.json();
      if (refreshRes.ok && refreshData.preview) {
        setPreview(refreshData.preview);
        setPayrollConfig(refreshData.payrollConfig ?? null);
      }
    } catch (e: any) {
      setRunError(e?.message || "Failed to run payroll");
      showToast("error", e?.message || "Failed to run payroll");
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) {
    return null;
  }

  const payrollPageTitle = tab === "run" ? "Run Payroll" : "Salary Slips";
  const runInitialLoading = tab === "run" && previewLoading && preview === null;
  const slipsPageLoading =
    tab === "slips" && (employeesLoading || (Boolean(selectedEmployeeId) && slipsLoading));

                        return (
    <section className="flex min-h-0 flex-col gap-3">
      <PageHeader title={payrollPageTitle} className="!mb-0" />

      {runInitialLoading ? (
        <AppPageLoader message="Loading payroll run..." />
      ) : tab === "run" && (
            <form
          onSubmit={handleRunPayroll}
          className="page-workspace flex min-h-[min(calc(100dvh-9rem),820px)] flex-col overflow-hidden"
        >
          <PayrollPreviewToolbar
            runMonth={runMonth}
            runYear={runYear}
            onMonthChange={(v) => {
              if (draftDirty && !window.confirm("You have unsaved changes. Switch month anyway?")) return;
              setRunMonth(v);
            }}
            onYearChange={(v) => {
              if (draftDirty && !window.confirm("You have unsaved changes. Switch year anyway?")) return;
              setRunYear(v);
            }}
            periodName={preview?.periodName}
            running={running}
            generateDisabled={
              (!!preview?.alreadyRun && preview?.payrollComplete !== false) ||
              (editableRows.length > 0 && filteredEditableRows.length === 0)
            }
            generateLabel={
              preview?.alreadyRun && preview?.payrollComplete === false
                ? hasActiveRunFilters
                  ? "Add missing (filtered)"
                  : "Add missing payslips"
                : hasActiveRunFilters && (previewDivisionFilter || previewDepartmentFilter)
                  ? "Generate (filtered)"
                  : "Generate"
            }
            search={previewSearch}
            onSearchChange={(v) => {
              setPreviewSearch(v);
              setPreviewPage(1);
            }}
            divisionFilter={previewDivisionFilter}
            onDivisionFilterChange={(v) => {
              setPreviewDivisionFilter(v);
              setPreviewDepartmentFilter("");
              setPreviewPage(1);
            }}
            divisionOptions={runDivisionFilterOptions}
            departmentFilter={previewDepartmentFilter}
            onDepartmentFilterChange={(v) => {
              setPreviewDepartmentFilter(v);
              setPreviewPage(1);
            }}
            departmentOptions={runDepartmentFilterOptions}
            orgFiltersLoading={runOrgFiltersLoading}
            totals={previewTotals}
            filteredCount={filteredEditableRows.length}
            totalCount={previewMeta.total || editableRows.length}
            statusKind={
              preview?.alreadyRun
                ? "finalized"
                : draftDirty
                  ? "unsaved"
                  : draftMeta
                    ? "draft"
                    : "calculated"
            }
            statusLabel={
              preview?.alreadyRun
                ? `${previewMeta.total || editableRows.length} employees • Finalized`
                : draftDirty
                  ? `${previewMeta.total || editableRows.length} employees • Unsaved changes`
                  : draftMeta
                    ? `${draftMeta.employeeCount || previewMeta.total || editableRows.length} employees • Draft saved${
                        draftMeta.updatedAt
                          ? ` at ${new Date(draftMeta.updatedAt).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}`
                          : ""
                      }`
                    : `${previewMeta.total || editableRows.length} employees • Calculated`
            }
            draftSaving={draftSaving}
            saveDraftDisabled={!draftDirty || !!preview?.alreadyRun || editableRows.length === 0}
            onSaveDraft={() => void savePayrollDraft()}
            onResetDraft={() => void resetPayrollDraft()}
            resetDisabled={!!preview?.alreadyRun || (!draftDirty && !draftMeta)}
            onDownloadPreviewExcel={() => void downloadRunExcel("detail")}
            onExportMonthlySummary={() => void downloadRunExcel("summary")}
            onDownloadBankLetter={() => void downloadBankLetter()}
            bankLetterLoading={bankLetterLoading}
            exportDisabled={editableRows.length === 0 && !draftMeta && !preview?.alreadyRun}
          >
              {runError && <p className="text-sm text-red-600">{runError}</p>}
              {preview?.alreadyRun && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-900">
                    Payroll already run for this period.
                  {preview.payrollComplete === false && typeof preview.missingPayslipCount === "number"
                    ? ` ${preview.missingPayslipCount} missing slip(s).`
                    : null}
                      </span>
                  {preview?.existingPeriodId && payrollExportUrl && (
                    <a
                      href={payrollExportUrl}
                      download
                    className="btn btn-outline btn-sm"
                    >
                      Download Excel{hasActiveRunFilters ? " (filtered)" : ""}
                    </a>
                  )}
                </div>
              )}
          </PayrollPreviewToolbar>

          <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
              {previewLoading ? (
              <AppPageLoader variant="inline" message="Loading payroll run..." submessage="" />
              ) : editableRows.length ? (
              filteredEditableRows.length ? (
                previewAllGovernment && preview?.daysInMonth ? (
                    <GovernmentRunPreviewTable
                    rows={filteredEditableRows as GovernmentRunPreviewRow[]}
                    runYear={parseInt(runYear, 10)}
                    runMonth={parseInt(runMonth, 10)}
                      daysInMonth={preview.daysInMonth}
                    effectiveRunDay={
                      preview.effectiveRunDay ?? preview.workingDaysThroughRunDay ?? preview.daysInMonth
                    }
                      readOnly={!!preview?.alreadyRun || running}
                      customEarningFields={runPayrollCustomEarningFields}
                      customDeductionFields={runPayrollCustomDeductionFields}
                      onUpdate={updateEditableRow}
                    />
                ) : preview?.daysInMonth ? (
                  <PrivateRunPreviewCards
                    rows={filteredEditableRows}
                    daysInMonth={preview.daysInMonth}
                    effectiveRunDay={
                      preview.effectiveRunDay ?? preview.workingDaysThroughRunDay ?? preview.daysInMonth
                    }
                    readOnly={!!preview?.alreadyRun || running}
                    pfLabel={previewHasGovernment ? "CPF" : "PF"}
                    onUpdate={updateEditableRow}
                  />
                ) : null
              ) : (
                <EmptyState
                  title="No matches"
                  description="Try a different division, department, or search term."
                />
              )
            ) : !preview?.alreadyRun ? (
              <EmptyState
                title="No payroll data"
                description="Generate payroll for the selected month, or add employees in Payroll Master."
              />
            ) : null}
            {editableRows.length > 0 ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <PaginationControls
                  meta={previewMeta}
                  loading={previewLoading}
                  onPageChange={setPreviewPage}
                  onPerPageChange={(n) => {
                    setPreviewPerPage(n);
                    setPreviewPage(1);
                  }}
                />
              </div>
            ) : null}
          </div>
        </form>
      )}

      {slipsPageLoading ? (
        <AppPageLoader message="Loading salary slips..." />
      ) : tab === "slips" && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 pb-3">
            <SelectField
              label="Employee"
                value={selectedEmployeeId}
              onChange={setSelectedEmployeeId}
              loading={employeesLoading}
              searchable
              placeholder="Select employee"
              options={employees.map((e) => ({
                value: e.id,
                label: e.name || e.email || e.id,
              }))}
              className="min-w-[220px] flex-1 max-w-sm"
            />
            {selectedEmployeeId && slipsData && (
              <>
                <SelectField
                  label="Month"
                    value={slipMonth}
                  onChange={setSlipMonth}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({
                    value: String(m).padStart(2, "0"),
                    label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1],
                  }))}
                  className="w-28"
                />
                <SelectField
                  label="Year"
                    value={slipYear}
                  onChange={setSlipYear}
                  options={(() => {
                      const joinYear = slipsData.user?.dateOfJoining
                        ? parseInt(slipsData.user.dateOfJoining.slice(0, 4), 10)
                        : new Date().getFullYear() - 2;
                      const currentYear = new Date().getFullYear();
                      const years = [];
                      for (let y = currentYear; y >= Math.max(joinYear, 2020); y--) years.push(y);
                    return years.map((y) => ({ value: String(y), label: String(y) }));
                    })()}
                  className="w-28"
                />
                <Button
                  size="sm"
                    onClick={handleSlipDownloadPdf}
                  loading={pdfDownloading}
                  disabled={pdfDownloading || !hasSlipForPeriod}
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </>
            )}
          </div>

          {slipsError ? (
            <AppPageError
              message="Unable to load data. Please try again."
              onRetry={() => {
                if (selectedEmployeeId) {
                  setSlipsError(null);
                  setSlipsLoading(true);
                  void (async () => {
                    try {
                      const qs = new URLSearchParams({
                        user_id: selectedEmployeeId,
                        employeeUserId: selectedEmployeeId,
                      });
                      const res = await fetch(`/api/payslips/employee?${qs.toString()}`);
                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error || "Failed to load payslips");
                      setSlipsData({
                        company: data.company,
                        user: data.user,
                        payslips: data.payslips || [],
                      });
                    } catch (e: unknown) {
                      setSlipsError(e instanceof Error ? e.message : "Failed to load payslips");
                    } finally {
                      setSlipsLoading(false);
                    }
                  })();
                }
              }}
            />
          ) : !slipsData || !selectedEmployeeId ? (
            <EmptyState
              icon={FileText}
              title="Select an employee to preview salary slip."
            />
          ) : (
            (() => {
              const key = slipPeriodKey;
              const slip = slipsData.payslips.find((p) => p.periodMonth === key);
              const company = slipsData.company;
              const user = slipsData.user;

              if (!slip) {
                return (
                  <EmptyState
                    icon={FileText}
                    title="No payslip"
                    description="No salary slip was generated for the selected period."
                  />
                );
              }

              const salaryDate = new Date(slip.generatedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              });
              const dojFormatted = user?.dateOfJoining
                ? new Date(user.dateOfJoining + "T12:00:00").toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—";

              const n = (x: number) => (x ?? 0).toLocaleString("en-IN");
              const totalPerf = slip.incentive + slip.prBonus + slip.reimbursement;
              // Bank credit: salary after statutory deductions, minus TDS, plus variable pay (aligned with payroll preview).
              // Do not use slip.netPay alone — it may already equal take-home in some runs, which would double-count bonus/reimbursement.
              const salaryAfterDeductions = slip.grossPay - slip.deductions;
              const takeHome = Math.round(
                salaryAfterDeductions - slip.tds + slip.incentive + slip.prBonus + slip.reimbursement
              );

              const cellClass = "border border-black px-3 py-2 align-top text-sm";
              const thClass = "border border-black px-3 py-2 text-left font-semibold text-sm";

              const gov = slip.governmentMonthly;
              const adminLeaveRemarks = typeof slip.leaveRemarks === "string" ? slip.leaveRemarks.trim() : "";
              if (gov) {
                return (
                  <div className="mx-auto w-full max-w-[190mm]">
                    <AdminPayrollRemarksNote remarks={adminLeaveRemarks} />
                    <div className="flex justify-center overflow-x-auto py-2">
                      <GovernmentPayslipPrint
                        ref={payslipRef}
                        company={company}
                        user={{
                          name: user?.name,
                          employeeCode: user?.employeeCode,
                          designation: user?.designation,
                          department: user?.department,
                          departmentName: user?.departmentName,
                          dateOfJoining: user?.dateOfJoining,
                          uanNumber: user?.uanNumber,
                          pfNumber: user?.pfNumber,
                          cpfNumber: user?.cpfNumber ?? user?.pfNumber,
                        }}
                        slip={{
                          generatedAt: slip.generatedAt,
                          periodStart: slip.periodStart,
                          payDays: slip.payDays,
                          unpaidLeaves: slip.unpaidLeaves,
                          bankName: slip.bankName,
                          bankAccountNumber: slip.bankAccountNumber,
                          netPay: slip.netPay,
                        }}
                        gov={gov as GovernmentMonthlySlip}
                        leavePayslip={slip.leavePayslip ?? null}
                        payrollFieldDefs={payrollConfig?.fields}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div className="mx-auto w-full max-w-[190mm]">
                  <AdminPayrollRemarksNote remarks={adminLeaveRemarks} />
                  <div className="flex justify-center overflow-x-auto py-2">
                <div
                  ref={payslipRef}
                  className="payslip-print-area overflow-x-auto rounded-lg border border-black bg-white p-4 print:overflow-visible print:max-w-[190mm] print:p-6"
                  style={{ minWidth: "min(100%, 190mm)" }}
                >
                  <table className="payslip-header-table w-full border-collapse" style={{ border: "1px solid #000" }}>
                    <tbody>
                      <tr>
                        <td colSpan={2} className="border border-black px-4 py-4 text-center">
                          <div className="text-base font-bold text-slate-900">{company?.name || "Company"}</div>
                          {company?.address && (
                            <div className="mt-0.5 text-sm text-slate-600">{company.address}</div>
                          )}
                          <div className="mt-2 text-base font-bold uppercase tracking-wide">Salary Slip</div>
                          <div className="text-sm font-semibold">
                            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
                              parseInt(slipMonth, 10) - 1
                            ]}{" "}
                            {slipYear}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td className={`w-1/2 ${cellClass}`}>
                          <div className="space-y-1.5 text-sm leading-relaxed">
                            <div><span className="text-slate-600">Employee Name:</span> {user?.name || "—"}</div>
                            <div><span className="text-slate-600">Designation:</span> {resolvePayslipDesignation(user)}</div>
                            <div><span className="text-slate-600">Department:</span> {resolvePayslipDepartment(user)}</div>
                            <div><span className="text-slate-600">Salary Date:</span> {salaryDate}</div>
                          </div>
                        </td>
                        <td className={`w-1/2 ${cellClass}`}>
                          <div className="space-y-1.5 text-sm leading-relaxed">
                            <div><span className="text-slate-600">Joining Date:</span> {dojFormatted}</div>
                            <div><span className="text-slate-600">Aadhaar:</span> {user?.aadhaar || "—"}</div>
                            <div><span className="text-slate-600">PAN:</span> {user?.pan || "—"}</div>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td className={cellClass}>
                          <div className="space-y-1.5 text-sm leading-relaxed">
                            <div><span className="text-slate-600">Total Paid Days:</span> {slip.payDays}</div>
                            <div><span className="text-slate-600">Unpaid Leaves:</span> {slip.unpaidLeaves}</div>
                          </div>
                        </td>
                        <td className={cellClass}>
                          <div className="space-y-1.5 text-sm leading-relaxed">
                            <div><span className="text-slate-600">ESIC number:</span> {user?.esicNumber || "—"}</div>
                            <div><span className="text-slate-600">UAN number:</span> {user?.uanNumber || "—"}</div>
                            <div><span className="text-slate-600">PF number:</span> {user?.pfNumber || "—"}</div>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={2} className="border border-black p-0">
                          <table className="payslip-financial-table w-full border-collapse text-sm">
                              <>
                            <colgroup>
                              <col /><col /><col /><col /><col /><col /><col />
                            </colgroup>
                            <thead>
                              <tr>
                                <th className={`${thClass} w-20`}>Earnings</th>
                                <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Actual</th>
                                <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Paid</th>
                                <th className={`${thClass} w-24`}>Employee Deductions</th>
                                <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Amount</th>
                                <th className={`${thClass} w-24`}>Performance Earnings</th>
                                <th className="border border-black px-3 py-2 text-right w-14 font-semibold text-sm">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className={cellClass}>Basic</td>
                                <td className={`${cellClass} text-right`}>{n(slip.basic)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.basic)}</td>
                                <td className={cellClass}>Professional Tax</td>
                                <td className={`${cellClass} text-right`}>{n(slip.professionalTax)}</td>
                                <td className={cellClass}>Bonus</td>
                                <td className={`${cellClass} text-right`}>{n(slip.prBonus)}</td>
                              </tr>
                              <tr>
                                <td className={cellClass}>HRA</td>
                                <td className={`${cellClass} text-right`}>{n(slip.hra)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.hra)}</td>
                                <td className={cellClass}>PF</td>
                                <td className={`${cellClass} text-right`}>{n(slip.pfEmployee)}</td>
                                <td className={cellClass}>Incentive</td>
                                <td className={`${cellClass} text-right`}>{n(slip.incentive)}</td>
                              </tr>
                              <tr>
                                <td className={cellClass}>Medical</td>
                                <td className={`${cellClass} text-right`}>{n(slip.medical)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.medical)}</td>
                                <td className={cellClass}>ESIC</td>
                                <td className={`${cellClass} text-right`}>{n(slip.esicEmployee)}</td>
                                <td className={cellClass}>Reimbursement</td>
                                <td className={`${cellClass} text-right`}>{n(slip.reimbursement)}</td>
                              </tr>
                              <tr>
                                <td className={cellClass}>Trans</td>
                                <td className={`${cellClass} text-right`}>{n(slip.trans)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.trans)}</td>
                                <td colSpan={2} className={cellClass}></td>
                                <td colSpan={2} className={cellClass}></td>
                              </tr>
                              <tr>
                                <td className={cellClass}>LTA</td>
                                <td className={`${cellClass} text-right`}>{n(slip.lta)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.lta)}</td>
                                <td colSpan={2} className={cellClass}></td>
                                <td colSpan={2} className={cellClass}></td>
                              </tr>
                              <tr>
                                <td className={cellClass}>Personal</td>
                                <td className={`${cellClass} text-right`}>{n(slip.personal)}</td>
                                <td className={`${cellClass} text-right`}>{n(slip.personal)}</td>
                                <td colSpan={2} className={cellClass}></td>
                                <td colSpan={2} className={cellClass}></td>
                              </tr>
                              <tr>
                                <td className={`${cellClass} font-medium`}>GROSS</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(slip.grossPay)}</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(slip.grossPay)}</td>
                                <td className={`${cellClass} font-medium`}>Total Deduction</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(slip.deductions)}</td>
                                <td className={`${cellClass} font-medium`}>Total</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(totalPerf)}</td>
                              </tr>
                              <tr>
                                <td className={`${cellClass} font-medium`}>Net Payable Salary</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(takeHome)}</td>
                                <td className={`${cellClass} text-right font-medium`}>{n(takeHome)}</td>
                                <td colSpan={2} className={cellClass}></td>
                                <td colSpan={2} className={cellClass}></td>
                              </tr>
                              <tr>
                                <td className={`${cellClass} font-bold`}>Net Pay</td>
                                <td colSpan={5} className={cellClass}></td>
                                <td className={`${cellClass} text-right font-bold`}>{n(takeHome)}</td>
                              </tr>
                            </tbody>
                              </>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}
    </section>
  );
}

export default function PayrollPage() {
  return (
    <Suspense fallback={<AppPageLoader message="Loading payroll run..." />}>
      <PayrollPageContent />
    </Suspense>
  );
}
