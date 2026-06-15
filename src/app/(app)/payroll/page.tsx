"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { FormEvent, useEffect, useState, useRef, useMemo, Suspense } from "react";
import { useToast } from "@/components/ToastProvider";
import { dispatchHrmsChange, onHrmsChange } from "@/lib/hrmsChangeBus";
import { SkeletonTable, SkeletonText } from "@/components/Skeleton";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { computePayrollFromGross, defaultSalaryBreakup } from "@/lib/payrollCalc";
import {
  computeGovernmentMonthlyPayroll,
  deriveTransportSlabFromLevel,
  GOVERNMENT_DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS,
  type GovernmentDeductionDefaults,
  type GovernmentEarningPaidOverrides,
  type GovernmentOptionalMonthlyEarnings,
} from "@/lib/governmentPayroll";
import { GovernmentRunPreviewTable, type GovernmentRunPreviewRow } from "@/components/payroll/GovernmentRunPreviewTable";
import { isAdminRole } from "@/lib/roles";
import { GovernmentPayslipPrint } from "@/components/payslip/GovernmentPayslipPrint";
import type { GovernmentMonthlySlip } from "@/lib/governmentPayslipLayout";
import type { GovernmentLeavePayslipDisplay } from "@/lib/leaveBalancesCompute";
import {
  normalizeDigits,
  normalizeIfscInput,
  validateBankDetails,
} from "@/lib/employeeValidators";

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
  transportDaPercent: number;
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
  horticultureDefault: number;
  vehChargeDefault: number;
  otherDeductionDefault: number;
  govTotalEarnings: number;
  govTransportPaid: number;
  govTransportSlabGroup: string;
  govEffectiveCpf: number;
  govNetSalary: number;
};

/** Preserve variable earning heads when recomputing government preview after pay-day changes. */
function govOptionalFromComputedMonthly(g: Record<string, unknown> | null | undefined): GovernmentOptionalMonthlyEarnings | undefined {
  if (!g || typeof g !== "object") return undefined;
  const spPay = Number(g.spPayPaid) || 0;
  const extraWorkAllowance = Number(g.extraWorkAllowancePaid) || 0;
  const nightAllowance = Number(g.nightAllowancePaid) || 0;
  const uniformAllowance = Number(g.uniformAllowancePaid) || 0;
  const educationAllowance = Number(g.educationAllowancePaid) || 0;
  const daArrears = Number(g.daArrearsPaid) || 0;
  const transportArrears = Number(g.transportArrearsPaid) || 0;
  const encashment = Number(g.encashmentPaid) || 0;
  const encashmentDa = Number(g.encashmentDaPaid) || 0;
  if (
    !spPay &&
    !extraWorkAllowance &&
    !nightAllowance &&
    !uniformAllowance &&
    !educationAllowance &&
    !daArrears &&
    !transportArrears &&
    !encashment &&
    !encashmentDa
  ) {
    return undefined;
  }
  return {
    spPay,
    extraWorkAllowance,
    nightAllowance,
    uniformAllowance,
    educationAllowance,
    daArrears,
    transportArrears,
    encashment,
    encashmentDa,
  };
}

/** Deduction keys editable in Run Payroll government preview (before Generate). */
const GOV_RUN_EDITABLE_DEDUCTION_KEYS: (keyof GovernmentDeductionDefaults)[] = [
  "incomeTax",
  "pt",
  "lic",
  "cpf",
  "daCpf",
  "vpf",
  "pfLoan",
  "postOffice",
  "creditSociety",
  "stdLicenceFee",
  "electricity",
  "water",
  "mess",
  "horticulture",
  "welfare",
  "vehCharge",
  "other",
];

const GOV_RUN_EDITABLE_EARNING_KEYS: (keyof GovernmentEarningPaidOverrides)[] = [
  "basicPaid",
  "spPayPaid",
  "daPaid",
  "transportPaid",
  "hraPaid",
  "medicalPaid",
  "extraWorkAllowancePaid",
  "nightAllowancePaid",
  "uniformAllowancePaid",
  "educationAllowancePaid",
  "daArrearsPaid",
  "transportArrearsPaid",
  "encashmentPaid",
  "encashmentDaPaid",
];

