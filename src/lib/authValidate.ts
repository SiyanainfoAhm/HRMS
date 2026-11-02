import { type SessionUser } from "@/lib/auth";
import { checkSession } from "@/lib/sessionCheck";

/**
 * Compatibility wrapper: the session when logged in, null when logged out. When the backend is unreachable the
 * signed cookie is returned so pages can render an error state instead of bouncing the user to login.
 * New code should use checkSession() and handle the three states explicitly.
 */
export async function getValidatedSession(
  cookieValue: string | undefined,
  apiToken?: string | undefined,
): Promise<SessionUser | null> {
  const check = await checkSession(cookieValue, apiToken);
  if (check.state === "valid") return check.session;
  if (check.state === "unreachable") return check.fallback;
  return null;
}
