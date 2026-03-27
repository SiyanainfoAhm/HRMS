import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionCookie, getSessionFromCookie, getCookieOptions, COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  const session = getSessionFromCookie(cookie);
  if (!session) {
    return NextResponse.json({ user: null });
  }
  // Sliding expiry: keep users logged in while they continue using the app.
  const res = NextResponse.json({ user: session });
  res.cookies.set(COOKIE_NAME, createSessionCookie(session), getCookieOptions());
  return res;
}
