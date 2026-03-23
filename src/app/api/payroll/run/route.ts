import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { overlapDaysInclusive } from "@/lib/leavePolicy";
import * as XLSX from "xlsx-js-style";

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function computePreview(
  companyId: string,
  year: number,
  month: number,
  runDay: number
): Promise<{
  periodName: string;
  periodStart: string;
  periodEnd: string;
  daysInMonth: number;
  effectiveRunDay: number;
  alreadyRun: boolean;
  existingPeriodId: string | null;
  rows: {
    employeeUserId: string;
    employeeName: string | null;
    employeeEmail: string;
    payDays: number;
    unpaidLeaveDays: number;
    grossPay: number;
    pfEmployee: number;
    pfEmployer: number;
    esicEmployee: number;
    esicEmployer: number;
    profTax: number;
    deductions: number;
    netPay: number;
    takeHome: number;
    ctc: number;
  }[];
}> {
  const daysInMonth = getDaysInMonth(year, month);
  const effectiveRunDay = Math.min(Math.max(1, runDay), daysInMonth);
  const periodStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month - 1, effectiveRunDay)).toISOString().slice(0, 10);
  const periodName = `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]}-${String(year).slice(-2)}`;

  const { data: existingPeriod } = await supabase
    .from("HRMS_payroll_periods")
    .select("id")
    .eq("company_id", companyId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  // When payroll already generated, return saved values from HRMS_payslips (not recalculated)
  if (existingPeriod?.id) {
    const { data: payslips } = await supabase
      .from("HRMS_payslips")
      .select("employee_user_id, pay_days, gross_pay, net_pay, pf_employee, pf_employer, esic_employee, esic_employer, professional_tax, incentive, pr_bonus, reimbursement, tds, deductions, ctc")
      .eq("payroll_period_id", existingPeriod.id)
      .eq("company_id", companyId);
    if (payslips?.length) {
      const userIds = payslips.map((p: any) => p.employee_user_id).filter(Boolean);
      const { data: users } = await supabase
        .from("HRMS_users")
        .select("id, name, email")
        .in("id", userIds);
      const userById = new Map((users ?? []).map((u: any) => [u.id, u]));
      const rows = payslips.map((p: any) => {
        const u = userById.get(p.employee_user_id);
        const net = Number(p.net_pay) ?? 0;
        const tds = Number(p.tds) ?? 0;
        const inc = Number(p.incentive) ?? 0;
        const bonus = Number(p.pr_bonus) ?? 0;
        const reimb = Number(p.reimbursement) ?? 0;
        const takeHome = net - tds + inc + bonus + reimb;
        return {
          employeeUserId: p.employee_user_id,
          employeeName: u?.name ?? null,
          employeeEmail: u?.email ?? "",
          payDays: Number(p.pay_days) ?? 0,
          unpaidLeaveDays: 0,
          grossPay: Math.round(Number(p.gross_pay) ?? 0),
          pfEmployee: Math.round(Number(p.pf_employee) ?? 0),
          pfEmployer: Math.round(Number(p.pf_employer) ?? 0),
          esicEmployee: Math.round(Number(p.esic_employee) ?? 0),
          esicEmployer: Math.round(Number(p.esic_employer) ?? 0),
          profTax: Math.round(Number(p.professional_tax) ?? 0),
          deductions: Math.round(Number(p.deductions) ?? 0),
          netPay: Math.round(net),
          incentive: inc,
          prBonus: bonus,
          reimbursement: reimb,
          tds,
          takeHome: Math.round(takeHome),
          ctc: Math.round(Number(p.ctc) ?? 0),
        };
      });
      return { periodName, periodStart, periodEnd, daysInMonth, effectiveRunDay, alreadyRun: true, existingPeriodId: existingPeriod.id, rows };
    }
  }

  const { data: company } = await supabase
    .from("HRMS_companies")
    .select("professional_tax_monthly")
    .eq("id", companyId)
    .single();
  const ptFixed = company?.professional_tax_monthly != null ? Number(company.professional_tax_monthly) : 200;

  const { data: masters } = await supabase
    .from("HRMS_payroll_master")
    .select("employee_user_id, gross_salary, ctc, pf_employee, pf_employer, esic_employee, esic_employer, basic, hra, medical, trans, lta, personal")
    .eq("company_id", companyId)
    .is("effective_end_date", null);
  if (!masters?.length) {
    return { periodName, periodStart, periodEnd, daysInMonth, effectiveRunDay, alreadyRun: !!existingPeriod, existingPeriodId: existingPeriod?.id ?? null, rows: [] };
  }

  const userIds = masters.map((m: any) => m.employee_user_id);
  const { data: users } = await supabase
    .from("HRMS_users")
    .select("id, name, email, date_of_joining, date_of_leaving, role")
    .in("id", userIds);

  const { data: leaves } = await supabase
    .from("HRMS_leave_requests")
    .select("employee_user_id, leave_type_id, start_date, end_date, total_days, paid_days, unpaid_days, HRMS_leave_types(is_paid)")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .in("employee_user_id", userIds);

  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));
  const periodStartDate = new Date(periodStart + "T00:00:00Z");
  const periodEndExclusive = new Date(Date.UTC(year, month - 1, effectiveRunDay + 1, 0, 0, 0, 0));

  const unpaidByUser = new Map<string, number>();
  for (const l of leaves ?? []) {
    if (!l.employee_user_id) continue;
    const start = new Date(String(l.start_date) + "T00:00:00Z");
    const end = new Date(String(l.end_date) + "T00:00:00Z");
    const overlap = overlapDaysInclusive(start, end, periodStartDate, periodEndExclusive);
    if (overlap <= 0) continue;
    const lt = (l as any).HRMS_leave_types;
    const isPaid = lt?.is_paid !== false;
    const total = Number(l.total_days) || 1;
    const unpaid = Number(l.unpaid_days) ?? 0;
    const paid = Number(l.paid_days) ?? (total - unpaid);
    let unpaidInOverlap: number;
    if (!isPaid) unpaidInOverlap = overlap;
    else unpaidInOverlap = total > 0 ? Math.round(overlap * (unpaid / total)) : 0;
    unpaidByUser.set(l.employee_user_id, (unpaidByUser.get(l.employee_user_id) || 0) + unpaidInOverlap);
  }

  const rows: any[] = [];
  for (const m of masters) {
    const u = userById.get(m.employee_user_id);
    if (!u || u.role === "super_admin") continue;

    const doj = u.date_of_joining ? new Date(String(u.date_of_joining) + "T00:00:00Z") : null;
    const dol = u.date_of_leaving ? new Date(String(u.date_of_leaving) + "T00:00:00Z") : null;

    if (dol && dol < periodStartDate) continue;
    if (doj && doj > periodEndExclusive) continue;

    let basePayDays = effectiveRunDay;
    if (dol && dol < periodEndExclusive) {
      basePayDays = Math.min(dol.getUTCDate(), effectiveRunDay);
    } else if (doj && doj >= periodStartDate && doj < periodEndExclusive) {
      const joinDay = doj.getUTCDate();
      basePayDays = Math.max(0, effectiveRunDay - joinDay + 1);
    }

    const unpaidLeaveDays = unpaidByUser.get(m.employee_user_id) || 0;
    const payDays = Math.max(0, Math.round(basePayDays - unpaidLeaveDays));
    if (payDays <= 0) continue;

    const grossMonthly = Number(m.gross_salary) || 0;
    const ctcMonthly = Number(m.ctc) || grossMonthly;
    if (grossMonthly <= 0) continue;

    const ratio = payDays / daysInMonth;
    const mb = Number(m.basic) ?? 0;
    const mh = Number(m.hra) ?? 0;
    const mm = Number(m.medical) ?? 0;
    const mt = Number(m.trans) ?? 0;
    const ml = Number(m.lta) ?? 0;
    const mp = Number(m.personal) ?? 0;
    const componentsSum = mb + mh + mm + mt + ml + mp;
    const basicMonthly = componentsSum > 0 ? mb : Math.round(grossMonthly * 0.5);
    const hraMonthly = componentsSum > 0 ? mh : Math.round(grossMonthly * 0.2);
    const medicalMonthly = componentsSum > 0 ? mm : Math.round(grossMonthly * 0.05);
    const transMonthly = componentsSum > 0 ? mt : Math.round(grossMonthly * 0.05);
    const ltaMonthly = componentsSum > 0 ? ml : Math.round(grossMonthly * 0.1);
    const personalMonthly = componentsSum > 0 ? mp : Math.round(grossMonthly * 0.1);

    const grossPay = Math.round((grossMonthly * payDays) / daysInMonth);
    const basicPay = Math.round(basicMonthly * ratio);
    const hraPay = Math.round(hraMonthly * ratio);
    const medicalPay = Math.round(medicalMonthly * ratio);
    const transPay = Math.round(transMonthly * ratio);
    const ltaPay = Math.round(ltaMonthly * ratio);
    const personalPay = Math.round(personalMonthly * ratio);
    const pfEmp = (Number(m.pf_employee) || 0) * (payDays / daysInMonth);
    const pfEmpr = (Number(m.pf_employer) || 0) * (payDays / daysInMonth);
    const esicEmp = (Number(m.esic_employee) || 0) * (payDays / daysInMonth);
    const esicEmpr = (Number(m.esic_employer) || 0) * (payDays / daysInMonth);
    const profTax = ptFixed;
    const deductions = Math.round(pfEmp + esicEmp + profTax);
    const netPay = grossPay - deductions;
    const incentive = 0;
    const prBonus = 0;
    const reimbursement = 0;
    const tds = 0;
    const takeHome = netPay - tds + incentive + prBonus + reimbursement;

    const ctcBase = Math.round(ctcMonthly);
    rows.push({
      employeeUserId: m.employee_user_id,
      employeeName: u.name,
      employeeEmail: u.email,
      payDays,
      unpaidLeaveDays,
      grossMonthly: Math.round(grossMonthly),
      grossPay,
      basicPay,
      hraPay,
      medicalPay,
      transPay,
      ltaPay,
      personalPay,
      pfEmployee: Math.round(pfEmp),
      pfEmployer: Math.round(pfEmpr),
      esicEmployee: Math.round(esicEmp),
      esicEmployer: Math.round(esicEmpr),
      profTax: Math.round(profTax),
      deductions,
      netPay,
      incentive,
      prBonus,
      reimbursement,
      tds,
      takeHome,
      ctc: ctcBase + incentive + prBonus,
      ctcBase,
    });
  }

  return { periodName, periodStart, periodEnd, daysInMonth, effectiveRunDay, alreadyRun: !!existingPeriod, existingPeriodId: existingPeriod?.id ?? null, rows };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1), 10);
  const runDay = parseInt(searchParams.get("runDay") || String(new Date().getDate()), 10);

  if (year < 2000 || year > 2100) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  if (month < 1 || month > 12) return NextResponse.json({ error: "Invalid month" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ preview: { periodName: "", periodStart: "", periodEnd: "", daysInMonth: 0, effectiveRunDay: 0, alreadyRun: false, existingPeriodId: null, rows: [] } });

  const preview = await computePreview(me.company_id, year, month, runDay);
  return NextResponse.json({ preview });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const year = typeof body?.year === "number" ? body.year : parseInt(String(body?.year || new Date().getFullYear()), 10);
  const month = typeof body?.month === "number" ? body.month : parseInt(String(body?.month || (new Date().getMonth() + 1)), 10);
  const runDay = typeof body?.runDay === "number" ? body.runDay : parseInt(String(body?.runDay || new Date().getDate()), 10);

  if (year < 2000 || year > 2100) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  if (month < 1 || month > 12) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  const daysInMonth = getDaysInMonth(year, month);
  const effectiveRunDay = Math.min(Math.max(1, runDay), daysInMonth);

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const periodStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month - 1, effectiveRunDay)).toISOString().slice(0, 10);
  const periodName = `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]}-${String(year).slice(-2)}`;

  const { data: existingPeriod } = await supabase
    .from("HRMS_payroll_periods")
    .select("id")
    .eq("company_id", me.company_id)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();
  if (existingPeriod) return NextResponse.json({ error: "Payroll already run for this period" }, { status: 400 });

  const { data: period, error: periodErr } = await supabase
    .from("HRMS_payroll_periods")
    .insert([{ company_id: me.company_id, period_name: periodName, period_start: periodStart, period_end: periodEnd }])
    .select("id")
    .single();
  if (periodErr) return NextResponse.json({ error: periodErr.message }, { status: 400 });

  const { data: company } = await supabase
    .from("HRMS_companies")
    .select("professional_tax_monthly")
    .eq("id", me.company_id)
    .single();
  const ptFixed = company?.professional_tax_monthly != null ? Number(company.professional_tax_monthly) : 200;

  const { data: masters } = await supabase
    .from("HRMS_payroll_master")
    .select("employee_user_id, gross_salary, ctc, pf_employee, pf_employer, esic_employee, esic_employer, basic, hra, medical, trans, lta, personal")
    .eq("company_id", me.company_id)
    .is("effective_end_date", null);
  if (!masters?.length) return NextResponse.json({ ok: true, periodId: period.id, periodName, periodStart, periodEnd, payslipsGenerated: 0 });

  const userIds = masters.map((m: any) => m.employee_user_id);
  const { data: users, error: usersErr } = await supabase
    .from("HRMS_users")
    .select("id, name, email, date_of_joining, date_of_leaving, role, bank_name, bank_account_number, bank_ifsc")
    .in("id", userIds);
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 400 });

  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));

  const overrideRows = Array.isArray(body?.rows) ? body.rows : null;

  let payslips: any[] = [];

  if (overrideRows?.length) {
    for (const row of overrideRows) {
      const employeeUserId = typeof row?.employeeUserId === "string" ? row.employeeUserId : null;
      if (!employeeUserId) continue;
      const u = userById.get(employeeUserId);
      if (!u || u.role === "super_admin") continue;
      const payDays = Math.max(0, Math.round(Number(row.payDays) || 0));
      const grossPay = Math.max(0, Math.round(Number(row.grossPay) || 0));
      const deductions = Math.max(0, Math.round(Number(row.deductions) || 0));
      const baseNet = grossPay - deductions;
      const incentive = Math.round(Number(row.incentive) || 0);
      const prBonus = Math.round(Number(row.prBonus) || 0);
      const reimbursement = Math.round(Number(row.reimbursement) || 0);
      const tds = Math.round(Number(row.tds) || 0);
      const takeHome = Math.round(Number(row.takeHome) ?? baseNet - tds + incentive + prBonus + reimbursement);
      const ctc = Math.max(0, Math.round(Number(row.ctc) || 0));
      const pfEmp = Math.round(Number(row.pfEmployee) || 0);
      const pfEmpr = Math.round(Number(row.pfEmployer) || 0);
      const esicEmp = Math.round(Number(row.esicEmployee) || 0);
      const esicEmpr = Math.round(Number(row.esicEmployer) || 0);
      const profTax = Math.round(Number(row.profTax) || 0);
      const basic = Math.round(Number(row.basicPay) || grossPay * 0.5);
      const hra = Math.round(Number(row.hraPay) || grossPay * 0.2);
      const medical = Math.round(Number(row.medicalPay) || grossPay * 0.05);
      const trans = Math.round(Number(row.transPay) || grossPay * 0.05);
      const lta = Math.round(Number(row.ltaPay) || grossPay * 0.1);
      const personal = Math.round(Number(row.personalPay) || grossPay * 0.1);
      const allowances = 0;
      payslips.push({
        company_id: me.company_id,
        employee_id: null,
        employee_user_id: employeeUserId,
        payroll_period_id: period.id,
        basic,
        hra,
        medical,
        trans,
        lta,
        personal,
        allowances,
        deductions,
        gross_pay: grossPay,
        net_pay: takeHome,
        pay_days: payDays,
        ctc,
        pf_employee: pfEmp,
        pf_employer: pfEmpr,
        esic_employee: esicEmp,
        esic_employer: esicEmpr,
        professional_tax: profTax,
        incentive,
        pr_bonus: prBonus,
        reimbursement,
        tds,
        bank_name: u?.bank_name ?? null,
        bank_account_number: u?.bank_account_number ?? null,
        bank_ifsc: u?.bank_ifsc ?? null,
      });
    }
  } else {
    const { data: leaves } = await supabase
      .from("HRMS_leave_requests")
      .select("employee_user_id, leave_type_id, start_date, end_date, total_days, paid_days, unpaid_days, HRMS_leave_types(is_paid)")
      .eq("company_id", me.company_id)
      .eq("status", "approved")
      .in("employee_user_id", userIds);

    const periodStartDate = new Date(periodStart + "T00:00:00Z");
    const periodEndExclusive = new Date(Date.UTC(year, month - 1, effectiveRunDay + 1, 0, 0, 0, 0));

    const unpaidByUser = new Map<string, number>();
    for (const l of leaves ?? []) {
      if (!l.employee_user_id) continue;
      const start = new Date(String(l.start_date) + "T00:00:00Z");
      const end = new Date(String(l.end_date) + "T00:00:00Z");
      const overlap = overlapDaysInclusive(start, end, periodStartDate, periodEndExclusive);
      if (overlap <= 0) continue;
      const lt = (l as any).HRMS_leave_types;
      const isPaid = lt?.is_paid !== false;
      const total = Number(l.total_days) || 1;
      const unpaid = Number(l.unpaid_days) ?? 0;
      let unpaidInOverlap: number;
      if (!isPaid) unpaidInOverlap = overlap;
      else unpaidInOverlap = total > 0 ? Math.round(overlap * (unpaid / total)) : 0;
      unpaidByUser.set(l.employee_user_id, (unpaidByUser.get(l.employee_user_id) || 0) + unpaidInOverlap);
    }

    for (const m of masters ?? []) {
      const u = userById.get(m.employee_user_id);
      if (!u || u.role === "super_admin") continue;

      const doj = u.date_of_joining ? new Date(String(u.date_of_joining) + "T00:00:00Z") : null;
      const dol = u.date_of_leaving ? new Date(String(u.date_of_leaving) + "T00:00:00Z") : null;

      if (dol && dol < periodStartDate) continue;
      if (doj && doj > periodEndExclusive) continue;

      let basePayDays = effectiveRunDay;
      if (dol && dol < periodEndExclusive) {
        basePayDays = Math.min(dol.getUTCDate(), effectiveRunDay);
      } else if (doj && doj >= periodStartDate && doj < periodEndExclusive) {
        const joinDay = doj.getUTCDate();
        basePayDays = Math.max(0, effectiveRunDay - joinDay + 1);
      }

      const unpaidLeaveDays = unpaidByUser.get(m.employee_user_id) || 0;
      const payDays = Math.max(0, Math.round(basePayDays - unpaidLeaveDays));
      if (payDays <= 0) continue;

      const grossMonthly = Number(m.gross_salary) || 0;
      const ctcMonthly = Number(m.ctc) || grossMonthly; // CTC from master = Gross + Employer PF + Employer ESIC
      if (grossMonthly <= 0) continue;

      const ratio = payDays / daysInMonth;
      const grossPay = Math.round((grossMonthly * payDays) / daysInMonth);
      const mb = Number(m.basic) ?? 0;
      const mh = Number(m.hra) ?? 0;
      const mm = Number(m.medical) ?? 0;
      const mt = Number(m.trans) ?? 0;
      const ml = Number(m.lta) ?? 0;
      const mp = Number(m.personal) ?? 0;
      const componentsSum = mb + mh + mm + mt + ml + mp;
      const basicPay = componentsSum > 0 ? Math.round(mb * ratio) : Math.round(grossPay * 0.5);
      const hraPay = componentsSum > 0 ? Math.round(mh * ratio) : Math.round(grossPay * 0.2);
      const medicalPay = componentsSum > 0 ? Math.round(mm * ratio) : Math.round(grossPay * 0.05);
      const transPay = componentsSum > 0 ? Math.round(mt * ratio) : Math.round(grossPay * 0.05);
      const ltaPay = componentsSum > 0 ? Math.round(ml * ratio) : Math.round(grossPay * 0.1);
      const personalPay = componentsSum > 0 ? Math.round(mp * ratio) : Math.round(grossPay * 0.1);
      const pfEmp = Math.round((Number(m.pf_employee) || 0) * (payDays / daysInMonth));
      const pfEmpr = Math.round((Number(m.pf_employer) || 0) * (payDays / daysInMonth));
      const esicEmp = Math.round((Number(m.esic_employee) || 0) * (payDays / daysInMonth));
      const esicEmpr = Math.round((Number(m.esic_employer) || 0) * (payDays / daysInMonth));
      const deductions = pfEmp + esicEmp + ptFixed;
      const netPay = grossPay - deductions;

      payslips.push({
        company_id: me.company_id,
        employee_id: null,
        employee_user_id: m.employee_user_id,
        payroll_period_id: period.id,
        basic: basicPay,
        hra: hraPay,
        medical: medicalPay,
        trans: transPay,
        lta: ltaPay,
        personal: personalPay,
        allowances: 0,
        deductions,
        gross_pay: grossPay,
        net_pay: netPay,
        pay_days: payDays,
        ctc: ctcMonthly,
        pf_employee: pfEmp,
        pf_employer: pfEmpr,
        esic_employee: esicEmp,
        esic_employer: esicEmpr,
        professional_tax: ptFixed,
        incentive: 0,
        pr_bonus: 0,
        reimbursement: 0,
        tds: 0,
        bank_name: u?.bank_name ?? null,
        bank_account_number: u?.bank_account_number ?? null,
        bank_ifsc: u?.bank_ifsc ?? null,
      });
    }
  }

  if (payslips.length) {
    const { error: slipErr } = await supabase.from("HRMS_payslips").insert(payslips);
    if (slipErr) return NextResponse.json({ error: slipErr.message }, { status: 400 });
  }

  let excelPath: string | null = null;
  if (payslips.length) {
    const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const fileName = `${monthNames[month]} ${year} Payroll`;

    const rows = payslips.map((p: any) => {
      const u = userById.get(p.employee_user_id);
      const accountNum = p.bank_account_number != null ? String(p.bank_account_number) : "";
      return {
        AccountNumber: accountNum,
        CTC: p.ctc ?? 0,
        EmployeeESIC: p.esic_employee ?? 0,
        EmployeeName: u?.name ?? "",
        EmployeePF: p.pf_employee ?? 0,
        EmployerESIC: p.esic_employer ?? 0,
        EmployerPF: p.pf_employer ?? 0,
        GrossSalary: p.gross_pay ?? 0,
        Incentive: p.incentive ?? 0,
        NetPay: p.net_pay ?? 0,
        PRBonus: p.pr_bonus ?? 0,
        PayDays: p.pay_days ?? 0,
        ProfessionalTax: p.professional_tax ?? 0,
        Reimbursement: p.reimbursement ?? 0,
        TDS: p.tds ?? 0,
        TakeHome: p.net_pay ?? 0,
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["AccountNumber", "CTC", "EmployeeESIC", "EmployeeName", "EmployeePF", "EmployerESIC", "EmployerPF", "GrossSalary", "Incentive", "NetPay", "PRBonus", "PayDays", "ProfessionalTax", "Reimbursement", "TDS", "TakeHome"],
    });
    ws["!cols"] = [
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 20 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
    ];
    const amountCols = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const rowCount = payslips.length + 1;
    for (let r = 1; r <= rowCount; r++) {
      for (const c of amountCols) {
        const ref = XLSX.utils.encode_cell({ r: r - 1, c });
        if (ws[ref]) ws[ref].s = { alignment: { horizontal: "center", vertical: "center" } };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payroll");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "photomedia";
    excelPath = `HRMS/${me.company_id}/monthly payroll/${fileName}.xlsx`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(excelPath, buf, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: true,
      });
    if (!uploadErr) {
      await supabase
        .from("HRMS_payroll_periods")
        .update({ excel_file_path: excelPath })
        .eq("id", period.id);
    }
  }

  return NextResponse.json({
    ok: true,
    periodId: period.id,
    periodName,
    periodStart,
    periodEnd,
    payslipsGenerated: payslips.length,
    excelPath: excelPath ?? undefined,
  });
}
