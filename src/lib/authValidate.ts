import { getSessionFromCookie, type SessionUser } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

const SESSION_ROLES = new Set(["super_admin", "admin", "hr", "manager", "employee"]);

function isSessionRole(value: unknown): value is SessionUser["role"] {
  return typeof value === "string" && SESSION_ROLES.has(value);
}

/** Validates signed cookie; when apiToken is provided, role/profile are synced from Laravel. */
export async function getValidatedSession(
  cookieValue: string | undefined,
  apiToken?: string | undefined,
): Promise<SessionUser | null> {
  const session = getSessionFromCookie(cookieValue);
  if (!session) return null;
  if (!apiToken) return session;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401) return null;
    if (!res.ok) return session;

    const data = await res.json();
    const u = data.user;
    if (!u?.id || !isSessionRole(u.role)) return session;

    return {
      id: String(u.id),
      email: String(u.email ?? session.email),
      name: u.name != null ? String(u.name) : session.name,
      role: u.role,
      sv:
        typeof u.sv === "number"
          ? u.sv
          : typeof u.authSessionVersion === "number"
            ? u.authSessionVersion
            : session.sv,
    };
  } catch {
    return session;
  }
}
