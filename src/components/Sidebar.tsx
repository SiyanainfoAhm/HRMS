"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { SessionUser } from "@/lib/auth";

export type CompanyBranding = { name: string; logoUrl: string | null };

type NavItem = { href: string; label: string; icon: React.ReactNode };

function Icon({
  name,
}: {
  name: "dashboard" | "employees" | "attendance" | "holidays" | "approvals" | "payroll" | "profile" | "settings";
}) {
  const cls = "h-5 w-5";
  switch (name) {
    case "dashboard":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 11.5V4h7.5v7.5H4Zm0 8.5v-7.5h7.5V20H4Zm8.5 0v-7.5H20V20h-7.5Zm0-8.5V4H20v7.5h-7.5Z" fill="currentColor" />
        </svg>
      );
    case "employees":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M16 11a4 4 0 1 0-3.999-4A4 4 0 0 0 16 11ZM8 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 12Zm8 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4ZM8 14c-.3 0-.65.02-1.03.05C4.7 14.3 2 15.42 2 18v2h5v-2.1c0-1.56.62-2.74 1.72-3.6C8.48 14.1 8.25 14 8 14Z"
            fill="currentColor"
          />
        </svg>
      );
    case "attendance":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "holidays":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm13 8H6v10h14V10Zm-2-4H6v2h12V6Z" fill="currentColor" />
        </svg>
      );
    case "approvals":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 11.4 6.6 9 5.2 10.4 9 14.2 18.8 4.4 17.4 3 9 11.4ZM4 20v-8h2v6h14V8h2v12H4Z" fill="currentColor" />
        </svg>
      );
    case "payroll":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" fill="currentColor" />
        </svg>
      );
    case "profile":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 12a4 4 0 1 0-3.999-4A4 4 0 0 0 12 12Zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5Z"
            fill="currentColor"
          />
        </svg>
      );
    case "settings":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.38 7.38 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.42a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.21.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.56ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z"
            fill="currentColor"
          />
        </svg>
      );
  }
}

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0];
  return local.slice(0, 2).toUpperCase();
}

function companyMark(name: string): string {
  const t = name.trim();
  if (!t) return "HR";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

export function Sidebar({
  user,
  companyBranding,
  collapsed,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: {
  user: SessionUser;
  companyBranding: CompanyBranding | null;
  collapsed: boolean;
  onToggle: () => void;
  /** When false on small screens, drawer is off-screen */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { role } = useAuth();
  const router = useRouter();

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: <Icon name="dashboard" /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([
          { href: "/employees", label: "Employees", icon: <Icon name="employees" /> },
          { href: "/attendance", label: "Attendance", icon: <Icon name="attendance" /> },
        ] as const)
      : []),
    ...(role === "employee" || role === "manager"
      ? ([{ href: "/attendance", label: "Attendance", icon: <Icon name="attendance" /> }] as const)
      : []),
    { href: "/holidays", label: "Holidays", icon: <Icon name="holidays" /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([{ href: "/payroll", label: "Payroll", icon: <Icon name="payroll" /> }] as const)
      : []),
    { href: "/approvals", label: "Approvals", icon: <Icon name="approvals" /> },
    { href: "/profile", label: "Profile", icon: <Icon name="profile" /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([{ href: "/settings", label: "Settings", icon: <Icon name="settings" /> }] as const)
      : []),
  ];

  const initials = getInitials(user.name, user.email);
  const brandName = companyBranding?.name?.trim() || "Company";
  const logoUrl = companyBranding?.logoUrl ?? null;
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const closeMobile = () => onMobileClose?.();

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out md:relative md:z-auto md:translate-x-0 ${
        collapsed ? "md:w-[72px]" : "md:w-64"
      } fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-2rem))] max-w-[90vw] ${
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}
    >
      <div className="flex h-full flex-col overflow-y-auto overflow-x-hidden p-3">
        <div
          className={`mb-3 flex px-1 ${collapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2"}`}
        >
          <Link
            href="/dashboard"
            title={collapsed ? `${brandName} — Dashboard` : "Dashboard"}
            aria-label={`${brandName} — Dashboard`}
            onClick={closeMobile}
            className={`flex items-center rounded-xl text-slate-700 transition-colors hover:bg-slate-100 ${
              collapsed ? "justify-center p-0.5" : "min-w-0 flex-1 gap-3 p-1"
            }`}
          >
            <span
              className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white ${
                collapsed ? "h-10 w-10" : "h-12 w-12"
              }`}
            >
              {logoUrl && !logoFailed ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="max-h-full max-w-full object-contain p-1"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <span className={`font-bold text-emerald-700 ${collapsed ? "text-xs" : "text-sm"}`}>
                  {companyMark(brandName)}
                </span>
              )}
            </span>
            {!collapsed && (
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-semibold text-slate-900">{brandName}</span>
                <span className="block text-xs font-medium text-slate-500">HR portal</span>
              </span>
            )}
          </Link>
          {!collapsed ? (
            <button
              type="button"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 md:flex"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              title="Collapse"
            >
              <ChevronLeftIcon />
            </button>
          ) : (
            <button
              type="button"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 md:flex"
              onClick={onToggle}
              aria-label="Expand sidebar"
              title="Expand"
            >
              <ChevronRightIcon />
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={closeMobile}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors md:py-2 ${
                  isActive
                    ? "bg-emerald-50 text-emerald-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className={`${isActive ? "text-emerald-700" : "text-slate-500"}`}>{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
            {!collapsed && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white" title={user.email}>
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{user.name || user.email.split("@")[0]}</div>
                  <div className="truncate text-xs text-slate-500">{user.email}</div>
                </div>
              </div>
            )}
            {!collapsed ? (
              <button type="button" className="btn btn-outline !px-3 !py-2 text-sm" onClick={handleLogout}>
                Logout
              </button>
            ) : (
              <button type="button" className="btn btn-outline !px-2 !py-2 text-sm" onClick={handleLogout} title="Logout" aria-label="Logout">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
