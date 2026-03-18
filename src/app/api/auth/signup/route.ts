import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/users";
import { createSessionCookie, getCookieOptions, COOKIE_NAME, type SessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const user = await createUser({
      email: email.trim(),
      password,
      name: typeof name === "string" ? name.trim() || undefined : undefined,
    });

    const session: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const cookie = createSessionCookie(session);
    const res = NextResponse.json({ user: session });
    res.cookies.set(COOKIE_NAME, cookie, getCookieOptions());
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sign up failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
