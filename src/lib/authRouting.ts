import { getValidatedSession } from "@/lib/authValidate";
import type { SessionUser } from "@/lib/auth";

/**
 * Where an invalid/expired session is sent. This route clears both auth cookies and then
 * redirects to the login page, so the login page never sees a stale cookie again.
 * Never redirect an invalid session straight to /auth/login: the middleware used to bounce
 * /auth/login back to /dashboard while the cookie was present, which looped forever.
 */
export const SESSION_EXPIRED_PATH = "/api/auth/session-expired";

export type LoginPageDecision = "show-login" | "redirect-dashboard" | "show-login-and-clear";

type Validate = (cookie: string | undefined, token: string | undefined) => Promise<SessionUser | null>;

/**
 * What the login page does for a request:
 *  - no cookies                       -> show the form
 *  - valid session AND api token      -> redirect to the dashboard (once; the dashboard validates the same way)
 *  - any cookie that does not validate (malformed, expired, rejected token, session without token)
 *                                     -> show the form and clear the stale cookies. Never redirect.
 */
export async function decideLoginPage(
  sessionCookie: string | undefined,
  tokenCookie: string | undefined,
  validate: Validate = getValidatedSession,
): Promise<LoginPageDecision> {
  if (!sessionCookie && !tokenCookie) return "show-login";
  if (sessionCookie && tokenCookie) {
    const session = await validate(sessionCookie, tokenCookie);
    if (session) return "redirect-dashboard";
  }
  return "show-login-and-clear";
}
