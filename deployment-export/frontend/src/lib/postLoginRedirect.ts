import { isAdminRole } from "@/lib/roles";

const ALLOWED_NEXT_PREFIXES = ["/payroll", "/profile", "/employee", "/settings", "/employees", "/setup"];

function isSafeNextPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return false;
  }

  return ALLOWED_NEXT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  );
}

/** Default landing page after sign-in (must match an existing app route). */
export function getDefaultLandingPath(role: string | null | undefined): string {
  return isAdminRole(role) ? "/payroll/master" : "/employee/dashboard";
}

/** Resolve post-login destination, honoring a safe `next` query param when present. */
export function resolvePostLoginPath(
  role: string | null | undefined,
  nextParam: string | null | undefined,
): string {
  const next = nextParam?.trim();
  if (next && isSafeNextPath(next)) {
    if (!isAdminRole(role)) {
      const adminOnly =
        next.startsWith("/payroll/master") ||
        next.startsWith("/payroll?") ||
        next === "/payroll" ||
        next.startsWith("/settings") ||
        next.startsWith("/employees") ||
        next.startsWith("/setup");
      if (adminOnly) {
        return getDefaultLandingPath(role);
      }
    }
    return next;
  }

  return getDefaultLandingPath(role);
}
