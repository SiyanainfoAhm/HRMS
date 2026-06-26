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
import { normalizeRole, isAdminRole } from "@/lib/roles";
import { getApiBaseUrl } from "@/lib/apiBase";
import { applyNoStoreHeaders } from "@/lib/apiAuth";

const PUBLIC_PAGE_PREFIXES = ["/auth"];

const ADMIN_ONLY_PREFIXES = ["/payroll", "/settings", "/employees", "/setup", "/approvals"];

function isPublicPage(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAdminOnlyPage(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isSessionRole(value: unknown): boolean {
  return typeof value === "string";
}

/** Protect app pages, sync session with Laravel, and block admin routes for employees. */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = getSessionFromCookie(sessionCookie);
  const apiToken = request.cookies.get(TOKEN_COOKIE_NAME)?.value;

  if (!isPublicPage(pathname)) {
    if (!session || !apiToken) {
      const login = new URL("/auth/login", request.url);
      if (pathname !== "/dashboard") {
        login.searchParams.set("next", pathname);
      }
      return applyNoStoreHeaders(NextResponse.redirect(login));
    }

    if (isAdminOnlyPage(pathname) && !isAdminRole(session.role)) {
      return applyNoStoreHeaders(NextResponse.redirect(new URL("/profile?tab=pay", request.url)));
    }
  }

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
      return applyNoStoreHeaders(response);
    }

    if (!res.ok) {
      return applyNoStoreHeaders(NextResponse.next());
    }

    const data = await res.json();
    const u = data.user;
    if (!u || !isSessionRole(u.role)) {
      return applyNoStoreHeaders(NextResponse.next());
    }

    const sv =
      typeof u.sv === "number"
        ? u.sv
        : typeof u.authSessionVersion === "number"
          ? u.authSessionVersion
          : session.sv;

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

    const response = unchanged ? NextResponse.next() : NextResponse.next();
    if (!unchanged) {
      response.cookies.set(COOKIE_NAME, createSessionCookie(synced), getCookieOptions());
    }

    return applyNoStoreHeaders(response);
  } catch {
    return applyNoStoreHeaders(NextResponse.next());
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/login|invite|invites).*)"],
};
