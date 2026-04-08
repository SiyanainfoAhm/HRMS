import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { overlapDaysInclusive } from "@/lib/leavePolicy";
import { effectiveLunchBreakMinutes } from "@/lib/attendancePolicy";
import * as XLSX from "xlsx-js-style";

/** Minimum active work hours (after lunch/tea breaks) for a day to count as present in payroll. */
const MIN_ACTIVE_HOURS_FOR_PRESENT = 8;

// Removed minimum-qualifying-days gating. Pay days must reflect attendance/leave directly.

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toUtcMidnightFromYmd(ymd: string): Date {
  return new Date(String(ymd).slice(0, 10) + "T00:00:00Z");
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 0, 0, 0, 0));
}

function* iterateYmdInclusive(startYmd: string, endYmd: string): Generator<string> {
  let d = toUtcMidnightFromYmd(startYmd);
  const end = toUtcMidnightFromYmd(endYmd);
  while (d.getTime() <= end.getTime()) {
    yield toYmdUtc(d);
    d = addDaysUtc(d, 1);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function countCalendarDaysInclusive(startYmd: string, endYmd: string): number {
  if (startYmd > endYmd) return 0;
  const s = toUtcMidnightFromYmd(startYmd).getTime();
  const e = toUtcMidnightFromYmd(endYmd).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Pay days = present + paid leave, capped by eligible employment days in the period.
 * If there are no punches and no approved leave in the window, attendance maps are empty
 * (typical for future months or before logs exist). In that case use full eligible days so
 * Run Payroll / preview still lists employees. If unpaid leave was recorded for the period,
 * do not assume full pay (pay days stay 0 until present/paid leave are captured).
 */
function resolvePayDaysFromAttendance(args: {
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  /** Max payable days in window (calendar days ∩ employment). */
  eligibleDays: number;
}): number {
  const { presentDays, paidLeaveDays, unpaidLeaveDays, eligibleDays } = args;
  const cap = Math.max(0, eligibleDays);
  // Do not auto-fill pay days. Base strictly on presence/leave.
  const payDays = clamp(Math.round(presentDays + paidLeaveDays - unpaidLeaveDays), 0, cap);
  return payDays;
}

// Note: Payroll days are calendar days; we don’t surface “working days” to avoid confusion.

/** Company holidays (single or multi-day) that fall inside [rangeStartYmd, rangeEndYmd]. */
async function loadCompanyHolidayDateSet(
  companyId: string,
  rangeStartYmd: string,
  rangeEndYmd: string
): Promise<Set<string>> {
  const set = new Set<string>();
  const { data, error } = await supabase
    .from("HRMS_holidays")
    .select("holiday_date, holiday_end_date")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  for (const h of data ?? []) {
    const start = String((h as any).holiday_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const endRaw = (h as any).holiday_end_date != null ? String((h as any).holiday_end_date).slice(0, 10) : start;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) && endRaw >= start ? endRaw : start;
    for (const ymd of iterateYmdInclusive(start, end)) {
      if (ymd >= rangeStartYmd && ymd <= rangeEndYmd) set.add(ymd);
    }
  }
  return set;
}

type LeaveRow = {
  employee_user_id: string | null;
  start_date: string;
  end_date: string;
  total_days: number | null;
  paid_days: number | null;
  unpaid_days: number | null;
  // Supabase nested select may return object OR array depending on relationship shape
  HRMS_leave_types?: { is_paid: boolean } | { is_paid: boolean }[] | null;
};

function computeLeavePaidUnpaidInWindow(
  leave: LeaveRow,
  windowStartYmd: string,
  windowEndExclusive: Date
): { overlapDays: number; paidDays: number; unpaidDays: number; leaveDays: Set<string> } {
  const leaveDays = new Set<string>();
  const start = new Date(String(leave.start_date).slice(0, 10) + "T00:00:00Z");
  const end = new Date(String(leave.end_date).slice(0, 10) + "T00:00:00Z");
  const windowStart = new Date(windowStartYmd + "T00:00:00Z");
  const overlap = overlapDaysInclusive(start, end, windowStart, windowEndExclusive);
  if (overlap <= 0) return { overlapDays: 0, paidDays: 0, unpaidDays: 0, leaveDays };

  const overlapStart = start.getTime() > windowStart.getTime() ? toYmdUtc(start) : windowStartYmd;
  const overlapEndInclusive = toYmdUtc(new Date(windowEndExclusive.getTime() - 24 * 60 * 60 * 1000));
  const effectiveEndInclusive =
    toUtcMidnightFromYmd(end.toISOString().slice(0, 10)).getTime() <
    toUtcMidnightFromYmd(overlapEndInclusive).getTime()
      ? toYmdUtc(end)
      : overlapEndInclusive;

  for (const ymd of iterateYmdInclusive(overlapStart, effectiveEndInclusive)) leaveDays.add(ymd);

  const ltRaw: any = (leave as any).HRMS_leave_types;
  const ltObj: any = Array.isArray(ltRaw) ? ltRaw[0] : ltRaw;
  const isPaidType = ltObj?.is_paid !== false;
  const total = Number(leave.total_days) || 1;
  const unpaid = Number(leave.unpaid_days) ?? 0;
  const unpaidInOverlap = isPaidType ? (total > 0 ? Math.round(overlap * (unpaid / total)) : 0) : overlap;
  const paidInOverlap = Math.max(0, overlap - unpaidInOverlap);
  return { overlapDays: overlap, paidDays: paidInOverlap, unpaidDays: unpaidInOverlap, leaveDays };
}

async function computeAttendanceDrivenPayDays(args: {
  companyId: string;
  userIds: string[];
  periodStartYmd: string;
  periodEndExclusive: Date;
  effectiveRunDay: number;
  year: number;
  month: number;
}): Promise<{
  presentDaysByUser: Map<string, number>;
  paidLeaveDaysByUser: Map<string, number>;
  unpaidLeaveDaysByUser: Map<string, number>;
}> {
  const { companyId, userIds, periodStartYmd, periodEndExclusive } = args;

  // Map user -> employee_id for attendance logs
  const { data: employees, error: empErr } = await supabase
    .from("HRMS_employees")
    .select("id, user_id")
    .eq("company_id", companyId)
    .in("user_id", userIds);
  if (empErr) throw new Error(empErr.message);
  const employeeIdByUser = new Map<string, string>();
  for (const e of employees ?? []) {
    if (e?.user_id && e?.id) employeeIdByUser.set(e.user_id as string, e.id as string);
  }
  const employeeIds = [...employeeIdByUser.values()];

  // Approved leaves (paid/unpaid totals + leave day override)
  const { data: leaves, error: leaveErr } = await supabase
    .from("HRMS_leave_requests")
    .select("employee_user_id, start_date, end_date, total_days, paid_days, unpaid_days, HRMS_leave_types(is_paid)")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .in("employee_user_id", userIds);
  if (leaveErr) throw new Error(leaveErr.message);

  const paidLeaveDaysByUser = new Map<string, number>();
  const unpaidLeaveDaysByUser = new Map<string, number>();
  const leaveDaysByUser = new Map<string, Set<string>>();
  for (const lAny of (leaves ?? []) as any[]) {
    const l = lAny as LeaveRow;
    const uid = l?.employee_user_id;
    if (!uid) continue;
    const r = computeLeavePaidUnpaidInWindow(l, periodStartYmd, periodEndExclusive);
    if (r.overlapDays <= 0) continue;
    // Calendar-day model: keep paid/unpaid days as-is (no working-day scaling).
    paidLeaveDaysByUser.set(uid, (paidLeaveDaysByUser.get(uid) || 0) + Math.round(r.paidDays));
    unpaidLeaveDaysByUser.set(uid, (unpaidLeaveDaysByUser.get(uid) || 0) + Math.round(r.unpaidDays));
    const set = leaveDaysByUser.get(uid) || new Set<string>();
    for (const d of r.leaveDays) set.add(d);
    leaveDaysByUser.set(uid, set);
  }

  const presentDaysByUser = new Map<string, number>();
  if (!employeeIds.length) {
    return { presentDaysByUser, paidLeaveDaysByUser, unpaidLeaveDaysByUser };
  }

  const periodEndYmdInclusive = toYmdUtc(new Date(periodEndExclusive.getTime() - 24 * 60 * 60 * 1000));
  const { data: att, error: attErr } = await supabase
    .from("HRMS_attendance_logs")
    .select(
      "employee_id, work_date, check_in_at, check_out_at, total_hours, lunch_break_minutes, tea_break_minutes, lunch_check_out_at, lunch_check_in_at"
    )
    .eq("company_id", companyId)
    .in("employee_id", employeeIds)
    .gte("work_date", periodStartYmd)
    .lte("work_date", periodEndYmdInclusive);
  if (attErr) throw new Error(attErr.message);

  const userIdByEmployeeId = new Map<string, string>();
  for (const [uid, eid] of employeeIdByUser.entries()) userIdByEmployeeId.set(eid, uid);

  for (const row of att ?? []) {
    const eid = row.employee_id as string | null;
    if (!eid) continue;
    const uid = userIdByEmployeeId.get(eid);
    if (!uid) continue;

    const workDate = String(row.work_date).slice(0, 10);
    const leaveSet = leaveDaysByUser.get(uid);
    if (leaveSet?.has(workDate)) continue; // leave overrides punch-based presence
    // Calendar-day model: attendance counts any calendar day with sufficient active hours.

    const teaMin = clamp(Number((row as any).tea_break_minutes ?? 0) || 0, 0, 24 * 60);

    let durationMinutes: number | null = null;
    const inAt = row.check_in_at ? new Date(String(row.check_in_at)) : null;
    const outAt = row.check_out_at ? new Date(String(row.check_out_at)) : null;
    if (inAt && outAt && !Number.isNaN(inAt.getTime()) && !Number.isNaN(outAt.getTime())) {
      durationMinutes = Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60000));
    } else if (row.total_hours != null) {
      const th = Number(row.total_hours) || 0;
      durationMinutes = Math.max(0, Math.round(th * 60));
    }
    if (durationMinutes == null) continue;

    const lunchMin = effectiveLunchBreakMinutes({
      recordedLunchMinutes: Number((row as any).lunch_break_minutes ?? 0) || 0,
      lunchCheckOutAt: (row as any).lunch_check_out_at,
      lunchCheckInAt: (row as any).lunch_check_in_at,
      grossWorkMinutes: durationMinutes,
    });
    const breakMin = lunchMin + teaMin;

    const activeMinutes = Math.max(0, durationMinutes - breakMin);
    const activeHours = activeMinutes / 60;
    if (activeHours >= MIN_ACTIVE_HOURS_FOR_PRESENT) {
      presentDaysByUser.set(uid, (presentDaysByUser.get(uid) || 0) + 1);
    }
  }

  return { presentDaysByUser, paidLeaveDaysByUser, unpaidLeaveDaysByUser };
}

/** Match payroll run calendar month to expense claim_date (YYYY-MM-DD), not stored payroll_* columns. */
function claimDateMatchesPayrollMonth(claimDateStr: string | null | undefined, year: number, month: number): boolean {
  const raw = claimDateStr != null ? String(claimDateStr).slice(0, 10) : "";
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(raw);
  if (!m) return false;
  return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month;
}

/** After payroll is generated for a period, mark all approved (unpaid) reimbursements for that company whose claim falls in that calendar month. */
async function markReimbursementsPaidForPayrollMonth(
  companyId: string,
  periodId: string,
  year: number,
  month: number
): Promise<void> {
  const { data: pendingReimb, error } = await supabase
    .from("HRMS_reimbursements")
    .select("id, claim_date")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .is("included_in_payroll_period_id", null);
  if (error) throw new Error(error.message);
  const idsToMark = (pendingReimb ?? [])
    .filter((r: any) => claimDateMatchesPayrollMonth(r.claim_date, year, month))
    .map((r: any) => r.id);
  if (!idsToMark.length) return;
  const { error: upErr } = await supabase
    .from("HRMS_reimbursements")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      included_in_payroll_period_id: periodId,
    })
    .in("id", idsToMark);
  if (upErr) throw new Error(upErr.message);
}

