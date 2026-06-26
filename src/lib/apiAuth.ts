import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export function getTokenFromRequest(request: NextRequest): string | undefined {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  return request.cookies.get(TOKEN_COOKIE_NAME)?.value;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function requireApiAuth(request: NextRequest): NextResponse | null {
  if (!getTokenFromRequest(request)) {
    return unauthorizedResponse();
  }

  return null;
}

export function requireAdminApi(request: NextRequest): NextResponse | null {
  const authError = requireApiAuth(request);
  if (authError) return authError;

  const session = getSessionFromCookie(request.cookies.get(COOKIE_NAME)?.value);
  if (!session || !isAdminRole(session.role)) {
    return forbiddenResponse();
  }

  return null;
}

export function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}
