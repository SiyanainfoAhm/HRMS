import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { computeEntitled, computeUsedDaysForYear, leaveYearStart, type LeavePolicy } from "@/lib/leavePolicy";

function isApprover(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function diffDaysInclusive(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ requests: [] });

  let query = supabase
    .from("HRMS_leave_requests")
    .select("*, HRMS_leave_types(name)")
    .eq("company_id", me.company_id)
    .order("created_at", { ascending: false });

  if (!isApprover(session.role)) {
    query = query.eq("employee_user_id", session.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    requests: (data ?? []).map((r: any) => ({
      id: r.id as string,
      leaveTypeId: r.leave_type_id as string,
      leaveTypeName: r.HRMS_leave_types?.name ?? "",
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      totalDays: r.total_days,
      reason: r.reason as string | null,
      status: r.status as string,
      createdAt: new Date(r.created_at).toISOString(),
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      rejectedAt: r.rejected_at ? new Date(r.rejected_at).toISOString() : null,
      rejectionReason: r.rejection_reason as string | null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const leaveTypeId = typeof body?.leaveTypeId === "string" ? body.leaveTypeId : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : undefined;
  if (!leaveTypeId || !startDate || !endDate) {
    return NextResponse.json({ error: "Leave type, start date and end date are required" }, { status: 400 });
  }
  const totalDays = diffDaysInclusive(startDate, endDate);
  if (!totalDays) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id, date_of_joining")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  // Ensure leave type belongs to the same company, and apply visibility rules
  const { data: lt, error: ltErr } = await supabase
    .from("HRMS_leave_types")
    .select("id, is_paid, HRMS_leave_policies(*)")
    .eq("company_id", me.company_id)
    .eq("id", leaveTypeId)
    .maybeSingle();
  if (ltErr) return NextResponse.json({ error: ltErr.message }, { status: 400 });
  if (!lt) return NextResponse.json({ error: "Invalid leave type" }, { status: 400 });
  if (!isApprover(session.role) && lt.is_paid === false) {
    return NextResponse.json({ error: "You are not allowed to request unpaid leave" }, { status: 403 });
  }

  // Enforce company leave policy for paid leave types (balance must be sufficient).
  // Unpaid leave remains allowed (tracked for payroll).
  if (lt.is_paid === true) {
    const pRaw = Array.isArray((lt as any).HRMS_leave_policies) ? (lt as any).HRMS_leave_policies[0] : (lt as any).HRMS_leave_policies;
    if (pRaw) {
      const policy: LeavePolicy = {
        leave_type_id: leaveTypeId,
        accrual_method: pRaw.accrual_method,
        monthly_accrual_rate: pRaw.monthly_accrual_rate,
        annual_quota: pRaw.annual_quota,
        prorate_on_join: Boolean(pRaw.prorate_on_join),
        reset_month: Number(pRaw.reset_month ?? 1),
        reset_day: Number(pRaw.reset_day ?? 1),
        allow_carryover: Boolean(pRaw.allow_carryover),
        carryover_limit: pRaw.carryover_limit,
      };

      const asOf = new Date(startDate + "T00:00:00Z");
      const joinDate = me.date_of_joining ? new Date(String(me.date_of_joining) + "T00:00:00Z") : null;
      const yearStart = leaveYearStart(asOf, policy.reset_month, policy.reset_day);
      const yearEndExclusive = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, yearStart.getUTCMonth(), yearStart.getUTCDate(), 0, 0, 0, 0));

      const { data: approvedLeaves, error: usedErr } = await supabase
        .from("HRMS_leave_requests")
        .select("leave_type_id, start_date, end_date, total_days")
        .eq("company_id", me.company_id)
        .eq("employee_user_id", session.id)
        .eq("status", "approved");
      if (usedErr) return NextResponse.json({ error: usedErr.message }, { status: 400 });

      const entitled = computeEntitled(policy, joinDate, asOf);
      if (entitled != null) {
        const used = computeUsedDaysForYear(approvedLeaves ?? [], leaveTypeId, yearStart, yearEndExclusive);
        const remaining = entitled - used;
        if (totalDays > remaining + 1e-9) {
          return NextResponse.json(
            { error: `Insufficient leave balance. Available ${Math.max(0, remaining).toFixed(2)} day(s).` },
            { status: 400 }
          );
        }
      }
    }
  }

  const now = new Date().toISOString();
  const autoApprove = isApprover(session.role);
  const { data, error } = await supabase
    .from("HRMS_leave_requests")
    .insert([
      {
        company_id: me.company_id,
        employee_user_id: session.id,
        leave_type_id: leaveTypeId,
        start_date: startDate,
        end_date: endDate,
        total_days: totalDays,
        reason: reason || null,
        status: autoApprove ? "approved" : "pending",
        approver_user_id: autoApprove ? session.id : null,
        approved_at: autoApprove ? now : null,
        rejected_at: null,
        rejection_reason: null,
      },
    ])
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ request: data });
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isApprover(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const rejectionReason = typeof body?.rejectionReason === "string" ? body.rejectionReason.trim() : undefined;
  if (!id) return NextResponse.json({ error: "Request id is required" }, { status: 400 });
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const now = new Date().toISOString();
  const payload =
    action === "approve"
      ? { status: "approved", approver_user_id: session.id, approved_at: now, rejected_at: null, rejection_reason: null }
      : { status: "rejected", approver_user_id: session.id, rejected_at: now, approved_at: null, rejection_reason: rejectionReason || "Rejected" };

  const { data, error } = await supabase
    .from("HRMS_leave_requests")
    .update(payload)
    .eq("id", id)
    .eq("company_id", me.company_id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ request: data });
}

