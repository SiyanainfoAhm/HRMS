import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

function isApproverRole(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
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
  if (!me?.company_id) return NextResponse.json({ claims: [] });

  let q = supabase
    .from("HRMS_reimbursements")
    .select(
      "id, company_id, employee_id, employee_user_id, department_id, category, amount, currency, claim_date, description, attachment_url, status, approver_id, approver_user_id, approved_at, rejected_at, paid_at, payroll_year, payroll_month, rejection_reason, included_in_payroll_period_id, created_at"
    )
    .eq("company_id", me.company_id)
    .order("created_at", { ascending: false });

  if (!isApproverRole(session.role)) {
    q = q.eq("employee_user_id", session.id);
  }

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const userIds = new Set<string>();
  for (const r of rows ?? []) {
    if (r.employee_user_id) userIds.add(r.employee_user_id);
    if (r.approver_user_id) userIds.add(r.approver_user_id);
  }
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.size) {
    const { data: users } = await supabase
      .from("HRMS_users")
      .select("id, name, email")
      .in("id", [...userIds]);
    for (const u of users ?? []) {
      names.set(u.id, { name: u.name, email: u.email });
    }
  }

  const claims = (rows ?? []).map((r: any) => ({
    ...r,
    employeeName: r.employee_user_id ? names.get(r.employee_user_id)?.name ?? null : null,
    employeeEmail: r.employee_user_id ? names.get(r.employee_user_id)?.email ?? null : null,
    approverName: r.approver_user_id ? names.get(r.approver_user_id)?.name ?? null : null,
    approverEmail: r.approver_user_id ? names.get(r.approver_user_id)?.email ?? null : null,
  }));

  return NextResponse.json({ claims });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const amount = typeof body?.amount === "number" ? body.amount : parseFloat(String(body?.amount ?? ""));
  const claimDate = typeof body?.claimDate === "string" ? body.claimDate.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const attachmentUrl = typeof body?.attachmentUrl === "string" ? body.attachmentUrl.trim() : "";

  if (!category) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });
  if (!claimDate) return NextResponse.json({ error: "Claim date is required" }, { status: 400 });

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(claimDate);
  if (!dateMatch) return NextResponse.json({ error: "Claim date must be YYYY-MM-DD" }, { status: 400 });
  const payrollYear = parseInt(dateMatch[1], 10);
  const payrollMonth = parseInt(dateMatch[2], 10);
  if (payrollYear < 2000 || payrollYear > 2100) return NextResponse.json({ error: "Invalid claim date" }, { status: 400 });
  if (payrollMonth < 1 || payrollMonth > 12) return NextResponse.json({ error: "Invalid claim date" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data: empRow, error: empErr } = await supabase
    .from("HRMS_employees")
    .select("id, department_id")
    .eq("company_id", me.company_id)
    .eq("user_id", session.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 400 });
  if (!empRow?.id) {
    return NextResponse.json(
      { error: "No employee profile found. Ask HR to complete your employee record before claiming reimbursement." },
      { status: 400 }
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("HRMS_reimbursements")
    .insert([
      {
        company_id: me.company_id,
        employee_id: empRow.id,
        employee_user_id: session.id,
        department_id: empRow.department_id ?? null,
        category,
        amount: Math.round(amount * 100) / 100,
        currency: "INR",
        claim_date: claimDate,
        description: description || null,
        attachment_url: attachmentUrl || null,
        status: "pending",
        payroll_year: payrollYear,
        payroll_month: payrollMonth,
      },
    ])
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: inserted.id });
}
