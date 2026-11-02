import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, getCookieOptions } from "@/lib/auth";

/** An invalid or expired session is a logged-out session: clear the cookies, then show the login page. */
export async function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/auth/login", request.url));
  res.cookies.set(COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0, expires: new Date(0) });
  res.cookies.set(TOKEN_COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0, expires: new Date(0) });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return res;
}
