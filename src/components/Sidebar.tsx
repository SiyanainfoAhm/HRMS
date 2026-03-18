"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export function Sidebar() {
  const pathname = usePathname();
  const { role } = useAuth();

  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    ...(role === "super_admin" || role === "admin" || role === "hr"
      ? [{ href: "/employees", label: "Employees" } as const]
      : []),
    { href: "/holidays", label: "Holidays" },
    { href: "/approvals", label: "Approvals" },
    { href: "/profile", label: "Profile" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
      <div className="flex h-full flex-col gap-1 p-3">
        <div className="mb-2 px-2 py-1.5">
          <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
            HRMS
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {nav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-50 text-emerald-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
