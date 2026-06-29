import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { peekSessionFromCookie } from "@/lib/authEdge";
import { isAdminRole } from "@/lib/roles";
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

/** Protect app pages and block admin routes for employees (edge-safe; API enforces auth). */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const apiToken = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const session = peekSessionFromCookie(request.cookies.get(COOKIE_NAME)?.value);

  if (pathname.startsWith("/auth/login") && apiToken) {
    return applyNoStoreHeaders(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  if (!isPublicPage(pathname)) {
    if (!apiToken) {
      const login = new URL("/auth/login", request.url);
      if (pathname !== "/dashboard") {
        login.searchParams.set("next", pathname);
      }
      return applyNoStoreHeaders(NextResponse.redirect(login));
    }

    if (isAdminOnlyPage(pathname) && session && !isAdminRole(session.role)) {
      return applyNoStoreHeaders(NextResponse.redirect(new URL("/profile?tab=pay", request.url)));
    }
  }

  return applyNoStoreHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/login|invite|invites).*)"],
};
