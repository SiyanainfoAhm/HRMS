import { NextResponse } from "next/server";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, getCookieOptions } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
  res.cookies.set(TOKEN_COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
  return res;
}
