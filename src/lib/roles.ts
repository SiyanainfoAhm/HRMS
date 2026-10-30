/** Application roles — legacy values (super_admin, hr, manager) are treated as admin. */
export type AppRole = "admin" | "employee";

export const APP_ROLES: AppRole[] = ["admin", "employee"];

export function normalizeRole(role: string | null | undefined): AppRole {
  const normalized = role?.trim().toLowerCase();
  return normalized && ["admin", "super_admin", "payroll_admin", "hr", "manager"].includes(normalized)
    ? "admin"
    : "employee";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "admin";
}

export function roleLabel(role: string | null | undefined): string {
  return isAdminRole(role) ? "Admin" : "Employee";
}
