"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { FormEvent, useEffect, useState, useRef, useMemo, Suspense } from "react";
import { useToast } from "@/components/ToastProvider";
import { SkeletonTable, SkeletonText } from "@/components/Skeleton";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { computePayrollFromGross, defaultSalaryBreakup } from "@/lib/payrollCalc";

type MasterGridRow = {
  employeeUserId: string;
  employeeName: string | null;
  employeeEmail: string;
  gross: number;
  ctc: number;
  pfEmp: number;
  pfEmpr: number;
  esicEmp: number;
  esicEmpr: number;
  pt: number;
  tds: number;
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
};

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

function buildMasterGridRow(apiRow: any, companyPt: number): MasterGridRow | null {
  const m = apiRow.master;
  if (!m) return null;
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
  const base: Omit<MasterGridRow, "ctc" | "pfEmp" | "pfEmpr" | "esicEmp" | "esicEmpr" | "takeHome"> = {
    employeeUserId: apiRow.employeeUserId,
    employeeName: apiRow.employeeName,
    employeeEmail: apiRow.employeeEmail,
    gross,
    pt,
    tds,
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
  };
  const stat = computeRowStatutory(base);
  return { ...base, ...stat };
}

function PayrollPageContent() {
  const { role } = useAuth();
  const { showToast } = useToast();
  const params = useSearchParams();
  const tab = params.get("tab") || "master";

  const canManage = role === "super_admin" || role === "admin" || role === "hr";

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
    }[]
  >([]);

  // Salary slips tab (admin/HR view employee payslips)
  const [employees, setEmployees] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [slipsData, setSlipsData] = useState<{
    company: { name: string; address: string; logoUrl: string | null } | null;
    user: { name: string; employeeCode: string; designation: string; dateOfJoining: string; aadhaar: string; pan: string; uanNumber: string; pfNumber: string; esicNumber: string } | null;
    payslips: {
      id: string;
      periodMonth: string;
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
        preview.rows.map((r: any) => ({
          ...r,
          grossMonthly:
            r.grossMonthly ??
            Math.round((r.grossPay * denom) / (r.payDays || r.rawPayDays || 1)),
          incentive: r.incentive ?? 0,
          prBonus: r.prBonus ?? 0,
          reimbursement: r.reimbursement ?? 0,
          tds: r.tds ?? 0,
          ctcBase: r.ctcBase ?? r.ctc,
        }))
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
          const list = data.employees ?? [];
          setEmployees(list.map((e: any) => ({ id: e.id, name: e.name, email: e.email })));
          if (list.length && !selectedEmployeeId) setSelectedEmployeeId(list[0].id);
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
        const res = await fetch(`/api/payslips/employee?employeeUserId=${encodeURIComponent(selectedEmployeeId)}`);
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
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.employeeUserId !== employeeUserId) return row;
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

  function patchMasterGridRow(employeeUserId: string, patch: Partial<MasterGridRow>) {
    setMasterGrid((prev) =>
      prev.map((r) => {
        if (r.employeeUserId !== employeeUserId) return r;
        const next = { ...r, ...patch };
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

  /** Opens the salary breakup modal; `fields` can come from API or current grid row (includes unsaved inline edits). */
  function openPayrollMasterEditDialog(
    employeeUserId: string,
    employeeName: string | null,
    employeeEmail: string,
    fields: {
      gross: number;
      basic: number;
      hra: number;
      medical: number;
      trans: number;
      lta: number;
      personal: number;
      pfEligible: boolean;
      esicEligible: boolean;
      effectiveStartDate: string;
      pt: number;
      tds: number;
      advanceBonus: number;
    }
  ) {
    const gross = fields.gross;
    const componentsSum =
      fields.basic + fields.hra + fields.medical + fields.trans + fields.lta + fields.personal;
    /** If stored components don’t add up to gross, use the standard split for gross (Basic 50%, HRA 20%, etc.). */
    const split =
      gross > 0 &&
      (componentsSum === 0 || Math.abs(componentsSum - gross) > 2)
        ? defaultSalaryBreakup(gross)
        : componentsSum > 0
          ? {
              basic: fields.basic,
              hra: fields.hra,
              medical: fields.medical,
              trans: fields.trans,
              lta: fields.lta,
              personal: fields.personal,
            }
          : defaultSalaryBreakup(gross);
    setEditMasterOpen({
      employeeUserId,
      employeeName,
      employeeEmail,
      master: { grossSalary: gross },
    });
    setEditGross(String(gross || ""));
    setEditBasic(String(split.basic));
    setEditHra(String(split.hra));
    setEditMedical(String(split.medical));
    setEditTrans(String(split.trans));
    setEditLta(String(split.lta));
    setEditPersonal(String(split.personal));
    setEditPfEligible(fields.pfEligible);
    setEditEsicEligible(fields.esicEligible);
    setEditEffectiveDate(
      fields.effectiveStartDate
        ? String(fields.effectiveStartDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    );
    const mpt = fields.pt;
    setEditPt(mpt != null && Number(mpt) >= 0 ? String(mpt) : String(companyPt));
    setEditTds(String(fields.tds ?? 0));
    setEditAdvanceBonus(String(fields.advanceBonus ?? 0));
    setEditReason("UpdateOnly");
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
      const refresh = await fetch("/api/payroll/master");
      const refreshData = await refresh.json();
      if (refresh.ok) setMasters(refreshData.masters || []);
    } catch (e: any) {
      showToast("error", e?.message || "Failed to update");
    } finally {
      setMasterRowSaving(null);
    }
  }

  async function handleSaveMaster(e: FormEvent) {
    e.preventDefault();
    if (!editMasterOpen) return;
    setEditSaving(true);
    try {
      const gross = parseFloat(editGross) || 0;
      const basic = parseFloat(editBasic) || 0;
      const hra = parseFloat(editHra) || 0;
      const medical = parseFloat(editMedical) || 0;
      const trans = parseFloat(editTrans) || 0;
      const lta = parseFloat(editLta) || 0;
      const personal = parseFloat(editPersonal) || 0;
      const pt = parseFloat(editPt);
      const tds = parseFloat(editTds) || 0;
      const advanceBonus = parseFloat(editAdvanceBonus) || 0;
      const res = await fetch("/api/payroll/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeUserId: editMasterOpen.employeeUserId,
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
      }));
      const res = await fetch("/api/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(runYear, 10),
          month: parseInt(runMonth, 10),
          runDay: parseInt(runDay, 10),
          rows: rowsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to run payroll");
      showToast("success", `Payroll generated: ${data.payslipsGenerated} payslips. Excel saved to storage.`);
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

  return (
    <section className="space-y-6">
      <div>
        <h1 className="page-title">Payroll</h1>
        <p className="muted">Payroll Master and monthly payroll run.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/payroll?tab=master"
          className={`btn ${tab === "master" ? "btn-primary" : "btn-outline"}`}
        >
          Payroll Master
        </Link>
        <Link
          href="/payroll?tab=run"
          className={`btn ${tab === "run" ? "btn-primary" : "btn-outline"}`}
        >
          Run Payroll
        </Link>
        <Link
          href="/payroll?tab=slips"
          className={`btn ${tab === "slips" ? "btn-primary" : "btn-outline"}`}
        >
          Salary Slips
        </Link>
      </div>

      {tab === "master" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Payroll Master</h2>

            {mastersLoading ? (
              <SkeletonTable rows={6} columns={12} />
            ) : masters.length === 0 ? (
              <p className="muted">No current employees with payroll master.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800/30 shadow-sm">
                <table className="w-full min-w-[1090px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[#0a1628] text-[11px] font-semibold uppercase tracking-wide text-white">
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 align-middle whitespace-nowrap">
                        Employee
                      </th>
                      <th rowSpan={2} className="min-w-[5rem] border border-slate-700/90 px-2 py-2 text-center">
                        Gross
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-1 py-2 text-center text-[10px] leading-tight">
                        PF
                        <br />
                        elig
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-1 py-2 text-center text-[10px] leading-tight">
                        ESIC
                        <br />
                        elig
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        CTC
                      </th>
                      <th colSpan={2} className="border border-slate-700/90 px-2 py-1.5 text-center">
                        Employee contribution
                      </th>
                      <th colSpan={2} className="border border-slate-700/90 px-2 py-1.5 text-center">
                        Employer contribution
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        Adv bonus
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        PT
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        TDS
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        Take home
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center whitespace-nowrap">
                        Applicable month
                      </th>
                      <th rowSpan={2} className="border border-slate-700/90 px-2 py-2 text-center">
                        Action
                      </th>
                    </tr>
                    <tr className="bg-[#0a1628] text-[11px] font-medium text-white">
                      <th className="border border-slate-700/90 px-2 py-1.5 text-center">PF</th>
                      <th className="border border-slate-700/90 px-2 py-1.5 text-center">ESIC</th>
                      <th className="border border-slate-700/90 px-2 py-1.5 text-center">PF</th>
                      <th className="border border-slate-700/90 px-2 py-1.5 text-center">ESIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masterGrid.map((row) => {
                      const inpGross =
                        "w-full min-w-[4rem] max-w-[6.5rem] rounded border border-sky-400/80 bg-white px-1.5 py-1 text-right text-sm tabular-nums text-slate-900";
                      const inp =
                        "w-full min-w-[4rem] max-w-[6.5rem] rounded border border-sky-400/80 bg-white px-1.5 py-1 text-right text-sm tabular-nums text-slate-900";
                      const inpRo =
                        "w-full min-w-[4rem] max-w-[6.5rem] rounded border border-slate-300/90 bg-slate-100/80 px-1.5 py-1 text-right text-sm tabular-nums text-slate-700";
                      return (
                        <tr
                          key={row.employeeUserId}
                          className={`border-t border-slate-200 bg-white hover:bg-slate-50/80 ${
                            masterFocusId === row.employeeUserId ? "ring-2 ring-inset ring-violet-500/55" : ""
                          }`}
                          onClick={() => setMasterFocusId(row.employeeUserId)}
                        >
                          <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">
                            <span className="font-medium text-cyan-600">
                              {row.employeeName || row.employeeEmail || "—"}
                            </span>
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input
                              type="number"
                              min={0}
                              step={100}
                              className={inpGross}
                              value={row.gross}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, {
                                  gross: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1 text-center align-middle">
                            <input
                              type="checkbox"
                              checked={row.pfEligible}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, { pfEligible: e.target.checked })
                              }
                              aria-label="PF eligible"
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1 text-center align-middle">
                            <input
                              type="checkbox"
                              checked={row.esicEligible}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, { esicEligible: e.target.checked })
                              }
                              aria-label="ESIC eligible"
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.ctc)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.pfEmp)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.esicEmp)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.pfEmpr)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.esicEmpr)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input
                              type="number"
                              min={0}
                              step={100}
                              className={inp}
                              value={row.advanceBonus}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, {
                                  advanceBonus: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className={inp}
                              value={row.pt}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, {
                                  pt: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input
                              type="number"
                              min={0}
                              step={100}
                              className={inp}
                              value={row.tds}
                              onChange={(e) =>
                                patchMasterGridRow(row.employeeUserId, {
                                  tds: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input type="text" readOnly className={inpRo} value={Math.round(row.takeHome)} />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <input
                              type="month"
                              className="min-w-[8.5rem] rounded border border-sky-400/80 bg-white px-1 py-1 text-sm text-slate-900"
                              value={
                                row.effectiveStartDate && row.effectiveStartDate.length >= 7
                                  ? row.effectiveStartDate.slice(0, 7)
                                  : ""
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                patchMasterGridRow(row.employeeUserId, {
                                  effectiveStartDate: v ? `${v}-01` : "",
                                });
                              }}
                            />
                          </td>
                          <td className="border border-slate-200 px-1 py-1">
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                type="button"
                                className="rounded p-1.5 text-sky-700 hover:bg-sky-50"
                                title="Edit in dialog"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPayrollMasterEditDialog(row.employeeUserId, row.employeeName, row.employeeEmail, {
                                    gross: row.gross,
                                    basic: row.basic,
                                    hra: row.hra,
                                    medical: row.medical,
                                    trans: row.trans,
                                    lta: row.lta,
                                    personal: row.personal,
                                    pfEligible: row.pfEligible,
                                    esicEligible: row.esicEligible,
                                    effectiveStartDate: row.effectiveStartDate,
                                    pt: row.pt,
                                    tds: row.tds,
                                    advanceBonus: row.advanceBonus,
                                  });
                                }}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="rounded p-1.5 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                                title="Save row"
                                disabled={masterRowSaving === row.employeeUserId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveMasterGridRow(row.employeeUserId);
                                }}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="rounded p-1.5 text-sky-700 hover:bg-sky-50"
                                title="Undo row changes"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  undoMasterGridRow(row.employeeUserId);
                                }}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M3 7v6h6M3 13a9 9 0 109-9 9 9 0 00-9 9" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

              </div>
            )}
          </div>
        </div>
      )}

      {editMasterOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <button
            type="button"
            className="fixed inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setEditMasterOpen(null)}
          />
          <div className="relative z-10 flex min-h-full items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
            <form
              onSubmit={handleSaveMaster}
              className="flex max-h-[min(92vh,calc(100dvh-2.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            >
              <div className="shrink-0 border-b border-slate-100 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
                <h3 className="text-lg font-semibold text-slate-900">Edit Payroll Master</h3>
                <p className="mt-1 text-sm text-slate-500">{editMasterOpen.employeeName || editMasterOpen.employeeEmail}</p>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Gross salary (monthly) *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={editGross}
                  onChange={(e) => {
                    const v = e.target.value;
                    const prevGross = parseFloat(editGross) || 0;
                    const g = parseFloat(v) || 0;
                    const basic = parseFloat(editBasic) || 0;
                    const hra = parseFloat(editHra) || 0;
                    const medical = parseFloat(editMedical) || 0;
                    const trans = parseFloat(editTrans) || 0;
                    const lta = parseFloat(editLta) || 0;
                    const personal = parseFloat(editPersonal) || 0;
                    const sum = basic + hra + medical + trans + lta + personal;
                    setEditGross(v);
                    if (g <= 0) return;
                    const empty = sum === 0;
                    const wasDefaultForPrev =
                      prevGross > 0 &&
                      isDefaultSalaryBreakupForGross(prevGross, basic, hra, medical, trans, lta, personal);
                    if (empty || wasDefaultForPrev) {
                      const s = defaultSalaryBreakup(g);
                      setEditBasic(String(s.basic));
                      setEditHra(String(s.hra));
                      setEditMedical(String(s.medical));
                      setEditTrans(String(s.trans));
                      setEditLta(String(s.lta));
                      setEditPersonal(String(s.personal));
                    }
                  }}
                  onBlur={() => {
                    const g = parseFloat(editGross) || 0;
                    if (g <= 0) return;
                    const sum =
                      (parseFloat(editBasic) || 0) +
                      (parseFloat(editHra) || 0) +
                      (parseFloat(editMedical) || 0) +
                      (parseFloat(editTrans) || 0) +
                      (parseFloat(editLta) || 0) +
                      (parseFloat(editPersonal) || 0);
                    if (Math.abs(sum - g) > 2) {
                      const s = defaultSalaryBreakup(g);
                      setEditBasic(String(s.basic));
                      setEditHra(String(s.hra));
                      setEditMedical(String(s.medical));
                      setEditTrans(String(s.trans));
                      setEditLta(String(s.lta));
                      setEditPersonal(String(s.personal));
                    }
                  }}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Salary breakdown (optional, for payslip)</p>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <label className="text-slate-600">Basic</label>
                    <input type="number" min="0" step="100" value={editBasic} onChange={(e) => setEditBasic(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-600">HRA</label>
                    <input type="number" min="0" step="100" value={editHra} onChange={(e) => setEditHra(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-600">Medical</label>
                    <input type="number" min="0" step="100" value={editMedical} onChange={(e) => setEditMedical(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-600">Trans</label>
                    <input type="number" min="0" step="100" value={editTrans} onChange={(e) => setEditTrans(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-600">LTA</label>
                    <input type="number" min="0" step="100" value={editLta} onChange={(e) => setEditLta(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-600">Personal</label>
                    <input type="number" min="0" step="100" value={editPersonal} onChange={(e) => setEditPersonal(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Leave all blank for auto-split from gross. When gross changes, Basic/HRA and other heads update if you were on the standard split. If the six fields don’t add up to gross, tab out of gross to align them.
                </p>
              </div>
              {editMasterPreview && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">Preview (same as server on Save)</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
                    <div>
                      <span className="text-slate-500">CTC </span>
                      <span className="font-medium tabular-nums text-slate-900">
                        {editMasterPreview.ctc > 0
                          ? `₹${Math.round(editMasterPreview.ctc).toLocaleString("en-IN")}`
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Take home </span>
                      <span className="font-medium tabular-nums text-slate-900">
                        {(parseFloat(editGross) || 0) > 0
                          ? `₹${Math.round(editMasterPreview.takeHome).toLocaleString("en-IN")}`
                          : "—"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 sm:col-span-1">
                      {(parseFloat(editGross) || 0) > 0 && (
                        <>
                          PT ₹{Math.round(editMasterPreview.ptMonthly).toLocaleString("en-IN")}
                          {editMasterPreview.pfEmp > 0 && ` · PF ₹${Math.round(editMasterPreview.pfEmp).toLocaleString("en-IN")}`}
                          {editMasterPreview.esicEmp > 0 && ` · ESIC ₹${Math.round(editMasterPreview.esicEmp).toLocaleString("en-IN")}`}
                          {editMasterPreview.tds > 0 && ` · TDS ₹${Math.round(editMasterPreview.tds).toLocaleString("en-IN")}`}
                          {editMasterPreview.advanceBonus > 0 &&
                            ` · Adv +₹${Math.round(editMasterPreview.advanceBonus).toLocaleString("en-IN")}`}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editPfEligible} onChange={(e) => setEditPfEligible(e.target.checked)} />
                  PF eligible
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editEsicEligible} onChange={(e) => setEditEsicEligible(e.target.checked)} />
                  ESIC eligible
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">PT (monthly)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={editPt}
                    onChange={(e) => setEditPt(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">TDS (monthly)</label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={editTds}
                    onChange={(e) => setEditTds(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Advance bonus</label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={editAdvanceBonus}
                    onChange={(e) => setEditAdvanceBonus(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Effective start date *</label>
                <DatePickerField value={editEffectiveDate} onChange={setEditEffectiveDate} required className="w-full" />
                <p className="mt-1 text-xs text-slate-500">
                  Saving creates a new payroll master from this date. The employee&apos;s previous open row is closed with an end date the day before this start date. Reason for change is stored on the new row.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Reason for change *</label>
                <select
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select reason</option>
                  <option value="NewJoin">New Join</option>
                  <option value="Promotion">Promotion</option>
                  <option value="Demotion">Demotion</option>
                  <option value="YearlyAppraisal">Yearly Appraisal</option>
                  <option value="Increment">Increment</option>
                  <option value="UpdateOnly">Update Only</option>
                </select>
              </div>
              </div>
              <div className="shrink-0 border-t border-slate-100 bg-slate-50/90 px-5 py-3 sm:px-6">
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-outline" onClick={() => setEditMasterOpen(null)} disabled={editSaving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={editSaving}>
                    {editSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === "run" && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Run monthly payroll</h2>
            <p className="muted mb-4">
              Generate payroll once per month for employees who have an active Payroll Master (effective end date empty).
              The master &quot;applicable month&quot; is when that salary structure starts; it does not limit which calendar month you run.
              Pay days are based on Mon–Fri (UTC) working days with sufficient attendance on those days; company holidays from your holiday calendar (including multi-day ranges) are excluded from working days and from attendance-based presence.
              The same working-day presence (not weekends or holidays) must reach at least 10 qualifying days in the run-through period (8-hour active rule after breaks) before pay days apply for salary proration. Below that, preview shows 0 pay days (you may override manually). Auto payroll skips payslips until the threshold is met when attendance data exists.
              Salary is prorated against working days in the full calendar month. If there is no attendance yet and no unpaid leave in the window, pay days default to all working days in the run-through date range (still subject to the 10 qualifying days rule when attendance exists).
            </p>
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
                    className={`btn btn-primary ${preview?.alreadyRun ? "cursor-not-allowed opacity-50" : ""}`}
                    disabled={running || preview?.alreadyRun}
                  >
                    {running ? "Generating..." : "Generate"}
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
                  <p className="text-sm text-amber-700">Payroll already run for this period.</p>
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
                      ? "Payroll generated for this period. Values are read-only."
                      : "Edit values before generating. Changing pay days will recalculate gross, PF, ESIC and deductions."}
                  </p>
                <div className="-mx-1 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[720px] table-fixed text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="w-[100px] px-1.5 py-1">Employee</th>
                      <th className="w-[52px] px-1 py-1">Days</th>
                      <th className="w-[60px] px-1 py-1">Gross</th>
                      <th className="w-[60px] px-1 py-1">Net</th>
                      <th className="w-[48px] px-1 py-1">PF</th>
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
                        <td className="truncate px-1.5 py-1 font-medium text-slate-900" title={r.employeeName || r.employeeEmail || undefined}>
                          {r.employeeName || r.employeeEmail || "—"}
                        </td>
                        <td className="px-1 py-1">
                          {readOnly ? (
                            <span className="py-0.5">{r.payDays}{r.unpaidLeaveDays > 0 ? ` (-${r.unpaidLeaveDays})` : ""}</span>
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
                        <td className="px-1 py-1">{readOnly ? <span>{r.grossPay.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.grossPay} onChange={(e) => updateEditableRow(r.employeeUserId, "grossPay", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.netPay.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.netPay} onChange={(e) => updateEditableRow(r.employeeUserId, "netPay", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.pfEmployee.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.pfEmployee} onChange={(e) => updateEditableRow(r.employeeUserId, "pfEmployee", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.pfEmployer.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.pfEmployer} onChange={(e) => updateEditableRow(r.employeeUserId, "pfEmployer", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.esicEmployee.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.esicEmployee} onChange={(e) => updateEditableRow(r.employeeUserId, "esicEmployee", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.esicEmployer.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.esicEmployer} onChange={(e) => updateEditableRow(r.employeeUserId, "esicEmployer", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.profTax.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.profTax} onChange={(e) => updateEditableRow(r.employeeUserId, "profTax", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.prBonus ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.prBonus ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "prBonus", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.incentive ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.incentive ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "incentive", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.reimbursement ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.reimbursement ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "reimbursement", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{(r.tds ?? 0).toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.tds ?? 0} onChange={(e) => updateEditableRow(r.employeeUserId, "tds", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.deductions.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.deductions} onChange={(e) => updateEditableRow(r.employeeUserId, "deductions", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span className="font-medium">{r.takeHome.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.takeHome} onChange={(e) => updateEditableRow(r.employeeUserId, "takeHome", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs font-medium focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                        <td className="px-1 py-1">{readOnly ? <span>{r.ctc.toLocaleString("en-IN")}</span> : <input type="number" min={0} value={r.ctc} onChange={(e) => updateEditableRow(r.employeeUserId, "ctc", parseInt(e.target.value, 10) || 0)} className="w-full min-w-0 rounded border border-sky-200 px-1 py-0.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />}</td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
                </div>
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
                          {company?.logoUrl ? (
                            <div className="payslip-logo-banner mb-3 flex justify-center border-b border-black/15 pb-3 print:mb-2 print:pb-2">
                              <img
                                src={company.logoUrl}
                                alt=""
                                className="h-16 max-h-[72px] w-auto max-w-[min(100%,280px)] object-contain object-center"
                              />
                            </div>
                          ) : null}
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
