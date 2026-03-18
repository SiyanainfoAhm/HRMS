import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { computeEntitled, computeUsedDaysForYear, leaveYearStart, type LeavePolicy } from "@/lib/leavePolicy";

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id, date_of_joining")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ balances: [] });

  const asOf = new Date();
  const joinDate = me.date_of_joining ? new Date(String(me.date_of_joining) + "T00:00:00Z") : null;

  const { data: policies, error: polErr } = await supabase
    .from("HRMS_leave_policies")
    .select("*, HRMS_leave_types(id, name, is_paid, code)")
    .eq("company_id", me.company_id);
  if (polErr) return NextResponse.json({ error: polErr.message }, { status: 400 });

  const { data: leaves, error: leaveErr } = await supabase
    .from("HRMS_leave_requests")
    .select("leave_type_id, start_date, end_date, total_days")
    .eq("company_id", me.company_id)
    .eq("employee_user_id", session.id)
    .eq("status", "approved");
  if (leaveErr) return NextResponse.json({ error: leaveErr.message }, { status: 400 });

  const balances = (policies ?? []).map((p: any) => {
    const policy: LeavePolicy = {
      leave_type_id: p.leave_type_id,
      accrual_method: p.accrual_method,
      monthly_accrual_rate: p.monthly_accrual_rate,
      annual_quota: p.annual_quota,
      prorate_on_join: Boolean(p.prorate_on_join),
      reset_month: Number(p.reset_month ?? 1),
      reset_day: Number(p.reset_day ?? 1),
      allow_carryover: Boolean(p.allow_carryover),
      carryover_limit: p.carryover_limit,
    };

    const yearStart = leaveYearStart(asOf, policy.reset_month, policy.reset_day);
    const yearEndExclusive = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, yearStart.getUTCMonth(), yearStart.getUTCDate(), 0, 0, 0, 0));

    const entitled = computeEntitled(policy, joinDate, asOf); // null => unlimited
    const used = computeUsedDaysForYear(leaves ?? [], p.leave_type_id, yearStart, yearEndExclusive);
    const remaining = entitled == null ? null : Math.max(0, entitled - used);

    return {
      leaveTypeId: p.leave_type_id,
      leaveTypeName: p.HRMS_leave_types?.name ?? "",
      isPaid: Boolean(p.HRMS_leave_types?.is_paid),
      accrualMethod: p.accrual_method,
      entitled,
      used,
      remaining,
      periodStart: yearStart.toISOString().slice(0, 10),
    };
  });

  return NextResponse.json({ balances });
}

