import type { AppRole } from "@/lib/roles";
import { normalizeRole } from "@/lib/roles";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
  sv?: number;
};

/**
 * Decode session payload for routing only (middleware / edge).
 * Cryptographic verification runs in Node route handlers via getSessionFromCookie().
 */
export function peekSessionFromCookie(cookieValue: string | undefined): SessionUser | null {
  if (!cookieValue || !cookieValue.includes(".")) return null;
  const [payload] = cookieValue.split(".");
  if (!payload) return null;

  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(payload, "base64url").toString("utf-8");
    const decoded = JSON.parse(json) as SessionUser;
    if (decoded?.id && decoded?.email && decoded?.role) {
      return { ...decoded, role: normalizeRole(decoded.role) };
    }
  } catch {
    return null;
  }

  return null;
}
