"use client";

import type { SessionUser } from "@/lib/auth";
import { Sidebar, type CompanyBranding } from "./Sidebar";
import { Topbar } from "./ui/Topbar";
import { ToastProvider } from "./ToastProvider";
import { startTransition, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { titleForPathname } from "@/lib/pageTitles";

export type { CompanyBranding };

function brandingFromApiCompany(company: Record<string, unknown> | null | undefined): CompanyBranding | null {
  if (!company) return null;
  const name = String(company.name ?? "").trim();
  const logoUrl =
    (company.logo_url != null && String(company.logo_url)) ||
    (company.logoUrl != null && String(company.logoUrl)) ||
    null;
  if (!name && !logoUrl) return null;
  return { name: name || "Company", logoUrl };
}

export function AppShell({
  user,
  companyBranding: initialBranding,
  children,
}: {
  user: SessionUser;
  companyBranding: CompanyBranding | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [companyBranding, setCompanyBranding] = useState<CompanyBranding | null>(initialBranding);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    setCompanyBranding(initialBranding);
  }, [initialBranding]);

  useEffect(() => {
    if (initialBranding) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company/me");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const next = brandingFromApiCompany(data.company);
        if (!cancelled && next) setCompanyBranding(next);
      } catch {
        // keep server/default branding
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialBranding]);

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

  const brandName = companyBranding?.name?.trim() || "CIRT HRMS";
  const effectiveCollapsed = sidebarCollapsed && isDesktop;
  const mobileTitle = titleForPathname(pathname);

  return (
    <ToastProvider>
      <div className="flex h-[100dvh] min-h-0 flex-col bg-brand-bg md:flex-row">
        {mobileNavOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px] md:hidden"
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
          <header className="flex shrink-0 items-center gap-3 border-b border-brand-border bg-white px-3 py-2.5 shadow-sm md:hidden">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-900">{mobileTitle}</div>
              <div className="truncate text-xs text-brand-muted">{brandName} HRMS</div>
            </div>
          </header>
          <Topbar user={user} />
          <div className="app-main-pad min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-5 lg:p-8">{children}</div>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
