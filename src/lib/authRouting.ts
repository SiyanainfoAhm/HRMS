import type { SessionCheck } from "@/lib/sessionCheck";

/**
 * Where an invalid/expired session is sent. This route clears both auth cookies and then redirects to
 * /auth/login?expired=1. Never redirect an invalid session straight to /auth/login while a cookie may still be
 * present: the old middleware bounced /auth/login back to /dashboard, which looped forever.
 */
export const SESSION_EXPIRED_PATH = "/api/auth/session-expired";

/** The login page never redirects when it is reached with one of these flags (the redirect cap). */
export const LOGIN_NO_REDIRECT_PARAMS = ["expired", "loop"] as const;

export function loginCapFlagged(search: string): boolean {
  const params = new URLSearchParams(search);
  return LOGIN_NO_REDIRECT_PARAMS.some((p) => params.has(p));
}

export type LoginPageDecision =
  | "show-login" //               no cookies: the form
  | "redirect-dashboard" //       valid session: ONE redirect to the dashboard
  | "show-login-and-clear" //     stale cookies: the form, cookies cleared once, never a redirect
  | "show-login-backend-down"; // cannot tell: the form with a server-unreachable notice, nothing cleared

/**
 * Rule 1 (login page): decided from the validated session, never from cookie presence.
 * `capped` is true when the visit carries ?expired / ?loop, i.e. a guard already sent us here: never redirect.
 */
export function decideLoginPage(check: SessionCheck, capped = false): LoginPageDecision {
  if (check.state === "unreachable") return "show-login-backend-down";
  if (check.state === "valid") return capped ? "show-login-and-clear" : "redirect-dashboard";
  return check.hadCookies ? "show-login-and-clear" : "show-login";
}

export type GuardDecision =
  | "render" //            valid session
  | "unavailable" //       backend unreachable: error page, no redirect
  | "redirect-expired"; // logged out with stale cookies: clear them, then login (once)

/** Rule 2 (guard on authenticated pages): points at SESSION_EXPIRED_PATH, which ends on a login page that never redirects. */
export function decideGuard(check: SessionCheck): GuardDecision {
  if (check.state === "valid") return "render";
  if (check.state === "unreachable") return "unavailable";
  return "redirect-expired";
}

/** Guard target for a logged-out visitor: straight to login when there is nothing to clear. */
export function loggedOutTarget(check: SessionCheck): string {
  return check.state === "logged-out" && check.hadCookies ? SESSION_EXPIRED_PATH : "/auth/login";
}
