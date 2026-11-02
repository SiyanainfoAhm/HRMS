import { getSessionFromCookie, type SessionUser } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiBase";
import { normalizeRole } from "@/lib/roles";

/**
 * Single answer to "is this browser logged in?". Cookies alone never decide; the API token is checked
 * against Laravel (/auth/me). The outcome has three states so callers can never confuse
 * "logged out" (clear cookies, show login) with "backend down" (show an error, keep the session).
 */
export type LoggedOutReason =
  | "missing" //    no auth cookies at all
  | "incomplete" // only one of the two cookies (e.g. a session from before the API-token cookie existed)
  | "malformed" //  session cookie is not a validly signed payload
  | "rejected" //   backend answered 401/403/404/other 4xx: expired, revoked, user deleted or deactivated
  | "mismatch"; //  token belongs to a different user than the session cookie

export type SessionCheck =
  | { state: "valid"; session: SessionUser }
  | { state: "logged-out"; reason: LoggedOutReason; hadCookies: boolean }
  | { state: "unreachable"; fallback: SessionUser | null };

export const BACKEND_TIMEOUT_MS = 8000;

const ROLES = ["admin", "employee", "super_admin", "hr", "manager"];

type Options = { fetchFn?: typeof fetch; timeoutMs?: number };

export async function checkSession(
  sessionCookie: string | undefined,
  tokenCookie: string | undefined,
  options: Options = {},
): Promise<SessionCheck> {
  const hadCookies = Boolean(sessionCookie || tokenCookie);
  if (!hadCookies) return { state: "logged-out", reason: "missing", hadCookies };
  if (!sessionCookie || !tokenCookie) return { state: "logged-out", reason: "incomplete", hadCookies };

  const cookieSession = getSessionFromCookie(sessionCookie);
  if (!cookieSession) return { state: "logged-out", reason: "malformed", hadCookies };
  const fallback: SessionUser = { ...cookieSession, role: normalizeRole(cookieSession.role) };

  const doFetch = options.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${getApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenCookie}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? BACKEND_TIMEOUT_MS),
    });
  } catch {
    return { state: "unreachable", fallback };
  }

  // 429 and 5xx mean "try again later", not "logged out".
  if (res.status === 429 || res.status >= 500) return { state: "unreachable", fallback };
  if (res.status >= 400) return { state: "logged-out", reason: "rejected", hadCookies };

  let user: Record<string, unknown> | undefined;
  try {
    user = ((await res.json()) as { user?: Record<string, unknown> })?.user;
  } catch {
    return { state: "unreachable", fallback };
  }
  if (!user?.id || typeof user.role !== "string" || !ROLES.includes(user.role)) {
    return { state: "unreachable", fallback };
  }
  if (String(user.id) !== String(cookieSession.id)) return { state: "logged-out", reason: "mismatch", hadCookies };

  return {
    state: "valid",
    session: {
      id: String(user.id),
      email: String(user.email ?? cookieSession.email),
      name: user.name != null ? String(user.name) : cookieSession.name,
      role: normalizeRole(user.role as string),
      sv:
        typeof user.sv === "number"
          ? user.sv
          : typeof user.authSessionVersion === "number"
            ? user.authSessionVersion
            : cookieSession.sv,
    },
  };
}
