"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Wallet,
  PlayCircle,
  FileText,
  UserCircle,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { SessionUser } from "@/lib/auth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { APP_NAME } from "@/lib/appBranding";
import { cn } from "@/lib/cn";
import { isAdminRole } from "@/lib/roles";

export type CompanyBranding = { name: string };

type NavItem = { href: string; label: string; icon: React.ReactNode };

function getInitials(name: string | null, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function companyMark(name: string): string {
  const t = name.trim();
  if (!t) return "CP";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

const iconCls = "h-5 w-5 shrink-0";

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
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { role } = useAuth();
  const router = useRouter();

  const isPayrollAdmin = isAdminRole(role);
  const isPayrollMasterAdmin = isAdminRole(role);
  const isEmployee = !isAdminRole(role);

  const nav: NavItem[] = isPayrollAdmin
    ? [
        ...(isPayrollMasterAdmin
          ? [{ href: "/payroll?tab=master", label: "Payroll Master", icon: <Wallet className={iconCls} /> }]
          : []),
        { href: "/payroll?tab=run", label: "Run Payroll", icon: <PlayCircle className={iconCls} /> },
        { href: "/payroll?tab=slips", label: "Salary Slips", icon: <FileText className={iconCls} /> },
        { href: "/settings", label: "Settings", icon: <Settings className={iconCls} /> },
      ]
    : isEmployee
      ? [{ href: "/profile?tab=pay", label: "My Salary Slips", icon: <UserCircle className={iconCls} /> }]
      : [{ href: "/profile?tab=pay", label: "My Salary Slips", icon: <UserCircle className={iconCls} /> }];

  const initials = getInitials(user.name, user.email);
  const brandName = companyBranding?.name?.trim() || APP_NAME;
  const [logoutOpen, setLogoutOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const closeMobile = () => onMobileClose?.();

  function isNavActive(href: string): boolean {
    if (href.startsWith("/payroll")) {
      const tab = new URL(href, "http://local").searchParams.get("tab") || "master";
      return pathname === "/payroll" && (searchParams.get("tab") || "master") === tab;
    }
    if (href.startsWith("/profile")) {
      return pathname === "/profile";
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      <ConfirmDialog
        open={logoutOpen}
        title="Logout now?"
        message={`You will be signed out of ${APP_NAME} on this device.`}
        confirmText="Logout"
        variant="danger"
        onConfirm={() => {
          setLogoutOpen(false);
          void handleLogout();
        }}
        onCancel={() => setLogoutOpen(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r border-brand-border bg-white shadow-lg transition-[width,transform] duration-200 ease-out md:relative md:z-auto md:translate-x-0 md:shadow-none",
          collapsed ? "md:w-[72px]" : "md:w-64",
          "w-[min(18rem,calc(100vw-2rem))] max-w-[90vw]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-full flex-col overflow-y-auto overflow-x-hidden p-3">
          <div
            className={cn(
              "mb-4 flex px-1",
              collapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-2",
            )}
          >
            <Link
              href={isPayrollMasterAdmin ? "/payroll?tab=master" : "/payroll?tab=run"}
              title={collapsed ? `${brandName} — ${APP_NAME}` : APP_NAME}
              aria-label={`${brandName} — ${APP_NAME}`}
              onClick={closeMobile}
              className={cn(
                "flex items-center rounded-xl transition-colors hover:bg-slate-50",
                collapsed ? "justify-center p-0.5" : "min-w-0 flex-1 gap-3 p-1",
              )}
            >
              <span
                className={cn(
                  "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-border bg-gradient-to-br from-brand-navy to-brand-blue shadow-sm",
                  collapsed ? "h-10 w-10" : "h-11 w-11",
                )}
              >
                <span className={cn("font-bold text-white", collapsed ? "text-xs" : "text-sm")}>
                  {companyMark(brandName)}
                </span>
              </span>
              {!collapsed && (
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-bold text-slate-900">{brandName}</span>
                  <span className="block text-xs font-medium text-brand-muted">{APP_NAME}</span>
                </span>
              )}
            </Link>
            <button
              type="button"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-border text-slate-600 hover:bg-slate-50 md:flex"
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5">
            {nav.map((item) => {
              const isActive = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  onClick={closeMobile}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-brand-navy text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    collapsed && "justify-center px-2",
                  )}
                >
                  <span className={isActive ? "text-white" : "text-slate-500"}>{item.icon}</span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="mt-3 border-t border-brand-border pt-3">
            <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
              {!collapsed && (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-navy to-brand-blue text-xs font-bold text-white"
                    title={user.email}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {user.name || user.email.split("@")[0]}
                    </div>
                    <div className="truncate text-xs text-brand-muted">{user.email}</div>
                  </div>
                </div>
              )}
              <button
                type="button"
                className={cn("btn btn-ghost", collapsed ? "!p-2" : "!px-3")}
                onClick={() => setLogoutOpen(true)}
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="h-5 w-5" />
                {!collapsed && <span className="hidden lg:inline">Logout</span>}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
