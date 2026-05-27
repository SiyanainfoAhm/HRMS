"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  BadgeCheck,
  Wallet,
  UserCircle,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { SessionUser } from "@/lib/auth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

export type CompanyBranding = { name: string; logoUrl: string | null };

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
  const { role } = useAuth();
  const router = useRouter();

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className={iconCls} /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([
          { href: "/employees", label: "Employees", icon: <Users className={iconCls} /> },
          { href: "/attendance", label: "Attendance", icon: <Clock className={iconCls} /> },
        ] as const)
      : []),
    ...(role === "employee" || role === "manager"
      ? ([{ href: "/attendance", label: "Attendance", icon: <Clock className={iconCls} /> }] as const)
      : []),
    { href: "/holidays", label: "Holidays", icon: <CalendarDays className={iconCls} /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([{ href: "/payroll", label: "Payroll", icon: <Wallet className={iconCls} /> }] as const)
      : []),
    { href: "/approvals", label: "Approvals", icon: <BadgeCheck className={iconCls} /> },
    { href: "/profile", label: "Profile", icon: <UserCircle className={iconCls} /> },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? ([{ href: "/settings", label: "Settings", icon: <Settings className={iconCls} /> }] as const)
      : []),
  ];

  const initials = getInitials(user.name, user.email);
  const brandName = companyBranding?.name?.trim() || "CIRT HRMS";
  const logoUrl = companyBranding?.logoUrl ?? null;
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

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
    <>
      <ConfirmDialog
        open={logoutOpen}
        title="Logout now?"
        message="You will be signed out of HRMS on this device."
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
              href="/dashboard"
              title={collapsed ? `${brandName} — Dashboard` : "Dashboard"}
              aria-label={`${brandName} — Dashboard`}
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
                {logoUrl && !logoFailed ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="max-h-full max-w-full object-contain bg-white p-1"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <span className={cn("font-bold text-white", collapsed ? "text-xs" : "text-sm")}>
                    {companyMark(brandName)}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-bold text-slate-900">{brandName}</span>
                  <span className="block text-xs font-medium text-brand-muted">CIRT HRMS </span>
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
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
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
