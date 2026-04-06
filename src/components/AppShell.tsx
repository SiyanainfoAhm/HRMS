"use client";

import type { SessionUser } from "@/lib/auth";
import { Sidebar, type CompanyBranding } from "./Sidebar";
import { ToastProvider } from "./ToastProvider";
import { startTransition, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type { CompanyBranding };

function MenuIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function AppShell({
  user,
  companyBranding,
  children,
}: {
  user: SessionUser;
  companyBranding: CompanyBranding | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      setIsDesktop(mq.matches);
      if (mq.matches) setMobileNavOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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

  const brandName = companyBranding?.name?.trim() || "Company";
  const effectiveCollapsed = sidebarCollapsed && isDesktop;

  return (
    <ToastProvider>
      <div className="flex h-[100dvh] min-h-0 flex-col bg-slate-50 md:flex-row">
        {mobileNavOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <Sidebar
          user={user}
          companyBranding={companyBranding}
          collapsed={effectiveCollapsed}
          onToggle={toggleSidebar}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4 md:hidden">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <MenuIcon />
            </button>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{brandName}</div>
          </header>
          <div className="app-main-pad min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-[100vw] p-4 sm:p-5 lg:p-6">{children}</div>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
