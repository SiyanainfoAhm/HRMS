import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { supabase } from "@/lib/supabaseClient";

function canManage(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

async function getCompanyId(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("HRMS_users").select("company_id").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.company_id ?? null) as string | null;
}

const allowedRoleKeys = ["super_admin", "admin", "hr", "manager", "employee"] as const;
const protectedRoleKeys = ["super_admin", "admin", "hr", "manager"] as const;

export async function GET() {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = await getCompanyId(session.id);
  if (!companyId) return NextResponse.json({ roles: [] });

  const { data, error } = await supabase
    .from("HRMS_roles")
    .select("*")
    .eq("company_id", companyId)
    .order("role_key", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ roles: data ?? [] });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = await getCompanyId(session.id);
  if (!companyId) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const roleKey = typeof body?.roleKey === "string" ? body.roleKey : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const isDefault = Boolean(body?.isDefault);
  if (!allowedRoleKeys.includes(roleKey as any)) return NextResponse.json({ error: "Invalid role key" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("HRMS_roles")
    .insert([
      {
        company_id: companyId,
        role_key: roleKey,
        name,
        description: description || null,
        is_default: isDefault,
      },
    ])
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ role: data });
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = await getCompanyId(session.id);
  if (!companyId) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Role id is required" }, { status: 400 });

  const payload: Record<string, any> = {
    name: typeof body?.name === "string" ? body.name.trim() : undefined,
    description: typeof body?.description === "string" ? body.description.trim() || null : undefined,
    is_default: body?.isDefault === undefined ? undefined : Boolean(body.isDefault),
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  const { data, error } = await supabase
    .from("HRMS_roles")
    .update(payload)
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ role: data });
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = await getCompanyId(session.id);
  if (!companyId) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const isActive = Boolean(body?.isActive);
  if (!id) return NextResponse.json({ error: "Role id is required" }, { status: 400 });

  const { data: existing, error: existingErr } = await supabase
    .from("HRMS_roles")
    .select("id, role_key, is_default")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 400 });
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  if (protectedRoleKeys.includes(existing.role_key) || existing.is_default) {
    return NextResponse.json({ error: "Default roles cannot be deactivated" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("HRMS_roles")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ role: data });
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = await getCompanyId(session.id);
  if (!companyId) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Role id is required" }, { status: 400 });

  const { data: existing, error: existingErr } = await supabase
    .from("HRMS_roles")
    .select("id, role_key, is_default")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 400 });
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  if (protectedRoleKeys.includes(existing.role_key) || existing.is_default) {
    return NextResponse.json({ error: "Default roles cannot be deleted" }, { status: 400 });
  }

  const { error } = await supabase.from("HRMS_roles").delete().eq("id", id).eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

