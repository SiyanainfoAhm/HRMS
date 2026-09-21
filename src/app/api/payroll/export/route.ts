import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import {
  buildPayrollExcelRow,
  buildPayrollExcelHeaders,
  collectDynamicPayrollExcelColumns,
  payrollExcelAmountColumnIndices,
  type GovernmentMonthlyRow,
} from "@/lib/payrollExcelExport";
import {
  buildMonthlySummarySheet,
  payrollOrgFilterHeaderLines,
  type PayrollRunExportRow,
} from "@/lib/payrollRunWorkbook";
import * as XLSX from "xlsx-js-style";
import {
  applyBodyCellStyle,
  applyColumnHeaderStyle,
  applyCurrencyCellStyle,
  applyIntegerCellStyle,
  applyMetaStyle,
  applyReportTitleStyle,
  applyStatusBannerStyle,
  applyTotalCurrencyStyle,
  applyTotalRowStyle,
  autoFitColumnsWithLimits,
  configurePayrollPrintSetup,
  mergeCells,
  writeStyledCell,
} from "@/lib/payrollExcelStyles";

import { getApiBaseUrl } from "@/lib/apiBase";

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const TEXT_HEADERS = new Set([
  "AccountNumber",
  "EmployeeName",
  "EmployeeCode",
  "Division",
  "Department",
  "Remarks",
  "NightAllowanceEligible",
  "QuarterName",
  "QuarterType",
]);

