import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { proxyToLaravel } from "@/lib/apiProxy";
import { COOKIE_NAME, createSessionCookie, getCookieOptions, getSessionFromCookie } from "@/lib/auth";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/me");
}

export async function PUT(request: NextRequest) {
  const res = await proxyToLaravel(request, "/me");
  const text = await res.text();
  let data: { user?: { email?: string; name?: string | null }; message?: string; errors?: Record<string, string[]> };
  try {
    data = JSON.parse(text);
  } catch {
    return new NextResponse(text, { status: res.status, headers: res.headers });
  }

  const out = NextResponse.json(data, { status: res.status });

  if (res.ok && data.user?.email) {
    const cookieStore = await cookies();
    const existing = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
    if (existing && existing.email !== data.user.email) {
      out.cookies.set(
        COOKIE_NAME,
        createSessionCookie({
          ...existing,
          email: data.user.email,
          name: data.user.name ?? existing.name,
        }),
        getCookieOptions(),
      );
    }
  }

  return out;
}
