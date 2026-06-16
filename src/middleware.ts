import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  TOKEN_COOKIE_NAME,
  createSessionCookie,
  getCookieOptions,
  getSessionFromCookie,
  type SessionUser,
} from "@/lib/auth";
import { normalizeRole } from "@/lib/roles";
import { getApiBaseUrl } from "@/lib/apiBase";

function isSessionRole(value: unknown): boolean {
  return typeof value === "string";
}

/** Keep signed session cookie aligned with Laravel token (role / profile). */
export async function middleware(request: NextRequest) {
  const session = getSessionFromCookie(request.cookies.get(COOKIE_NAME)?.value);
  const apiToken = request.cookies.get(TOKEN_COOKIE_NAME)?.value;

  if (!session || !apiToken) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 401) {
      const login = new URL("/auth/login", request.url);
      const response = NextResponse.redirect(login);
      response.cookies.set(COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
      response.cookies.set(TOKEN_COOKIE_NAME, "", { ...getCookieOptions(), maxAge: 0 });
      return response;
    }

    if (!res.ok) {
      return NextResponse.next();
    }

    const data = await res.json();
    const u = data.user;
    if (!u || !isSessionRole(u.role)) {
      return NextResponse.next();
    }

    const sv = typeof u.sv === "number" ? u.sv : typeof u.authSessionVersion === "number" ? u.authSessionVersion : session.sv;

    const synced: SessionUser = {
      id: String(u.id ?? session.id),
      email: String(u.email ?? session.email),
      name: u.name != null ? String(u.name) : session.name,
      role: normalizeRole(u.role),
      sv,
    };

    const normalizedSessionRole = normalizeRole(session.role);
    const unchanged =
      synced.role === normalizedSessionRole &&
      synced.email === session.email &&
      synced.name === session.name &&
      (synced.sv ?? 0) === (session.sv ?? 0);

    if (unchanged) {
      return NextResponse.next();
    }

    const response = NextResponse.next();
    response.cookies.set(COOKIE_NAME, createSessionCookie(synced), getCookieOptions());
    return response;
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/login|invite|invites).*)"],
};
