/** Map route prefixes to display titles for the app topbar. */
const TITLES: Record<string, string> = {
  "/payroll": "Payroll",
  "/payroll/master": "Payroll Master",
  "/profile": "Profile",
  "/employee/dashboard": "Dashboard",
  "/employee/payroll-history": "Payroll History",
  "/settings": "Settings",
  "/employees": "Employees",
  "/setup/company": "CIRT Institute Setup",
};

import { APP_NAME } from "@/lib/appBranding";

export function titleForPathname(pathname: string): string {
  if (pathname === "/payroll") {
    return "Payroll";
  }
  const exact = TITLES[pathname];
  if (exact) return exact;
  const match = Object.keys(TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match]! : APP_NAME;
}

export function breadcrumbForPathname(pathname: string): { label: string; href?: string }[] {
  const title = titleForPathname(pathname);
  if (pathname.startsWith("/payroll")) {
    return [{ label: title }];
  }
  if (pathname.startsWith("/profile")) {
    return [{ label: "Profile" }];
  }
  if (pathname.startsWith("/employee")) {
    return [{ label: title }];
  }
  return [{ label: "Home", href: "/payroll/master" }, { label: title }];
}