/** Approved reimbursements for this payroll month, not yet paid out on a payslip. */
async function fetchApprovedReimbursementTotalsByUser(
  companyId: string,
  year: number,
  month: number
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("HRMS_reimbursements")
    .select("employee_user_id, amount, claim_date")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .is("included_in_payroll_period_id", null);
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    if (!claimDateMatchesPayrollMonth(r.claim_date as string, year, month)) continue;
    const uid = r.employee_user_id as string | null;
    if (!uid) continue;
    const amt = Number(r.amount) || 0;
    map.set(uid, (map.get(uid) || 0) + amt);
  }
  return map;
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
  /** Mon–Fri minus company holidays in the full calendar month (salary proration denominator). */
  workingDaysInFullMonth: number;
  /** Mon–Fri minus holidays from month start through the selected run date (typical max pay days for the partial period). */
  workingDaysThroughRunDay: number;
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

  // For client clarity we treat payroll "days" as calendar days (no separate weekends/working-days concept).
  // Keep field names for backward compatibility with UI.
  const workingDaysInFullMonth = Math.max(1, daysInMonth);
  const workingDaysThroughRunDay = Math.max(1, effectiveRunDay);

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
      return {
        periodName,
        periodStart,
        periodEnd,
        daysInMonth,
        workingDaysInFullMonth,
        workingDaysThroughRunDay,
        effectiveRunDay,
        alreadyRun: true,
        existingPeriodId: existingPeriod.id,
        rows,
      };
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
    .select(
      "employee_user_id, gross_salary, ctc, pf_employee, pf_employer, esic_employee, esic_employer, basic, hra, medical, trans, lta, personal, pt, tds, advance_bonus"
    )
    .eq("company_id", companyId)
    .is("effective_end_date", null);
  if (!masters?.length) {
    return {
      periodName,
      periodStart,
      periodEnd,
      daysInMonth,
      workingDaysInFullMonth,
      workingDaysThroughRunDay,
      effectiveRunDay,
      alreadyRun: !!existingPeriod,
      existingPeriodId: existingPeriod?.id ?? null,
      rows: [],
    };
  }

  const userIds = masters.map((m: any) => m.employee_user_id);
  const { data: users } = await supabase
    .from("HRMS_users")
    .select("id, name, email, date_of_joining, date_of_leaving, role")
    .in("id", userIds);

  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));
  const periodStartDate = new Date(periodStart + "T00:00:00Z");
  const periodEndExclusive = new Date(Date.UTC(year, month - 1, effectiveRunDay + 1, 0, 0, 0, 0));

  const { presentDaysByUser, paidLeaveDaysByUser, unpaidLeaveDaysByUser } = await computeAttendanceDrivenPayDays({
    companyId,
    userIds,
    periodStartYmd: periodStart,
    periodEndExclusive,
    effectiveRunDay,
    year,
    month,
  });

  const reimbByUser = await fetchApprovedReimbursementTotalsByUser(companyId, year, month);

  const periodEndYmdInclusive = toYmdUtc(new Date(periodEndExclusive.getTime() - 24 * 60 * 60 * 1000));

  const rows: any[] = [];
  for (const m of masters) {
    const u = userById.get(m.employee_user_id);
    if (!u || u.role === "super_admin") continue;

    const doj = u.date_of_joining ? new Date(String(u.date_of_joining) + "T00:00:00Z") : null;
    const dol = u.date_of_leaving ? new Date(String(u.date_of_leaving) + "T00:00:00Z") : null;

    if (dol && dol < periodStartDate) continue;
    if (doj && doj > periodEndExclusive) continue;

    // Eligible calendar days within employment window for this payroll period.
    const employmentStart = doj && doj > periodStartDate ? doj : periodStartDate;
    const employmentEndInclusive =
      dol && dol < new Date(periodEndExclusive.getTime() - 1) ? dol : new Date(periodEndExclusive.getTime() - 1);
    const eligibleStartYmd = toYmdUtc(employmentStart);
    const eligibleEndYmd = toYmdUtc(employmentEndInclusive);
    const eligStartYmd = eligibleStartYmd > periodStart ? eligibleStartYmd : periodStart;
    const eligEndYmd = eligibleEndYmd < periodEndYmdInclusive ? eligibleEndYmd : periodEndYmdInclusive;
    const eligibleCalendarDays = countCalendarDaysInclusive(eligStartYmd, eligEndYmd);

    const unpaidLeaveDays = unpaidLeaveDaysByUser.get(m.employee_user_id) || 0;
    const paidLeaveDays = paidLeaveDaysByUser.get(m.employee_user_id) || 0;
    const presentDays = presentDaysByUser.get(m.employee_user_id) || 0;
    const rawPayDays = resolvePayDaysFromAttendance({
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      eligibleDays: eligibleCalendarDays,
    });
    if (rawPayDays <= 0) continue;

    const payDays = rawPayDays;

    const grossMonthly = Number(m.gross_salary) || 0;
    const ctcMonthly = Number(m.ctc) || grossMonthly;
    if (grossMonthly <= 0) continue;

    const ratio = payDays / Math.max(1, daysInMonth);
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

    const grossPay = Math.round((grossMonthly * payDays) / Math.max(1, daysInMonth));
    const basicPay = Math.round(basicMonthly * ratio);
    const hraPay = Math.round(hraMonthly * ratio);
    const medicalPay = Math.round(medicalMonthly * ratio);
    const transPay = Math.round(transMonthly * ratio);
    const ltaPay = Math.round(ltaMonthly * ratio);
    const personalPay = Math.round(personalMonthly * ratio);
    const pfEmp = (Number(m.pf_employee) || 0) * (payDays / Math.max(1, daysInMonth));
    const pfEmpr = (Number(m.pf_employer) || 0) * (payDays / Math.max(1, daysInMonth));
    const esicEmp = (Number(m.esic_employee) || 0) * (payDays / Math.max(1, daysInMonth));
    const esicEmpr = (Number(m.esic_employer) || 0) * (payDays / Math.max(1, daysInMonth));
    const masterPt = m.pt != null ? Number(m.pt) : NaN;
    const profTax = Number.isFinite(masterPt) && masterPt >= 0 ? masterPt : ptFixed;
    const profTaxMonthly = Math.round(profTax);
    const profTaxApplied = payDays > 0 ? profTaxMonthly : 0;
    // Net pay: only employee-side statutory + PT (employer PF/ESIC are not deducted from salary)
    const deductions = Math.round(pfEmp + esicEmp + profTaxApplied);
    const netPay = grossPay - deductions;
    const tdsMonth = Number(m.tds) || 0;
    const advMonth = Number(m.advance_bonus) || 0;
    const incentive = Math.round(advMonth * ratio);
    const prBonus = 0;
    const reimbursement = Math.round(reimbByUser.get(m.employee_user_id) || 0);
    // TDS should match Payroll Master (monthly), not prorated by pay-days.
    const tds = Math.round(tdsMonth);
    const takeHome = netPay - tds + incentive + prBonus + reimbursement;

    const ctcBase = Math.round(ctcMonthly);
    rows.push({
      employeeUserId: m.employee_user_id,
      employeeName: u.name,
      employeeEmail: u.email,
      payDays,
      rawPayDays,
      attendanceQualifyingDays: presentDays,
      payDaysSuppressedMinAttendance: false,
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
      profTax: profTaxApplied,
      profTaxMonthly,
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

  return {
    periodName,
    periodStart,
    periodEnd,
    daysInMonth,
    workingDaysInFullMonth,
    workingDaysThroughRunDay,
    effectiveRunDay,
    alreadyRun: !!existingPeriod,
    existingPeriodId: existingPeriod?.id ?? null,
    rows,
  };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
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
  if (!me?.company_id)
    return NextResponse.json({
      preview: {
        periodName: "",
        periodStart: "",
        periodEnd: "",
        daysInMonth: 0,
        workingDaysInFullMonth: 0,
        workingDaysThroughRunDay: 0,
        effectiveRunDay: 0,
        alreadyRun: false,
        existingPeriodId: null,
        rows: [],
      },
    });

  const preview = await computePreview(me.company_id, year, month, runDay);
  return NextResponse.json({ preview });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
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
    .select(
      "employee_user_id, gross_salary, ctc, pf_employee, pf_employer, esic_employee, esic_employer, basic, hra, medical, trans, lta, personal, pt, tds, advance_bonus"
    )
    .eq("company_id", me.company_id)
    .is("effective_end_date", null);
  if (!masters?.length) {
    try {
      await markReimbursementsPaidForPayrollMonth(me.company_id, period.id, year, month);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Failed to update reimbursement status" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, periodId: period.id, periodName, periodStart, periodEnd, payslipsGenerated: 0 });
  }

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
    const periodStartDate = new Date(periodStart + "T00:00:00Z");
    const periodEndExclusive = new Date(Date.UTC(year, month - 1, effectiveRunDay + 1, 0, 0, 0, 0));
    const periodEndYmdInclusivePost = toYmdUtc(new Date(periodEndExclusive.getTime() - 24 * 60 * 60 * 1000));

    const { presentDaysByUser, paidLeaveDaysByUser, unpaidLeaveDaysByUser } = await computeAttendanceDrivenPayDays({
      companyId: me.company_id,
      userIds,
      periodStartYmd: periodStart,
      periodEndExclusive,
      effectiveRunDay,
      year,
      month,
    });

    const reimbByUser = await fetchApprovedReimbursementTotalsByUser(me.company_id, year, month);

    for (const m of masters ?? []) {
      const u = userById.get(m.employee_user_id);
      if (!u || u.role === "super_admin") continue;

      const doj = u.date_of_joining ? new Date(String(u.date_of_joining) + "T00:00:00Z") : null;
      const dol = u.date_of_leaving ? new Date(String(u.date_of_leaving) + "T00:00:00Z") : null;

      if (dol && dol < periodStartDate) continue;
      if (doj && doj > periodEndExclusive) continue;

      const employmentStart = doj && doj > periodStartDate ? doj : periodStartDate;
      const employmentEndInclusive =
        dol && dol < new Date(periodEndExclusive.getTime() - 1) ? dol : new Date(periodEndExclusive.getTime() - 1);
      const eligibleStartYmd = toYmdUtc(employmentStart);
      const eligibleEndYmd = toYmdUtc(employmentEndInclusive);
      const eligStartYmd = eligibleStartYmd > periodStart ? eligibleStartYmd : periodStart;
      const eligEndYmd = eligibleEndYmd < periodEndYmdInclusivePost ? eligibleEndYmd : periodEndYmdInclusivePost;
      const eligibleCalendarDays = countCalendarDaysInclusive(eligStartYmd, eligEndYmd);

      const unpaidLeaveDays = unpaidLeaveDaysByUser.get(m.employee_user_id) || 0;
      const paidLeaveDays = paidLeaveDaysByUser.get(m.employee_user_id) || 0;
      const presentDays = presentDaysByUser.get(m.employee_user_id) || 0;
      const rawPayDays = resolvePayDaysFromAttendance({
        presentDays,
        paidLeaveDays,
        unpaidLeaveDays,
        eligibleDays: eligibleCalendarDays,
      });
      if (rawPayDays <= 0) continue;

      const payDays = rawPayDays;
      if (payDays <= 0) continue;

      const grossMonthly = Number(m.gross_salary) || 0;
      const ctcMonthly = Number(m.ctc) || grossMonthly; // CTC from master = Gross + Employer PF + Employer ESIC
      if (grossMonthly <= 0) continue;

      const ratio = payDays / Math.max(1, daysInMonth);
      const grossPay = Math.round((grossMonthly * payDays) / Math.max(1, daysInMonth));
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
      const pfEmp = Math.round((Number(m.pf_employee) || 0) * (payDays / Math.max(1, daysInMonth)));
      const pfEmpr = Math.round((Number(m.pf_employer) || 0) * (payDays / Math.max(1, daysInMonth)));
      const esicEmp = Math.round((Number(m.esic_employee) || 0) * (payDays / Math.max(1, daysInMonth)));
      const esicEmpr = Math.round((Number(m.esic_employer) || 0) * (payDays / Math.max(1, daysInMonth)));
      const masterPtIns = m.pt != null ? Number(m.pt) : NaN;
      const profTaxIns = Number.isFinite(masterPtIns) && masterPtIns >= 0 ? masterPtIns : ptFixed;
      const deductions = pfEmp + esicEmp + profTaxIns;
      const netPay = grossPay - deductions;
      const tdsMonthIns = Number(m.tds) || 0;
      const advMonthIns = Number(m.advance_bonus) || 0;
      const incentiveIns = Math.round(advMonthIns * ratio);
      // TDS should match Payroll Master (monthly), not prorated by pay-days.
      const tdsIns = Math.round(tdsMonthIns);
      const prBonusIns = 0;
      const reimbursement = Math.round(reimbByUser.get(m.employee_user_id) || 0);
      const takeHomeIns = netPay - tdsIns + incentiveIns + prBonusIns + reimbursement;

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
        net_pay: takeHomeIns,
        pay_days: payDays,
        ctc: ctcMonthly,
        pf_employee: pfEmp,
        pf_employer: pfEmpr,
        esic_employee: esicEmp,
        esic_employer: esicEmpr,
        professional_tax: profTaxIns,
        incentive: incentiveIns,
        pr_bonus: prBonusIns,
        reimbursement,
        tds: tdsIns,
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

  try {
    await markReimbursementsPaidForPayrollMonth(me.company_id, period.id, year, month);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to update reimbursement status" }, { status: 400 });
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
        TakeHome:
          Math.round(
            (Number(p.net_pay) || 0) -
              (Number(p.tds) || 0) +
              (Number(p.incentive) || 0) +
              (Number(p.pr_bonus) || 0) +
              (Number(p.reimbursement) || 0)
          ),
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
      // Update may fail if excel_file_path column does not exist; Excel remains in storage
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
