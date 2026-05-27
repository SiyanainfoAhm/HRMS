import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";
import {
  buildPayrollExcelRow,
  PAYROLL_EXCEL_HEADER,
  payrollExcelAmountColumnIndices,
  type GovernmentMonthlyRow,
} from "@/lib/payrollExcelExport";
import * as XLSX from "xlsx-js-style";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

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

export async function GET(request: NextRequest) {
  const periodId =
    request.nextUrl.searchParams.get("periodId") ??
    request.nextUrl.searchParams.get("period_id");

  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${API_BASE}/payroll/export?period_id=${encodeURIComponent(periodId)}`, {
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

  const periodStart = String(payload.period?.periodStart ?? payload.period?.period_start ?? "");
  const [y, m] = periodStart.split("-").map(Number);
  const fileName =
    y && m
      ? `${MONTH_NAMES[m] ?? "Payroll"} ${y} Payroll.xlsx`
      : `${payload.period?.periodName ?? "Payroll"}.xlsx`;

  const rows = payslips.map((p) => {
    const uid = String(p.employee_user_id ?? p.employeeUserId ?? "");
    const slip = payslipForExcel(p);
    const mode = slip.payroll_mode;
    const govRow = mode === "government" ? govByUser.get(uid) : null;
    return buildPayrollExcelRow(
      slip,
      nameById.get(uid) ?? "",
      govRow ? { kind: "row", row: govRow } : null,
    );
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...PAYROLL_EXCEL_HEADER] });
  ws["!cols"] = PAYROLL_EXCEL_HEADER.map((_, i) => ({ wch: i < 2 ? 20 : 12 }));
  const amountCols = payrollExcelAmountColumnIndices();
  const rowCount = rows.length + 1;
  for (let r = 1; r <= rowCount; r++) {
    for (const c of amountCols) {
      const ref = XLSX.utils.encode_cell({ r: r - 1, c });
      if (ws[ref]) {
        ws[ref].s = { alignment: { horizontal: "center", vertical: "center" } };
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payroll");
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
