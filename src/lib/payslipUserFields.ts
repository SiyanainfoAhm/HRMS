/** User slice on payslip API responses — field names vary by source. */
export type PayslipUserLike = {
  designation?: string | null;
  department?: string | null;
  department_name?: string | null;
  departmentName?: string | null;
  dept?: string | null;
  employee_department?: string | null;
};

function cleanLabel(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return "";
}

/** Department for salary slip display — prefers payroll master `department` string. */
export function resolvePayslipDepartment(user: PayslipUserLike | null | undefined): string {
  const raw =
    cleanLabel(user?.department) ||
    cleanLabel(user?.department_name) ||
    cleanLabel(user?.departmentName) ||
    cleanLabel(user?.dept) ||
    cleanLabel(user?.employee_department);
  return raw || "—";
}

/** Designation for salary slip display — never fall back to department. */
export function resolvePayslipDesignation(user: PayslipUserLike | null | undefined): string {
  const raw = cleanLabel(user?.designation);
  return raw || "—";
}

/** Normalize payslip user for preview/PDF components. */
export function normalizePayslipUser<T extends PayslipUserLike>(user: T | null | undefined): T | null {
  if (!user) return null;
  const department = resolvePayslipDepartment(user);
  const designation = resolvePayslipDesignation(user);
  return {
    ...user,
    designation: designation === "—" ? "" : designation,
    departmentName: department === "—" ? "" : department,
    department: department === "—" ? "" : department,
  };
}