function payslipForExcel(p: Record<string, unknown>) {
  return {
    employee_user_id: String(p.employee_user_id ?? p.employeeUserId ?? ""),
    payroll_mode: (p.payroll_mode ?? p.payrollMode) as string | null,
    bank_account_number: (p.bank_account_number ?? p.bankAccountNumber) as string | null,
    ctc: p.ctc as number | null,
    gross_pay: (p.gross_pay ?? p.grossPay) as number | null,
    net_pay: (p.net_pay ?? p.netPay) as number | null,
    pay_days: (p.pay_days ?? p.payDays) as number | null,
    basic: p.basic as number | null,
    hra: p.hra as number | null,
    medical: p.medical as number | null,
    trans: p.trans as number | null,
    lta: p.lta as number | null,
    personal: p.personal as number | null,
    deductions: p.deductions as number | null,
    pf_employee: (p.pf_employee ?? p.pfEmployee) as number | null,
    pf_employer: (p.pf_employer ?? p.pfEmployer) as number | null,
    esic_employee: (p.esic_employee ?? p.esicEmployee) as number | null,
    esic_employer: (p.esic_employer ?? p.esicEmployer) as number | null,
    professional_tax: (p.professional_tax ?? p.professionalTax) as number | null,
    incentive: p.incentive as number | null,
    pr_bonus: (p.pr_bonus ?? p.prBonus) as number | null,
    reimbursement: p.reimbursement as number | null,
    tds: p.tds as number | null,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function camelGov(g: GovernmentMonthlyRow): Record<string, unknown> {
  return {
    ...g,
    basicPaid: g.basic_paid,
    daPaid: g.da_paid,
    hraPaid: g.hra_paid,
    medicalPaid: g.medical_paid,
    transportPaid: g.transport_paid,
    spPayPaid: g.sp_pay_paid,
    extraWorkAllowancePaid: g.extra_work_allowance_paid,
    nightAllowancePaid: g.night_allowance_paid,
    uniformAllowancePaid: g.uniform_allowance_paid,
    educationAllowancePaid: g.education_allowance_paid,
    daArrearsPaid: g.da_arrears_paid,
    transportArrearsPaid: g.transport_arrears_paid,
    encashmentPaid: g.encashment_paid,
    encashmentDaPaid: g.encashment_da_paid,
    totalEarnings: g.total_earnings,
    totalDeductions: g.total_deductions,
    netSalary: g.net_salary,
    customEarnings: g.custom_earnings,
    customDeductions: g.custom_deductions,
    leaveRemarks: g.leave_remarks,
    hasQuarter: g.has_quarter,
    quarterName: g.quarter_name,
    quarterType: g.quarter_type,
    deductions: {
      incomeTax: g.income_tax_amount,
      pt: g.pt_amount,
      lic: g.lic_amount,
      cpf: g.cpf_amount,
      daCpf: g.da_cpf_amount,
      vpf: g.vpf_amount,
      pfLoan: g.pf_loan_amount,
      postOffice: g.post_office_amount,
      creditSociety: g.credit_society_amount,
      electricity: g.electricity_amount,
      water: g.water_amount,
      mess: g.mess_amount,
      loanRecovery: g.loan_recovery_amount,
      welfare: g.welfare_amount,
      hpl: g.hpl_amount,
      eol: g.eol_amount,
      vehCharge: g.veh_charge_amount,
      other: g.other_deduction_amount,
      quarterRent: g.quarter_rent_amount,
    },
  };
}

function buildFinalizedDetailSheet(opts: {
  excelHeaders: string[];
  rowObjects: Array<Record<string, string | number>>;
  month: number;
  year: number;
  divisionName?: string | null;
  departmentName?: string | null;
  designationName?: string | null;
}): XLSX.WorkSheet {
  const { excelHeaders: headers, rowObjects, month, year } = opts;
  const amountCols = new Set(payrollExcelAmountColumnIndices(headers.length));
  const ws = XLSX.utils.aoa_to_sheet([]) as XLSX.WorkSheet;
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  ws["!rows"] = [];
  const lastCol = Math.max(0, headers.length - 1);

  const write = (r: number, c: number, value: string | number, style?: Parameters<typeof writeStyledCell>[5]) => {
    writeStyledCell(XLSX.utils.encode_cell, ws as unknown as Record<string, unknown>, r, c, value, style);
  };

  const title = `CIRT PAYROLL – ${(MONTH_NAMES[month] ?? month).toString().toUpperCase()} ${year}`;
  write(0, 0, title, applyReportTitleStyle());
  for (let c = 1; c <= lastCol; c++) write(0, c, "", applyReportTitleStyle());
  mergeCells(merges, 0, 0, 0, lastCol);
  (ws["!rows"] as Array<{ hpt?: number }>)[0] = { hpt: 28 };

  write(1, 0, "FINALIZED", applyStatusBannerStyle("final"));
  for (let c = 1; c <= lastCol; c++) write(1, c, "", applyStatusBannerStyle("final"));
  mergeCells(merges, 1, 0, 1, lastCol);
  (ws["!rows"] as Array<{ hpt?: number }>)[1] = { hpt: 20 };

  const filterLines = payrollOrgFilterHeaderLines(opts);
  let nextRow = 2;
  for (const line of filterLines) {
    write(nextRow, 0, line, applyMetaStyle());
    for (let c = 1; c <= lastCol; c++) write(nextRow, c, "", applyMetaStyle());
    mergeCells(merges, nextRow, 0, nextRow, lastCol);
    (ws["!rows"] as Array<{ hpt?: number }>)[nextRow] = { hpt: 18 };
    nextRow += 1;
  }
  const headerRow = filterLines.length > 0 ? nextRow : 3;
  headers.forEach((h, c) => write(headerRow, c, h, applyColumnHeaderStyle()));
  (ws["!rows"] as Array<{ hpt?: number }>)[headerRow] = { hpt: 30 };

  const dataStart = headerRow + 1;
  const totalAcc: Record<string, number> = {};
  for (const h of headers) {
    if (!TEXT_HEADERS.has(h) && h !== "PayLevel") totalAcc[h] = 0;
  }

  rowObjects.forEach((rowObj, idx) => {
    const excelRow = dataStart + idx;
    const alt = idx % 2 === 1;
    let remarksLen = 0;
    headers.forEach((h, c) => {
      const raw = rowObj[h];
      const isText = TEXT_HEADERS.has(h) || typeof raw === "string";
      const isAmount = amountCols.has(c) && !isText;
      let value: string | number = raw ?? "";
      if (isAmount && raw != null && !(typeof raw === "string" && raw === "")) {
        value = num(raw);
        if (h in totalAcc) totalAcc[h] += value;
      }
      if (h === "Remarks") remarksLen = String(value ?? "").length;
      if (isAmount) write(excelRow, c, value === "" ? 0 : value, applyCurrencyCellStyle({ alt }));
      else if (h === "AccountNumber") {
        const acct = raw == null ? "" : String(raw);
        const style = applyBodyCellStyle({ align: "left", alt });
        style.numFmt = "@";
        write(excelRow, c, acct, style);
      } else if (h === "PayDays" || h === "PayLevel" || h === "NightHours" || h === "ElectricityUnits") {
        write(excelRow, c, num(raw), applyIntegerCellStyle());
      } else {
        write(excelRow, c, value, applyBodyCellStyle({ align: "left", alt }));
      }
    });
    (ws["!rows"] as Array<{ hpt?: number }>)[excelRow] = {
      hpt: remarksLen > 40 ? Math.min(60, 18 + Math.ceil(remarksLen / 30) * 12) : 18,
    };
  });

  const totalsRow = dataStart + rowObjects.length;
  headers.forEach((h, c) => {
    if (c === 0) {
      write(totalsRow, c, "TOTALS", applyTotalRowStyle("gross"));
      return;
    }
    if (h in totalAcc && !TEXT_HEADERS.has(h)) {
      write(totalsRow, c, totalAcc[h], applyTotalCurrencyStyle("gross"));
    } else {
      write(totalsRow, c, "", applyTotalRowStyle("gross"));
    }
  });
  (ws["!rows"] as Array<{ hpt?: number }>)[totalsRow] = { hpt: 22 };

  for (const h of ["GrossTotal", "TotalDeductions", "NetPay", "Basic", "DA"]) {
    const c = headers.indexOf(h);
    if (c < 0 || rowObjects.length === 0) continue;
    const start = XLSX.utils.encode_cell({ r: dataStart, c });
    const end = XLSX.utils.encode_cell({ r: totalsRow - 1, c });
    const ref = XLSX.utils.encode_cell({ r: totalsRow, c });
    (ws as Record<string, unknown>)[ref] = {
      t: "n",
      f: `SUM(${start}:${end})`,
      s: applyTotalCurrencyStyle("gross"),
      z: '"₹"#,##0.00',
    };
  }

  ws["!merges"] = merges;
  ws["!cols"] = autoFitColumnsWithLimits(
    headers.map((h, i) => (i < 2 ? 22 : h === "Remarks" ? 28 : TEXT_HEADERS.has(h) ? 16 : 12)),
    { min: 10, max: 36 },
  );
  configurePayrollPrintSetup(ws as unknown as Record<string, unknown>, {
    lastRow0: totalsRow,
    lastCol0: lastCol,
    freezeRows: headerRow + 1,
    landscape: true,
    titleRows: headerRow + 1,
    autoFilterRef: `A${headerRow + 1}:${XLSX.utils.encode_col(lastCol)}${totalsRow}`,
  });
  (ws as { "!ref"?: string })["!ref"] = `A1:${XLSX.utils.encode_col(lastCol)}${totalsRow + 1}`;
  return ws;
}

export async function GET(request: NextRequest) {
  const periodId =
    request.nextUrl.searchParams.get("periodId") ??
    request.nextUrl.searchParams.get("period_id");

  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!token || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const divisionName = request.nextUrl.searchParams.get("divisionName")?.trim() || undefined;
  const departmentName = request.nextUrl.searchParams.get("departmentName")?.trim() || undefined;
  const designationName = request.nextUrl.searchParams.get("designationName")?.trim() || undefined;

  const exportParams = new URLSearchParams({ period_id: periodId });
  for (const [key, target] of [
    ["divisionId", "division_id"],
    ["division_id", "division_id"],
    ["departmentId", "department_id"],
    ["department_id", "department_id"],
    ["employeeUserIds", "employee_user_ids"],
    ["employee_user_ids", "employee_user_ids"],
    ["division", "division"],
    ["department", "department"],
  ] as const) {
    const v = request.nextUrl.searchParams.get(key);
    if (v) exportParams.set(target, v);
  }

  const res = await fetch(`${getApiBaseUrl()}/payroll/export?${exportParams.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: payload?.error || "Failed to load payroll export data" },
      { status: res.status },
    );
  }

  const payslips = (payload.payslips ?? []) as Record<string, unknown>[];
  if (!payslips.length) {
    return NextResponse.json({ error: "No payslips found" }, { status: 404 });
  }

  const users = (payload.users ?? []) as { id: string; name?: string | null }[];
  const nameById = new Map(users.map((u) => [u.id, u.name ?? ""]));

  const govList = (payload.governmentMonthly ?? []) as Record<string, unknown>[];
  const govByUser = new Map(
    govList.map((g) => [
      String(g.employee_user_id ?? g.employeeUserId ?? ""),
      g as GovernmentMonthlyRow,
    ]),
  );

  const payrollFields = (payload.payrollConfig?.fields ?? payload.payrollFields ?? []) as Array<{
    fieldKey?: string;
    field_key?: string;
    fieldLabel?: string;
    field_label?: string;
  }>;
  const fieldLabelByKey = new Map(
    payrollFields.map((f) => [
      String(f.fieldKey ?? f.field_key ?? ""),
      String(f.fieldLabel ?? f.field_label ?? ""),
    ]),
  );
  const dynamicCols = collectDynamicPayrollExcelColumns(govList, fieldLabelByKey);
  const excelHeaders = buildPayrollExcelHeaders(dynamicCols);

  const periodStart = String(payload.period?.periodStart ?? payload.period?.period_start ?? "");
  const [y, m] = periodStart.split("-").map(Number);
  const fileName =
    y && m
      ? `CIRT_Payroll_Final_${(MONTH_NAMES[m] ?? "Payroll").slice(0, 3)}_${y}.xlsx`
      : `${payload.period?.periodName ?? "Payroll"}.xlsx`;

  const rowObjects = payslips.map((p) => {
    const uid = String(p.employee_user_id ?? p.employeeUserId ?? "");
    const slip = payslipForExcel(p);
    const mode = slip.payroll_mode;
    const govRow = mode === "government" ? govByUser.get(uid) : null;
    return buildPayrollExcelRow(
      slip,
      nameById.get(uid) ?? "",
      govRow ? { kind: "row", row: govRow } : null,
      dynamicCols,
    ) as Record<string, string | number>;
  });

  const summaryRows: PayrollRunExportRow[] = payslips.map((p) => {
    const uid = String(p.employee_user_id ?? p.employeeUserId ?? "");
    const gov = govByUser.get(uid);
    return {
      employeeUserId: uid,
      employeeName: nameById.get(uid) ?? null,
      payDays: num(p.pay_days ?? p.payDays),
      grossPay: num(p.gross_pay ?? p.grossPay),
      netPay: num(p.net_pay ?? p.netPay),
      deductions: num(p.deductions),
      incentive: num(p.incentive),
      prBonus: num(p.pr_bonus ?? p.prBonus),
      reimbursement: num(p.reimbursement),
      tds: num(p.tds),
      bankAccountNumber: (p.bank_account_number ?? p.bankAccountNumber) as string | null,
      payrollMode: String(p.payroll_mode ?? p.payrollMode ?? "government"),
      governmentMonthly: gov ? camelGov(gov) : null,
    };
  });

  const wb = XLSX.utils.book_new();
  const month = m || new Date().getMonth() + 1;
  const year = y || new Date().getFullYear();

  XLSX.utils.book_append_sheet(
    wb,
    buildFinalizedDetailSheet({
      excelHeaders,
      rowObjects,
      month,
      year,
      divisionName,
      departmentName,
      designationName,
    }),
    "Employee Detail",
  );

  XLSX.utils.book_append_sheet(
    wb,
    buildMonthlySummarySheet(summaryRows, {
      month,
      year,
      status: "Finalized",
      exportedBy: session.name ?? session.email ?? undefined,
      divisionName,
      departmentName,
      designationName,
    }),
    "Monthly Summary",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
