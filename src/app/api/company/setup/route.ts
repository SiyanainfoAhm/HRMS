import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { supabase } from "@/lib/supabaseClient";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : undefined;
    if (!name) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create company
    const { data: company, error: insertErr } = await supabase
      .from("HRMS_companies")
      .insert([{ name, code }])
      .select("*")
      .single();
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message ?? "Failed to create company" }, { status: 400 });
    }

    // Attach to current user
    const { error: updateErr } = await supabase
      .from("HRMS_users")
      .update({ company_id: company.id })
      .eq("id", session.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message ?? "Failed to attach company" }, { status: 400 });
    }

    // Ensure HRMS_employees row exists for custom-auth super admin
    const { data: me } = await supabase.from("HRMS_users").select("id, email, name, employee_code").eq("id", session.id).maybeSingle();
    if (me) {
      const { data: existingEmp } = await supabase.from("HRMS_employees").select("id").eq("user_id", session.id).maybeSingle();
      if (!existingEmp) {
        const rawName = (me.name ?? "") as string;
        const parts = rawName.trim().split(/\s+/).filter(Boolean);
        const firstName = (parts[0] || String(me.email).split("@")[0] || "Admin").slice(0, 100);
        const lastName = parts.slice(1).join(" ").slice(0, 100) || null;
        await supabase.from("HRMS_employees").insert([
          {
            user_id: session.id,
            company_id: company.id,
            employee_code: me.employee_code || null,
            first_name: firstName,
            last_name: lastName,
            email: me.email,
            is_active: true,
          },
        ]);
      }
    }

    // Seed default roles for every company (cannot be deleted)
    try {
      await supabase.from("HRMS_roles").upsert(
        [
          { company_id: company.id, role_key: "super_admin", name: "Super Admin", description: "Full access", is_default: true, is_active: true },
          { company_id: company.id, role_key: "admin", name: "Admin", description: "Administrative access", is_default: true, is_active: true },
          { company_id: company.id, role_key: "hr", name: "HR", description: "HR operations", is_default: true, is_active: true },
          { company_id: company.id, role_key: "manager", name: "Manager", description: "Team manager", is_default: true, is_active: true },
        ],
        { onConflict: "company_id,role_key" }
      );
    } catch {
      // best-effort
    }

    // Seed default leave types (employees see only paid)
    try {
      await supabase.from("HRMS_leave_types").upsert(
        [
          { company_id: company.id, name: "Sick Leave", code: "SICK", description: "Medical / sick leave", is_paid: true, annual_quota: null },
          { company_id: company.id, name: "Paid Leave", code: "PAID", description: "Earned / paid leave", is_paid: true, annual_quota: null },
          { company_id: company.id, name: "Unpaid Leave", code: "UNPAID", description: "Leave without pay", is_paid: false, annual_quota: null },
        ],
        { onConflict: "company_id,name" }
      );
    } catch {
      // best-effort
    }

    // Seed default leave policies so customers don't need to configure basics.
    // - Paid Leave: monthly accrual (1/month) with annual cap 12, prorate on join = true
    // - Sick Leave: annual quota 3, prorate on join = true
    // - Unpaid Leave: no accrual (unlimited / handled by requests)
    try {
      const { data: types } = await supabase
        .from("HRMS_leave_types")
        .select("id, name, code")
        .eq("company_id", company.id);

      const byCode = new Map<string, { id: string; name: string; code: string }>();
      for (const t of (types ?? []) as any[]) {
        const codeKey = String(t.code || "").toUpperCase();
        if (codeKey) byCode.set(codeKey, { id: String(t.id), name: String(t.name || ""), code: codeKey });
      }

      const paid = byCode.get("PAID");
      const sick = byCode.get("SICK");
      const unpaid = byCode.get("UNPAID");

      const policies: any[] = [];
      if (paid) {
        policies.push({
          company_id: company.id,
          leave_type_id: paid.id,
          accrual_method: "monthly",
          monthly_accrual_rate: 1,
          annual_quota: 12,
          prorate_on_join: true,
          reset_month: 1,
          reset_day: 1,
          allow_carryover: false,
          carryover_limit: null,
          updated_at: new Date().toISOString(),
        });
      }
      if (sick) {
        policies.push({
          company_id: company.id,
          leave_type_id: sick.id,
          accrual_method: "annual",
          monthly_accrual_rate: null,
          annual_quota: 3,
          prorate_on_join: true,
          reset_month: 1,
          reset_day: 1,
          allow_carryover: false,
          carryover_limit: null,
          updated_at: new Date().toISOString(),
        });
      }
      if (unpaid) {
        policies.push({
          company_id: company.id,
          leave_type_id: unpaid.id,
          accrual_method: "none",
          monthly_accrual_rate: null,
          annual_quota: null,
          prorate_on_join: true,
          reset_month: 1,
          reset_day: 1,
          allow_carryover: false,
          carryover_limit: null,
          updated_at: new Date().toISOString(),
        });
      }

      if (policies.length) {
        await supabase.from("HRMS_leave_policies").upsert(policies, { onConflict: "company_id,leave_type_id" });
      }
    } catch {
      // best-effort
    }

    return NextResponse.json({ company });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "Failed to setup company";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

