import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, createSessionCookie, getCookieOptions, type SessionUser } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { changePasswordForUser } from "@/lib/users";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current password and new password are required" }, { status: 400 });
  }

  try {
    const newSv = await changePasswordForUser(session.id, currentPassword, newPassword);
    const next: SessionUser = { ...session, sv: newSv };
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, createSessionCookie(next), getCookieOptions());
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to change password";
    if (msg === "Current password is incorrect") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
