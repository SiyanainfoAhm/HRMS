import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, getCookieOptions } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiBase";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;

  if (token) {
    try {
      await fetch(`${getApiBaseUrl()}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch {
      // Still clear local cookies if API is unreachable.
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
  res.cookies.set(TOKEN_COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return res;
}
