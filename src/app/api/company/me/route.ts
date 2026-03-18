import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

function canManage(role: string): boolean {
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
  if (!me?.company_id) return NextResponse.json({ company: null });

  const { data, error } = await supabase.from("HRMS_companies").select("*").eq("id", me.company_id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ company: data });
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const payload: Record<string, any> = {
    name: typeof body?.name === "string" ? body.name.trim() : undefined,
    code: typeof body?.code === "string" ? body.code.trim() || null : undefined,
    industry: typeof body?.industry === "string" ? body.industry.trim() || null : undefined,
    address_line1: typeof body?.addressLine1 === "string" ? body.addressLine1.trim() || null : undefined,
    address_line2: typeof body?.addressLine2 === "string" ? body.addressLine2.trim() || null : undefined,
    city: typeof body?.city === "string" ? body.city.trim() || null : undefined,
    state: typeof body?.state === "string" ? body.state.trim() || null : undefined,
    country: typeof body?.country === "string" ? body.country.trim() || null : undefined,
    postal_code: typeof body?.postalCode === "string" ? body.postalCode.trim() || null : undefined,
    phone: typeof body?.phone === "string" ? body.phone.trim() || null : undefined,
    updated_at: new Date().toISOString(),
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  if (!payload.name) return NextResponse.json({ error: "Company name is required" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data, error } = await supabase
    .from("HRMS_companies")
    .update(payload)
    .eq("id", me.company_id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ company: data });
}

