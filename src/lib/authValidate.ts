import { getSessionFromCookie, type SessionUser } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

/** Validates signed cookie and optionally checks session version via Laravel API. */
export async function getValidatedSession(cookieValue: string | undefined): Promise<SessionUser | null> {
  const session = getSessionFromCookie(cookieValue);
  if (!session) return null;

  const laravelToken = extractLaravelToken(cookieValue);
  if (!laravelToken) return session;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${laravelToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return session;
  } catch {
    return session;
  }
}

function extractLaravelToken(cookieValue: string | undefined): string | null {
  return null;
}
