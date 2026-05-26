import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, getCookieOptions, COOKIE_NAME, TOKEN_COOKIE_NAME, type SessionUser } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken) return NextResponse.json({ error: "idToken is required" }, { status: 400 });
    const mode = body?.mode === "signup" ? "signup" : "login";

    const apiRes = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ idToken, mode }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      return NextResponse.json(
        { error: data.error || "Google sign-in failed" },
        { status: apiRes.status }
      );
    }

    const u = data.user;
    const session: SessionUser = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      sv: u.sv ?? 0,
    };
    const cookie = createSessionCookie(session);
    const res = NextResponse.json({ user: session, token: data.token });
    res.cookies.set(COOKIE_NAME, cookie, getCookieOptions());
    res.cookies.set(TOKEN_COOKIE_NAME, data.token, getCookieOptions());
    return res;
  } catch {
    return NextResponse.json({ error: "Google sign-in failed" }, { status: 500 });
  }
}
