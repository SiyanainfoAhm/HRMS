import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { supabase } from "@/lib/supabaseClient";

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data: user, error: uErr } = await supabase
    .from("HRMS_users")
    .select("*")
    .eq("company_id", me.company_id)
    .eq("id", id)
    .maybeSingle();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  if (!user) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data: invite, error: iErr } = await supabase
    .from("HRMS_employee_invites")
    .select("*")
    .eq("company_id", me.company_id)
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

  let documents: any[] = [];
  let submissions: any[] = [];
  if (invite) {
    const requestedIds = Array.isArray(invite.requested_document_ids)
      ? (invite.requested_document_ids as any[]).filter((x) => typeof x === "string")
      : null;
    let docQuery = supabase
      .from("HRMS_company_documents")
      .select("*")
      .eq("company_id", me.company_id)
      .order("created_at", { ascending: true });
    if (requestedIds && requestedIds.length) docQuery = docQuery.in("id", requestedIds);
    const docsRes = await docQuery;
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 400 });
    documents = docsRes.data ?? [];

    const subRes = await supabase
      .from("HRMS_employee_document_submissions")
      .select("*")
      .eq("invite_id", invite.id);
    if (subRes.error) return NextResponse.json({ error: subRes.error.message }, { status: 400 });
    submissions = subRes.data ?? [];
  }

  return NextResponse.json({ employee: user, invite, documents, submissions });
}

