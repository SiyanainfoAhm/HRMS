import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import bcrypt from "bcryptjs";

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function mapRow(row: any) {
  return {
    id: row.id as string,
    email: row.email as string,
    name: (row.name ?? null) as string | null,
    role: row.role as "super_admin" | "admin" | "hr" | "manager" | "employee",
    employmentStatus: (row.employment_status ?? "preboarding") as "preboarding" | "current" | "past",
    employeeCode: (row.employee_code ?? "") as string,
    phone: (row.phone ?? "") as string,
    dateOfJoining: row.date_of_joining ? String(row.date_of_joining) : "",
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function randomEmployeeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "EMP-";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function generateUniqueEmployeeCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomEmployeeCode();
    const { data, error } = await supabase.from("HRMS_users").select("id").eq("employee_code", code).maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
  return `EMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only allow super_admin/admin/hr to view full directory
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Find current user's company
  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ employees: [] });

  const { data, error } = await supabase
    .from("HRMS_users")
    .select("*")
    .eq("company_id", me.company_id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ employees: (data ?? []).map(mapRow) });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const role = body?.role as string | undefined;
  const plainPassword = typeof body?.password === "string" ? body.password.trim() : "";
  const employeeCode = typeof body?.employeeCode === "string" ? body.employeeCode.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const dateOfJoining = typeof body?.dateOfJoining === "string" ? body.dateOfJoining.trim() : "";
  const employmentStatus = typeof body?.employmentStatus === "string" ? body.employmentStatus : "";
  const currentAddressLine1 = typeof body?.currentAddressLine1 === "string" ? body.currentAddressLine1.trim() : "";
  const currentAddressLine2 = typeof body?.currentAddressLine2 === "string" ? body.currentAddressLine2.trim() : "";
  const currentCity = typeof body?.currentCity === "string" ? body.currentCity.trim() : "";
  const currentState = typeof body?.currentState === "string" ? body.currentState.trim() : "";
  const currentCountry = typeof body?.currentCountry === "string" ? body.currentCountry.trim() : "";
  const currentPostalCode = typeof body?.currentPostalCode === "string" ? body.currentPostalCode.trim() : "";
  const permanentAddressLine1 =
    typeof body?.permanentAddressLine1 === "string" ? body.permanentAddressLine1.trim() : "";
  const permanentAddressLine2 =
    typeof body?.permanentAddressLine2 === "string" ? body.permanentAddressLine2.trim() : "";
  const permanentCity = typeof body?.permanentCity === "string" ? body.permanentCity.trim() : "";
  const permanentState = typeof body?.permanentState === "string" ? body.permanentState.trim() : "";
  const permanentCountry = typeof body?.permanentCountry === "string" ? body.permanentCountry.trim() : "";
  const permanentPostalCode =
    typeof body?.permanentPostalCode === "string" ? body.permanentPostalCode.trim() : "";
  const emergencyContactName =
    typeof body?.emergencyContactName === "string" ? body.emergencyContactName.trim() : "";
  const emergencyContactPhone =
    typeof body?.emergencyContactPhone === "string" ? body.emergencyContactPhone.trim() : "";
  const bankName = typeof body?.bankName === "string" ? body.bankName.trim() : "";
  const bankAccountNumber =
    typeof body?.bankAccountNumber === "string" ? body.bankAccountNumber.trim() : "";
  const bankIfsc = typeof body?.bankIfsc === "string" ? body.bankIfsc.trim() : "";
  const requestedDocumentIds = Array.isArray(body?.requestedDocumentIds)
    ? body.requestedDocumentIds.filter((x: any) => typeof x === "string")
    : null;

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  const allowedRoles = ["super_admin", "admin", "hr", "manager", "employee"];
  const finalRole = allowedRoles.includes(role || "") ? (role as any) : "employee";
  const allowedStatus = ["preboarding", "current", "past"];
  const requestedStatus = allowedStatus.includes(employmentStatus) ? (employmentStatus as any) : "preboarding";

  // Get company of current user
  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  // Check existing
  const { data: existing, error: existErr } = await supabase
    .from("HRMS_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 400 });
  if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 400 });

  const passwordToUse =
    plainPassword ||
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8); // 12+ chars
  const password_hash = await bcrypt.hash(passwordToUse, 10);

  const finalEmployeeCode = employeeCode || (await generateUniqueEmployeeCode());

  const { data: inserted, error } = await supabase
    .from("HRMS_users")
    .insert([
      {
        email,
        name: name ?? null,
        role: finalRole,
        // Always start in preboarding. They become "current" only after completing invite + mandatory documents.
        employment_status: requestedStatus === "past" ? "past" : "preboarding",
        employee_code: finalEmployeeCode || null,
        phone: phone || null,
        date_of_joining: dateOfJoining || null,
        current_address_line1: currentAddressLine1 || null,
        current_address_line2: currentAddressLine2 || null,
        current_city: currentCity || null,
        current_state: currentState || null,
        current_country: currentCountry || null,
        current_postal_code: currentPostalCode || null,
        permanent_address_line1: permanentAddressLine1 || null,
        permanent_address_line2: permanentAddressLine2 || null,
        permanent_city: permanentCity || null,
        permanent_state: permanentState || null,
        permanent_country: permanentCountry || null,
        permanent_postal_code: permanentPostalCode || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber || null,
        bank_ifsc: bankIfsc || null,
        password_hash,
        company_id: me.company_id,
      },
    ])
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Generate preboarding invite link (employee completes onboarding + mandatory documents)
  let inviteToken: string | null = null;
  try {
    inviteToken = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from("HRMS_employee_invites").insert([
      {
        company_id: me.company_id,
        user_id: inserted.id,
        email,
        token: inviteToken,
        requested_document_ids: requestedDocumentIds ? requestedDocumentIds : null,
        status: "pending",
        expires_at: expiresAt,
        created_by: session.id,
      },
    ]);
  } catch {
    // Best-effort; employee creation succeeded
  }

  // Keep HRMS_employees in sync for custom-auth flows
  try {
    const rawName = (name ?? inserted.name ?? "") as string;
    const fallbackFirstName = email.split("@")[0] || "Employee";
    const parts = rawName.trim().split(/\s+/).filter(Boolean);
    const firstName = (parts[0] || fallbackFirstName).slice(0, 100);
    const lastName = parts.slice(1).join(" ").slice(0, 100) || null;

    const { data: existingEmp } = await supabase
      .from("HRMS_employees")
      .select("id")
      .eq("user_id", inserted.id)
      .maybeSingle();

    if (!existingEmp) {
      await supabase.from("HRMS_employees").insert([
        {
          user_id: inserted.id,
          company_id: me.company_id,
          employee_code: finalEmployeeCode || null,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phone || null,
          date_of_joining: dateOfJoining || null,
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
          bank_account_number: bankAccountNumber || null,
          bank_ifsc: bankIfsc || null,
          is_active: finalStatus !== "past",
        },
      ]);
    }
  } catch {
    // Best-effort sync; main user creation succeeded
  }

  const baseUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "") ||
    new URL(request.url).origin;
  const inviteUrl = inviteToken ? `${baseUrl}/invite/${inviteToken}` : null;
  return NextResponse.json({ employee: mapRow(inserted), inviteUrl });
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (action !== "convert_to_current") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data: invite, error: iErr } = await supabase
    .from("HRMS_employee_invites")
    .select("*")
    .eq("company_id", me.company_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });
  if (!invite) return NextResponse.json({ error: "No invite found for employee" }, { status: 400 });
  if (invite.status !== "completed") return NextResponse.json({ error: "Invite not completed yet" }, { status: 400 });

  const requestedIds = Array.isArray(invite.requested_document_ids)
    ? (invite.requested_document_ids as any[]).filter((x) => typeof x === "string")
    : null;
  let docQuery = supabase
    .from("HRMS_company_documents")
    .select("id, is_mandatory")
    .eq("company_id", me.company_id);
  if (requestedIds && requestedIds.length) docQuery = docQuery.in("id", requestedIds);
  const { data: docs, error: dErr } = await docQuery;
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });

  const mandatoryIds = (docs ?? []).filter((d: any) => d.is_mandatory).map((d: any) => d.id as string);
  if (mandatoryIds.length) {
    const { data: subs, error: sErr } = await supabase
      .from("HRMS_employee_document_submissions")
      .select("document_id, status")
      .eq("invite_id", invite.id);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
    const done = new Set((subs ?? []).filter((s: any) => ["submitted", "signed", "approved"].includes(s.status)).map((s: any) => s.document_id));
    const missing = mandatoryIds.filter((id) => !done.has(id));
    if (missing.length) return NextResponse.json({ error: "Mandatory documents still pending" }, { status: 400 });
  }

  const { error: updErr } = await supabase
    .from("HRMS_users")
    .update({ employment_status: "current", updated_at: new Date().toISOString() })
    .eq("company_id", me.company_id)
    .eq("id", userId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await supabase
    .from("HRMS_employees")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("company_id", me.company_id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}

