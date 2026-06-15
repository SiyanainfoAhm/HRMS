import { getSessionFromCookie, type SessionUser } from "@/lib/auth";
import { normalizeRole } from "@/lib/roles";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function isSessionRole(value: unknown): value is SessionUser["role"] {
  return typeof value === "string" && (value === "admin" || value === "employee" || value === "super_admin" || value === "hr" || value === "manager");
}

/** Validates signed cookie; when apiToken is provided, role/profile are synced from Laravel. */
export async function getValidatedSession(
  cookieValue: string | undefined,
  apiToken?: string | undefined,
): Promise<SessionUser | null> {
  const session = getSessionFromCookie(cookieValue);
  if (!session) return null;

  const normalizedSession: SessionUser = {
    ...session,
    role: normalizeRole(session.role),
  };

  if (!apiToken) return normalizedSession;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401) return null;
    if (!res.ok) return normalizedSession;

    const data = await res.json();
    const u = data.user;
    if (!u?.id || !isSessionRole(u.role)) return normalizedSession;

    return {
      id: String(u.id),
      email: String(u.email ?? session.email),
      name: u.name != null ? String(u.name) : session.name,
      role: normalizeRole(u.role),
      sv:
        typeof u.sv === "number"
          ? u.sv
          : typeof u.authSessionVersion === "number"
            ? u.authSessionVersion
            : session.sv,
    };
  } catch {
    return normalizedSession;
  }
}
