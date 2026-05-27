/** Map route prefixes to display titles for the app topbar. */
const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/attendance": "Attendance",
  "/employees": "Employees",
  "/approvals": "Leave & Approvals",
  "/payroll": "Payroll",
  "/holidays": "Holidays",
  "/profile": "Profile",
  "/settings": "Settings",
  "/setup/company": "Company Setup",
};

export function titleForPathname(pathname: string): string {
  const exact = TITLES[pathname];
  if (exact) return exact;
  const match = Object.keys(TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match]! : "HRMS";
}

export function breadcrumbForPathname(pathname: string): { label: string; href?: string }[] {
  const title = titleForPathname(pathname);
  if (pathname === "/dashboard") return [{ label: "Dashboard" }];
  return [{ label: "Home", href: "/dashboard" }, { label: title }];
}
