"use client";

import type { SessionUser } from "@/lib/auth";
import { Sidebar, type CompanyBranding } from "./Sidebar";
import { ToastProvider } from "./ToastProvider";
import { startTransition, useEffect, useState } from "react";

export type { CompanyBranding };

export function AppShell({
  user,
  companyBranding,
  children,
}: {
  user: SessionUser;
  companyBranding: CompanyBranding | null;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hrms.sidebarCollapsed");
      if (saved === "1") {
        startTransition(() => setSidebarCollapsed(true));
      }
    } catch {
      // ignore
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("hrms.sidebarCollapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <ToastProvider>
      <div className="flex h-screen bg-slate-50">
        <Sidebar user={user} companyBranding={companyBranding} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <div className="flex-1 overflow-y-auto">
          <div className="w-full p-6">{children}</div>
        </div>
      </div>
    </ToastProvider>
  );
}