const MASTER_GOVT_DEDUCTION_DEFAULT_COLUMNS: { field: keyof MasterGridRow; label: string }[] = [
  { field: "licDefault", label: "LIC" },
  { field: "messDefault", label: "Mess" },
  { field: "welfareDefault", label: "Welf." },
  { field: "vpfDefault", label: "VPF" },
  { field: "pfLoanDefault", label: "PF loan" },
  { field: "postOfficeDefault", label: "P.O." },
  { field: "creditSocietyDefault", label: "Cr. soc." },
  { field: "stdLicenceFeeDefault", label: "Std lic." },
  { field: "electricityDefault", label: "Elec." },
  { field: "waterDefault", label: "Water" },
  { field: "horticultureDefault", label: "Hort." },
  { field: "vehChargeDefault", label: "Veh." },
  { field: "otherDeductionDefault", label: "Oth." },
];

type GovRecalcPayload = {
  grossBasic: number;
  daPercent: number;
  hraPercent: number;
  medicalFixed: number;
  transportDaPercent: number;
  payLevel: number;
  deductionDefaults: GovernmentDeductionDefaults;
  /** Run-preview overrides for paid earning lines (optional). */
  earningPaidOverrides?: GovernmentEarningPaidOverrides;
};

function govDeductionDefaultsFromMasterRow(row: MasterGridRow): GovernmentDeductionDefaults {
  return {
    incomeTax: row.incomeTaxDefault,
    pt: row.pt,
    lic: row.licDefault,
    cpf: row.cpfDefault,
    daCpf: row.daCpfDefault,
    vpf: row.vpfDefault,
    pfLoan: row.pfLoanDefault,
    postOffice: row.postOfficeDefault,
    creditSociety: row.creditSocietyDefault,
    stdLicenceFee: row.stdLicenceFeeDefault,
    electricity: row.electricityDefault,
    water: row.waterDefault,
    mess: row.messDefault,
    horticulture: row.horticultureDefault,
    welfare: row.welfareDefault,
    vehCharge: row.vehChargeDefault,
    other: row.otherDeductionDefault,
  };
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
      transportDaPercent: row.transportDaPercent,
      payLevel: row.governmentPayLevel,
      daysInMonth: 30,
      unpaidDays: 0,
      deductionDefaults: govDeductionDefaultsFromMasterRow(row),
    });
    const takeHome = Math.max(0, comp.netSalary + row.advanceBonus);
    const cpfLikeRunPayroll =
      comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf + comp.deductions.pfLoan;
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
  | "transportDaPercent"
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
  | "horticultureDefault"
  | "vehChargeDefault"
  | "otherDeductionDefault"
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
    transportDaPercent: 0,
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
    horticultureDefault: 0,
    vehChargeDefault: 0,
    otherDeductionDefault: 0,
    govTotalEarnings: 0,
    govTransportPaid: 0,
    govTransportSlabGroup: "",
    govEffectiveCpf: 0,
    govNetSalary: 0,
  };
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
    const grossBasic = Number(m.grossBasic ?? m.grossSalary) || 0;
    const pt = m.pt != null && Number(m.pt) >= 0 ? Number(m.pt) : companyPt;
    const tds = Number(m.tds) || 0;
    const incomeTaxDefault = Number(m.incomeTaxDefault ?? m.tds) || 0;
    const advanceBonus = Number(m.advanceBonus) || 0;
    const daPercent = Number(m.daPercent) || 53;
    const hraPercent = Number(m.hraPercent) || 30;
    const medicalFixed = Number(m.medicalFixed) || 3000;
    const transportDaPercent = Number(m.transportDaPercent) || 48.06;
    const cpfDefault = Number(m.cpfDefault) || 0;
    const daCpfDefault = Number(m.daCpfDefault) || 0;
    const licDefault = Number(m.licDefault) || 0;
    const messDefault = Number(m.messDefault) || 0;
    const welfareDefault = Number(m.welfareDefault) || 0;
    const vpfDefault = Number(m.vpfDefault) || 0;
    const pfLoanDefault = Number(m.pfLoanDefault) || 0;
    const postOfficeDefault = Number(m.postOfficeDefault) || 0;
    const creditSocietyDefault = Number(m.creditSocietyDefault) || 0;
    const stdLicenceFeeDefault = Number(m.stdLicenceFeeDefault) || 0;
    const electricityDefault = Number(m.electricityDefault) || 0;
    const waterDefault = Number(m.waterDefault) || 0;
    const horticultureDefault = Number(m.horticultureDefault) || 0;
    const vehChargeDefault = Number(m.vehChargeDefault) || 0;
    const otherDeductionDefault = Number(m.otherDeductionDefault) || 0;
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
      transportDaPercent,
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
      horticultureDefault,
      vehChargeDefault,
      otherDeductionDefault,
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

  const [masters, setMasters] = useState<any[]>([]);
  const [mastersLoading, setMastersLoading] = useState(false);
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
  const [editTransportDaPercent, setEditTransportDaPercent] = useState("48.06");
  const [editGovPtDefault, setEditGovPtDefault] = useState("200");
  const [editCpfDefault, setEditCpfDefault] = useState("0");
  const [editDaCpfDefault, setEditDaCpfDefault] = useState("0");
  const [editGovLevel, setEditGovLevel] = useState<number | null>(null);

  const [runMonth, setRunMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  const [runYear, setRunYear] = useState(() => String(new Date().getFullYear()));
  const [runDay, setRunDay] = useState(() => String(new Date().getDate()));
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pastPeriods, setPastPeriods] = useState<{ id: string; periodName: string; periodStart: string; periodEnd: string; excelFilePath: string | null }[]>([]);
  const [pastPeriodsLoading, setPastPeriodsLoading] = useState(false);
  const [editableRows, setEditableRows] = useState<
    {
      employeeUserId: string;
      employeeName: string | null;
      employeeEmail: string;
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
    }[]
  >([]);

  const previewHasGovernment = useMemo(
    () => !!(preview?.rows?.length && preview.rows.some((r: any) => r.payrollMode === "government")),
    [preview?.rows],
  );

  const previewAllGovernment = useMemo(() => {
    const rows = preview?.rows;
    if (!rows?.length) return false;
    return rows.every((r: any) => r.payrollMode === "government" && !r.error);
  }, [preview?.rows]);

  // Salary slips tab (admin/HR view employee payslips)
  const [employees, setEmployees] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [slipsData, setSlipsData] = useState<{
    company: { name: string; address: string; logoUrl: string | null } | null;
    user: {
      name: string;
      employeeCode: string;
      designation: string;
      departmentName?: string;
      dateOfJoining: string;
      aadhaar: string;
      pan: string;
      uanNumber: string;
      pfNumber: string;
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
      leavePayslip?: GovernmentLeavePayslipDisplay | null;
    }[];
  } | null>(null);
  const [slipsLoading, setSlipsLoading] = useState(false);
  const [slipsError, setSlipsError] = useState<string | null>(null);
  const [slipMonth, setSlipMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, "0"));
  const [slipYear, setSlipYear] = useState(() => String(new Date().getFullYear()));
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const payslipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const denom = preview?.daysInMonth ?? preview?.workingDaysInFullMonth;
    if (preview?.rows?.length && denom) {
      setEditableRows(
        preview.rows.map((r: any) => {
          const base = {
            ...r,
            grossMonthly:
              r.grossMonthly ??
              Math.round((Number(r.grossPay || 0) * denom) / (r.payDays || r.rawPayDays || 1)),
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
          };
          if (r.payrollMode === "government" && r.govRecalc && !r.governmentMonthly) {
            const gr = r.govRecalc;
            const dim = Math.max(1, Math.floor(Number(denom) || 30));
            const payDays = Number(r.payDays ?? dim);
            const unpaidDays = Math.max(0, dim - payDays);
            const comp = computeGovernmentMonthlyPayroll({
              grossBasic: gr.grossBasic,
              daPercent: gr.daPercent,
              hraPercent: gr.hraPercent,
              medicalFixed: gr.medicalFixed,
              transportDaPercent: gr.transportDaPercent,
              payLevel: gr.payLevel,
              daysInMonth: dim,
              unpaidDays,
              deductionDefaults: gr.deductionDefaults,
              earningPaidOverrides: gr.earningPaidOverrides,
            });
            base.governmentMonthly = comp;
            base.grossMonthly = gr.grossBasic;
            base.grossPay = comp.totalEarnings;
            base.deductions = comp.totalDeductions;
            base.netPay = comp.netSalary;
            base.tds = comp.deductions.incomeTax;
            base.profTax = comp.deductions.pt;
            base.pfEmployee = Math.round(
              comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf + comp.deductions.pfLoan
            );
            base.takeHome = Math.round(comp.netSalary) +
              Math.round(Number(r.incentive) || 0) +
              Math.round(Number(r.prBonus) || 0) +
              Math.round(Number(r.reimbursement) || 0);
          }
          return base;
        })
      );
    } else {
      setEditableRows([]);
    }
  }, [preview?.rows, preview?.daysInMonth, preview?.workingDaysInFullMonth]);

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
          const allowedRoles = new Set(["employee"]);
          const list = raw.filter(
            (e: any) =>
              String(e.employmentStatus ?? "preboarding") !== "preboarding" &&
              allowedRoles.has(String(e.role ?? "").toLowerCase()),
          );
          setEmployees(
            list.map((e: any) => ({
              id: String(e.userId ?? e.user_id ?? e.id),
              name: e.name,
              email: e.email,
            })),
          );
          if (list.length) {
            const firstUserId = String(list[0].userId ?? list[0].user_id ?? list[0].id);
            if (
              !selectedEmployeeId ||
              !list.some((e: any) => String(e.userId ?? e.user_id ?? e.id) === selectedEmployeeId)
            ) {
              setSelectedEmployeeId(firstUserId);
            }
          } else {
            setSelectedEmployeeId("");
          }
        }
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, canManage, selectedEmployeeId]);

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
    value: number
  ) {
    const payDenom = preview?.daysInMonth ?? preview?.workingDaysInFullMonth ?? 30;
    const payDaysMax = preview?.effectiveRunDay ?? preview?.workingDaysThroughRunDay ?? preview?.daysInMonth ?? 31;
    const govPayDaysMax = preview?.daysInMonth ?? 31;
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.employeeUserId !== employeeUserId) return row;

        if (row.payrollMode === "government" && row.govRecalc) {
          const dim = Math.max(1, Math.floor(Number(payDenom) || 30));
          const gr0 = row.govRecalc;

          const applyGovCompute = (gr: GovRecalcPayload, payDaysVal: number) => {
            const capped = Math.max(0, Math.min(govPayDaysMax, payDaysVal));
            const unpaidDays = Math.max(0, dim - capped);
            const gm = row.governmentMonthly as Record<string, unknown> | null | undefined;
            const optionalEarnings = govOptionalFromComputedMonthly(gm);
            const comp = computeGovernmentMonthlyPayroll({
              grossBasic: gr.grossBasic,
              daPercent: gr.daPercent,
              hraPercent: gr.hraPercent,
              medicalFixed: gr.medicalFixed,
              transportDaPercent: gr.transportDaPercent,
              payLevel: gr.payLevel,
              daysInMonth: dim,
              unpaidDays,
              deductionDefaults: gr.deductionDefaults,
              optionalEarnings,
              earningPaidOverrides: gr.earningPaidOverrides,
            });
            return { comp, capped, unpaidDays };
          };

          const rowFromGovCompute = (
            comp: ReturnType<typeof computeGovernmentMonthlyPayroll>,
            capped: number,
            unpaidDays: number,
            gr: GovRecalcPayload,
            incentiveBase: typeof row,
          ) => ({
            ...row,
            govRecalc: gr,
            payDays: capped,
            unpaidLeaveDays: unpaidDays,
            governmentMonthly: comp,
            grossPay: comp.totalEarnings,
            deductions: comp.totalDeductions,
            netPay: comp.netSalary,
            tds: comp.deductions.incomeTax,
            profTax: comp.deductions.pt,
            pfEmployee: Math.round(
              comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf + comp.deductions.pfLoan,
            ),
            pfEmployer: 0,
            esicEmployee: 0,
            esicEmployer: 0,
            takeHome:
              Math.round(comp.netSalary) +
              Math.round(Number(incentiveBase.incentive) || 0) +
              Math.round(Number(incentiveBase.prBonus) || 0) +
              Math.round(Number(incentiveBase.reimbursement) || 0),
          });

          if (field.startsWith("govDeduction_")) {
            const sub = field.slice("govDeduction_".length) as keyof GovernmentDeductionDefaults;
            if (!GOV_RUN_EDITABLE_DEDUCTION_KEYS.includes(sub)) return row;
            const ded = { ...gr0.deductionDefaults, [sub]: Math.max(0, Math.round(Number(value) || 0)) };
            const grNext: GovRecalcPayload = { ...gr0, deductionDefaults: ded };
            const { comp, capped, unpaidDays } = applyGovCompute(grNext, row.payDays);
            return rowFromGovCompute(comp, capped, unpaidDays, grNext, row) as typeof row;
          }

          if (field.startsWith("govEarning_")) {
            const sub = field.slice("govEarning_".length) as keyof GovernmentEarningPaidOverrides;
            if (!GOV_RUN_EDITABLE_EARNING_KEYS.includes(sub)) return row;
            const eo: GovernmentEarningPaidOverrides = {
              ...(gr0.earningPaidOverrides ?? {}),
              [sub]: Math.max(0, Math.round(Number(value) || 0)),
            };
            const grNext: GovRecalcPayload = { ...gr0, earningPaidOverrides: eo };
            const { comp, capped, unpaidDays } = applyGovCompute(grNext, row.payDays);
            return rowFromGovCompute(comp, capped, unpaidDays, grNext, row) as typeof row;
          }

          const next = { ...row, [field]: value } as typeof row;
          const recalcGovTakeHome = () => {
            next.takeHome =
              Math.round(Number(next.netPay) || 0) +
              Math.round(Number(next.incentive) || 0) +
              Math.round(Number(next.prBonus) || 0) +
              Math.round(Number(next.reimbursement) || 0);
          };
          if (field === "payDays") {
            const { comp, capped, unpaidDays } = applyGovCompute(gr0, value);
            Object.assign(next, rowFromGovCompute(comp, capped, unpaidDays, gr0, next));
            return next;
          }
          if (["incentive", "prBonus", "reimbursement", "tds"].includes(field)) {
            recalcGovTakeHome();
            return next;
          }
          if (field === "takeHome") {
            next.takeHome = value;
            return next;
          }
          if (field === "ctc") {
            next.ctc = value;
            return next;
          }
          return next;
        }

        const next = { ...row, [field]: value } as typeof row;
        const recalcTakeHome = () => {
          next.takeHome = next.netPay - (next.tds ?? 0) + (next.incentive ?? 0) + (next.prBonus ?? 0) + (next.reimbursement ?? 0);
        };
        const recalcCtc = () => {
          const base = row.ctcBase ?? row.ctc;
          next.ctc = base + (next.incentive ?? 0) + (next.prBonus ?? 0);
        };
        if (field === "payDays") {
          const newPayDays = Math.max(0, Math.min(payDaysMax, value));
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
          next.netPay = next.grossPay - value;
          recalcTakeHome();
          recalcCtc();
        } else if (["incentive", "prBonus", "reimbursement", "tds"].includes(field)) {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "netPay") {
          recalcTakeHome();
          recalcCtc();
        } else if (field === "takeHome") {
          next.takeHome = value;
          recalcCtc();
        } else if (field === "ctc") {
          next.ctc = value;
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
        const res = await fetch("/api/payroll/master");
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
              const list = raw.filter(
                (e: any) => String(e.employmentStatus ?? "preboarding") !== "preboarding",
              );
              setEmployees(
                list.map((e: any) => ({
                  id: String(e.userId ?? e.user_id ?? e.id),
                  name: e.name,
                  email: e.email,
                })),
              );
              if (list.length) {
                const firstUserId = String(list[0].userId ?? list[0].user_id ?? list[0].id);
                if (
                  !selectedEmployeeId ||
                  !list.some((e: any) => String(e.userId ?? e.user_id ?? e.id) === selectedEmployeeId)
                ) {
                  setSelectedEmployeeId(firstUserId);
                }
              } else {
                setSelectedEmployeeId("");
              }
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
              const res = await fetch("/api/payroll/master");
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
  }, [canManage, tab, selectedEmployeeId]);

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

  const lastMonthYearRef = useRef<string>("");

  useEffect(() => {
    const day = parseInt(runDay, 10) || 1;
    const key = `${runYear}-${runMonth}`;
    const monthChanged = lastMonthYearRef.current && lastMonthYearRef.current !== key;
    lastMonthYearRef.current = key;

    const nowIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // yyyy-mm-dd
    const currentKey = `${nowIst.slice(0, 4)}-${nowIst.slice(5, 7)}`;
    const todayDayIst = String(parseInt(nowIst.slice(8, 10), 10) || 1);

    // When user switches month/year:
    // - if selecting the current IST month, default to today
    // - otherwise default to the last day of that month (31/30/28/29).
    if (monthChanged) {
      setRunDay(key === currentKey ? todayDayIst : String(daysInSelectedMonth));
      return;
    }
    if (day > daysInSelectedMonth) {
      setRunDay(String(daysInSelectedMonth));
    }
  }, [runMonth, runYear, runDay, daysInSelectedMonth]);

  useEffect(() => {
    if (!canManage || tab !== "run") return;
    let cancelled = false;
    setPreview(null);
    setEditableRows([]);
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}`
        );
        const data = await res.json();
        if (!cancelled && res.ok) setPreview(data.preview ?? null);
        else if (!cancelled) setPreview(null);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage, tab, runYear, runMonth, runDay]);

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
      const tda = parseFloat(editTransportDaPercent) || 0;
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
          transportDaPercent: tda,
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
            horticulture: 0,
            welfare: 0,
            vehCharge: 0,
            other: 0,
          },
        });
        const slab = deriveTransportSlabFromLevel(editGovLevel);
        const statutoryCpf =
          comp.deductions.cpf + comp.deductions.daCpf + comp.deductions.vpf + comp.deductions.pfLoan;
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
    editTransportDaPercent,
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
      setEditTransportDaPercent(String(gridRow.transportDaPercent));
      setEditGovPtDefault(String(gridRow.pt));
      setEditCpfDefault(String(gridRow.cpfDefault));
      setEditDaCpfDefault(String(gridRow.daCpfDefault));
      setEditTds(String(gridRow.incomeTaxDefault ?? gridRow.tds ?? 0));
    } else {
      setEditGrossBasic(String(m?.grossBasic ?? gridRow.gross ?? ""));
      setEditDaPercent(String(m?.daPercent ?? 53));
      setEditHraPercent(String(m?.hraPercent ?? 30));
      setEditMedicalFixed(String(m?.medicalFixed ?? 3000));
      setEditTransportDaPercent(String(m?.transportDaPercent ?? 48.06));
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
            transportDaPercent: row.transportDaPercent,
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
            horticultureDefault: row.horticultureDefault,
            vehChargeDefault: row.vehChargeDefault,
            otherDeductionDefault: row.otherDeductionDefault,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to update");
        showToast("success", "Payroll master updated");
        dispatchHrmsChange("payroll_master");
        const refresh = await fetch("/api/payroll/master");
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
      const refresh = await fetch("/api/payroll/master");
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
      const refresh = await fetch("/api/payroll/master");
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
            transportDaPercent: parseFloat(editTransportDaPercent) || 48.06,
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
        const refresh = await fetch("/api/payroll/master");
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
      const refresh = await fetch("/api/payroll/master");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to update");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleRunPayroll(e: FormEvent) {
    e.preventDefault();
    setRunError(null);
    setRunning(true);
    try {
      const useCompleteMissing = Boolean(preview?.alreadyRun && preview?.payrollComplete === false);
      const rowsPayload = editableRows.map((r) => ({
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
        ...(r.payrollMode === "government" && r.govRecalc
          ? {
              payrollMode: r.payrollMode,
              governmentMonthly: r.governmentMonthly,
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
      // Stay on Run tab and refetch preview to show generated records + Download Excel
      const refreshRes = await fetch(
        `/api/payroll/run?year=${runYear}&month=${runMonth}&runDay=${runDay}`
      );
      const refreshData = await refreshRes.json();
      if (refreshRes.ok && refreshData.preview) setPreview(refreshData.preview);
    } catch (e: any) {
      setRunError(e?.message || "Failed to run payroll");
      showToast("error", e?.message || "Failed to run payroll");
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) {
    return (
      <section className="space-y-6">
        <h1 className="page-title">Payroll</h1>
        <p className="muted">You don&apos;t have access to payroll management.</p>
      </section>
    );
  }

  const payrollPageTitle = tab === "run" ? "Run Payroll" : "Salary Slips";
  const payrollPageSubtitle =
    tab === "run"
      ? "Preview and generate monthly payroll for the selected period."
      : "View and print employee salary slips.";

  return (
    <section className="space-y-6">
      <div>
        <h1 className="page-title">{payrollPageTitle}</h1>
        <p className="muted">{payrollPageSubtitle}</p>
      </div>

      {tab === "run" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Run monthly payroll</h2>
            
            <form onSubmit={handleRunPayroll} className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Month</label>
                  <select
                    value={runMonth}
                    onChange={(e) => setRunMonth(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={String(m).padStart(2, "0")}>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                  <input
                    type="number"
                    min="2020"
                    max="2030"
                    value={runYear}
                    onChange={(e) => setRunYear(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Run date (day)</label>
                  <input
                    type="number"
                    min="1"
                    max={daysInSelectedMonth}
                    value={runDay}
                    onChange={(e) => setRunDay(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {preview?.periodName && (
                    <span className="text-lg font-semibold text-slate-800">{preview.periodName}</span>
                  )}
                  <button
                    type="submit"
                    className={`btn btn-primary ${
                      preview?.alreadyRun && preview?.payrollComplete !== false ? "cursor-not-allowed opacity-50" : ""
                    }`}
                    disabled={running || (!!preview?.alreadyRun && preview?.payrollComplete !== false)}
                  >
                    {running
                      ? "Generating..."
                      : preview?.alreadyRun && preview?.payrollComplete === false
                        ? "Add missing payslips"
                        : "Generate"}
                  </button>
                </div>
              </div>
              {runError && <p className="text-sm text-red-600">{runError}</p>}
              {preview && !previewLoading && (
                <p className="text-xs text-slate-600">
                  Days in full month: {preview.daysInMonth}
                  {preview.effectiveRunDay != null ? ` · Through selected run date: ${preview.effectiveRunDay}` : null}
                </p>
              )}
              {preview?.alreadyRun && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-amber-700">
                    Payroll already run for this period.
                    {preview.payrollComplete === false && typeof preview.missingPayslipCount === "number" ? (
                      <span className="ml-1 font-medium">
                        {preview.missingPayslipCount} employee(s) still need payslips (e.g. new joiners)—click &quot;Add missing
                        payslips&quot; to create them and update Excel.
                      </span>
                    ) : null}
                  </p>
                  {preview?.existingPeriodId && (
                    <a
                      href={`/api/payroll/export?periodId=${preview.existingPeriodId}`}
                      download
                      className="btn btn-outline !py-1.5 !text-sm"
                    >
                      Download Excel
                    </a>
                  )}
                </div>
              )}
              {previewLoading ? (
                <div className="py-4">
                  <SkeletonTable rows={8} columns={8} />
                </div>
              ) : editableRows.length ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="mb-3 text-sm text-slate-600">
                    {preview?.alreadyRun
                      ? preview?.payrollComplete === false
                        ? "Saved payslips are read-only. Rows marked as pending will get payslips when you add missing payslips."
                        : "Payroll generated for this period. Values are read-only."
                      : previewAllGovernment
                        ? "Government payroll: preview matches the pay slip earnings and deduction columns. Paid days use the calendar month (see Days column max). Changing days recomputes Basic, DA, HRA, CPF, and totals."
                        : "Edit values before generating. Changing pay days will recalculate gross, PF, ESIC and deductions."}
                  </p>
                  {previewAllGovernment && preview?.daysInMonth ? (
                    <GovernmentRunPreviewTable
                      rows={editableRows as GovernmentRunPreviewRow[]}
                      daysInMonth={preview.daysInMonth}
                      effectiveRunDay={preview.effectiveRunDay ?? preview.workingDaysThroughRunDay ?? preview.daysInMonth}
                      readOnly={!!preview?.alreadyRun}
                      onUpdate={updateEditableRow}
                    />
                  ) : (
                    <div className="-mx-1 overflow-x-auto sm:mx-0">
                      <table className="w-full min-w-[720px] table-fixed text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="w-[100px] px-1.5 py-1">Employee</th>
                            <th className="w-[52px] px-1 py-1">Days</th>
                            <th className="w-[60px] px-1 py-1">Gross</th>
                            <th className="w-[60px] px-1 py-1">Net</th>
                            <th className="w-[48px] px-1 py-1">{previewHasGovernment ? "CPF" : "PF"}</th>
                            <th className="w-[48px] px-1 py-1">PF(R)</th>
                            <th className="w-[48px] px-1 py-1">ESIC</th>
                            <th className="w-[52px] px-1 py-1">ESIC(R)</th>
                            <th className="w-[44px] px-1 py-1">PT</th>
                            <th className="w-[48px] px-1 py-1">Bonus</th>
                            <th className="w-[48px] px-1 py-1">Inc</th>
                            <th className="w-[52px] px-1 py-1">Reimb</th>
                            <th className="w-[44px] px-1 py-1">TDS</th>
                            <th className="w-[52px] px-1 py-1">Ded</th>
                            <th className="w-[60px] px-1 py-1">Take</th>
                            <th className="w-[60px] px-1 py-1">CTC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editableRows.map((r) => {
                            const readOnly = !!preview?.alreadyRun;
                            return (
                              <tr key={r.employeeUserId} className="border-t border-slate-200">
                                <td
                                  className="truncate px-1.5 py-1 font-medium text-slate-900"
                                  title={r.employeeName || r.employeeEmail || undefined}
                                >
                                  <span className="align-middle">{r.employeeName || r.employeeEmail || "—"}</span>
                                  {r.payslipPending ? (
                                    <span className="ml-1 inline-block align-middle rounded bg-amber-100 px-1 py-0 text-[10px] font-medium text-amber-900">
                                      Pending slip
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span className="py-0.5">
                                      {r.payDays}
                                      {r.unpaidLeaveDays > 0 ? ` (-${r.unpaidLeaveDays})` : ""}
                                    </span>
                                  ) : (
                                    <>
                                      <input
                                        type="number"
                                        min={0}
                                        max={preview?.effectiveRunDay ?? preview?.daysInMonth ?? 31}
                                        value={r.payDays}
                                        onChange={(e) =>
                                          updateEditableRow(r.employeeUserId, "payDays", parseInt(e.target.value, 10) || 0)
                                        }
                                        className="w-full max-w-[44px] rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                      />
                                      {r.unpaidLeaveDays > 0 && (
                                        <span className="ml-0.5 text-[10px] text-amber-700">(-{r.unpaidLeaveDays})</span>
                                      )}
                                      {r.payDaysSuppressedMinAttendance ? null : null}
                                    </>
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.grossPay.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.grossPay}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "grossPay", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.netPay.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.netPay}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "netPay", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.pfEmployee.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.pfEmployee}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "pfEmployee", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.pfEmployer.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.pfEmployer}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "pfEmployer", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.esicEmployee.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.esicEmployee}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "esicEmployee", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.esicEmployer.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.esicEmployer}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "esicEmployer", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.profTax.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.profTax}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "profTax", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{(r.prBonus ?? 0).toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.prBonus ?? 0}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "prBonus", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{(r.incentive ?? 0).toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.incentive ?? 0}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "incentive", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{(r.reimbursement ?? 0).toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.reimbursement ?? 0}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "reimbursement", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{(r.tds ?? 0).toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.tds ?? 0}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "tds", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.deductions.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.deductions}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "deductions", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span className="font-medium">{r.takeHome.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.takeHome}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "takeHome", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs font-medium focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  {readOnly ? (
                                    <span>{r.ctc.toLocaleString("en-IN")}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={r.ctc}
                                      onChange={(e) =>
                                        updateEditableRow(r.employeeUserId, "ctc", parseInt(e.target.value, 10) || 0)
                                      }
                                      className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
            ) : !preview?.alreadyRun ? (
              <p className="muted py-6">No employees in payroll for the selected month and year. Ensure employees have Payroll Master records.</p>
            ) : null}
            </form>
          </div>
        </div>
      )}

      {tab === "slips" && (
        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Employee Salary Slips</h2>
          <p className="muted mb-4">Select an employee and period to view or download their salary slip.</p>

          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Employee</label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name || e.email || e.id}
                  </option>
                ))}
              </select>
            </div>
            {slipsData && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Month</label>
                  <select
                    value={slipMonth}
                    onChange={(e) => setSlipMonth(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={String(m).padStart(2, "0")}>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
                  <select
                    value={slipYear}
                    onChange={(e) => setSlipYear(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {(() => {
                      const joinYear = slipsData.user?.dateOfJoining
                        ? parseInt(slipsData.user.dateOfJoining.slice(0, 4), 10)
                        : new Date().getFullYear() - 2;
                      const currentYear = new Date().getFullYear();
                      const years = [];
                      for (let y = currentYear; y >= Math.max(joinYear, 2020); y--) years.push(y);
                      return years.map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
                {slipsData.payslips.some((p) => p.periodMonth === `${slipYear}-${slipMonth}`) && (
                  <button
                    type="button"
                    onClick={handleSlipDownloadPdf}
                    disabled={pdfDownloading}
                    className="btn btn-primary"
                  >
                    {pdfDownloading ? "Generating..." : "Download PDF"}
                  </button>
                )}
              </>
            )}
          </div>

          {employeesLoading ? (
            <SkeletonText lines={2} />
          ) : slipsLoading ? (
            <div className="py-4">
              <SkeletonTable rows={6} columns={6} />
            </div>
          ) : slipsError ? (
            <p className="text-sm text-red-600">{slipsError}</p>
          ) : !slipsData || !selectedEmployeeId ? (
            <p className="muted">Select an employee to view their salary slips.</p>
          ) : (
            (() => {
              const key = `${slipYear}-${slipMonth}`;
              const slip = slipsData.payslips.find((p) => p.periodMonth === key);
              const company = slipsData.company;
              const user = slipsData.user;

              if (!slip) {
                return <p className="muted">No payslip for the selected period.</p>;
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
              if (gov) {
                return (
                  <GovernmentPayslipPrint
                    ref={payslipRef}
                    company={company}
                    user={{
                      name: user?.name,
                      employeeCode: user?.employeeCode,
                      designation: user?.designation,
                      departmentName: user?.departmentName,
                      dateOfJoining: user?.dateOfJoining,
                      uanNumber: user?.uanNumber,
                      pfNumber: user?.pfNumber,
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
                  />
                );
              }

              return (
                <div
                  ref={payslipRef}
                  className="payslip-print-area overflow-x-auto rounded-lg border border-black bg-white p-6 print:overflow-visible print:max-w-[190mm]"
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
                            <div><span className="text-slate-600">Designation:</span> {user?.designation || "—"}</div>
                            <div><span className="text-slate-600">Department:</span> {(user as { departmentName?: string })?.departmentName || "—"}</div>
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
    <Suspense
      fallback={
        <section className="space-y-6">
          <h1 className="page-title">Payroll</h1>
          <SkeletonTable rows={8} columns={12} />
        </section>
      }
    >
      <PayrollPageContent />
    </Suspense>
  );
}
