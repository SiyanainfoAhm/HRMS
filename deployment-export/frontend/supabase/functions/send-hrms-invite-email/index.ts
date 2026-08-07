// HRMS invite Edge Function: caller passes the full invite `link`; we verify it matches the DB invite token, then POST light JSON to Power Automate.
// Payload: email, link, name, companyName, subject only — build HTML in Power Automate (see src/email-templates/hrms-invite-power-automate-body.html).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function inviteEmailSubject(companyName: string | null | undefined): string {
  const n = companyName?.trim();
  return n ? `${n} — complete your onboarding` : "HRMS — complete your onboarding";
}

/** Payload for Power Automate — no html (compose body in the flow). */
type HrmsInvitePowerAutomatePayload = {
  email: string;
  link: string;
  name: string;
  companyName: string;
  subject: string;
};

function tokenFromInvitePath(link: string): string | null {
  const m = link.trim().match(/\/invite\/([^/?#]+)/);
  return m?.[1] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { success: false, message: "Method not allowed." },
      { status: 405, headers: corsHeaders },
    );
  }

  let body: { userId?: string; companyId?: string; link?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, message: "Invalid JSON body." }, { status: 400, headers: corsHeaders });
  }

  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : "";
  const link = typeof body?.link === "string" ? body.link.trim() : "";
  if (!userId || !companyId) {
    return Response.json(
      { success: false, message: "userId and companyId are required." },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!link) {
    return Response.json({ success: false, message: "link is required (full invite URL from HRMS)." }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const powerAutomateUrl =
    Deno.env.get("HRMS_POWER_AUTOMATE_INVITE_URL")?.trim() ||
    Deno.env.get("POWER_AUTOMATE_INVITE_URL")?.trim() ||
    "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return Response.json(
      { success: false, message: "Server configuration error." },
      { status: 500, headers: corsHeaders },
    );
  }

  if (!powerAutomateUrl) {
    return Response.json(
      { success: false, message: "Power Automate URL is not configured (HRMS_POWER_AUTOMATE_INVITE_URL or POWER_AUTOMATE_INVITE_URL)." },
      { status: 500, headers: corsHeaders },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: invite, error: inviteErr } = await supabase
    .from("HRMS_employee_invites")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inviteErr) {
    console.error("Invite query error:", inviteErr);
    return Response.json(
      { success: false, message: inviteErr.message || "Failed to load invite." },
      { status: 200, headers: corsHeaders },
    );
  }

  if (!invite) {
    return Response.json({ success: false, message: "No invite found for this employee." }, { status: 200, headers: corsHeaders });
  }

  if (invite.status !== "pending") {
    return Response.json(
      { success: false, message: "No active pending invite. Issue a new link from HRMS." },
      { status: 200, headers: corsHeaders },
    );
  }

  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return Response.json(
      { success: false, message: "This invite has expired. Issue a new link from HRMS." },
      { status: 200, headers: corsHeaders },
    );
  }

  const email = typeof invite.email === "string" ? invite.email.trim().toLowerCase() : "";
  const token = typeof invite.token === "string" ? invite.token : "";
  if (!email || !token) {
    return Response.json({ success: false, message: "Invite is missing email or token." }, { status: 200, headers: corsHeaders });
  }

  const tokenInLink = tokenFromInvitePath(link);
  if (!tokenInLink || tokenInLink !== token) {
    return Response.json(
      { success: false, message: "link does not match the current invite for this employee." },
      { status: 400, headers: corsHeaders },
    );
  }

  const [{ data: userRow }, { data: companyRow }] = await Promise.all([
    supabase.from("HRMS_users").select("name").eq("id", userId).maybeSingle(),
    supabase.from("HRMS_companies").select("name").eq("id", companyId).maybeSingle(),
  ]);

  const companyName = typeof companyRow?.name === "string" ? companyRow.name.trim() : "";
  const name = typeof userRow?.name === "string" ? userRow.name.trim() : "";
  const subject = inviteEmailSubject(companyRow?.name ?? null);

  const paPayload: HrmsInvitePowerAutomatePayload = {
    email,
    link,
    name,
    companyName,
    subject,
  };

  try {
    const res = await fetch(powerAutomateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paPayload),
    });

    const json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    const accepted = res.status === 202 || (res.ok && json.success !== false);
    if (!accepted) {
      return Response.json(
        {
          success: false,
          message: json.message || "Power Automate did not accept the request.",
        },
        { status: 200, headers: corsHeaders },
      );
    }
  } catch (e) {
    console.error("Power Automate error:", e);
    return Response.json(
      { success: false, message: "Failed to reach Power Automate. Please try again." },
      { status: 200, headers: corsHeaders },
    );
  }

  return Response.json(
    { success: true, message: "Invite handed off to Power Automate." },
    { status: 200, headers: corsHeaders },
  );
});
