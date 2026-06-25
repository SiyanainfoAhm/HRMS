"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";
import { breadcrumbForPathname } from "@/lib/pageTitles";
import type { SessionUser } from "@/lib/auth";

function roleLabel(role: string): string {
  return role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Topbar({
  user,
  onOpenMobileNav,
}: {
  user: SessionUser;
  onOpenMobileNav?: () => void;
}) {
  const pathname = usePathname();
  const crumbs = breadcrumbForPathname(pathname);

  return (
    <header className="hidden shrink-0 border-b border-brand-border bg-white/90 backdrop-blur-md md:flex md:h-11 md:items-center md:justify-between md:px-4">
      <div className="flex min-w-0 items-center gap-3">
        {onOpenMobileNav && (
          <button type="button" className="btn btn-ghost !p-2 md:hidden" onClick={onOpenMobileNav} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        )}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
              {c.href ? (
                <Link href={c.href} className="truncate font-medium text-brand-muted hover:text-brand-navy">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-semibold text-slate-900">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 lg:inline">
          {roleLabel(user.role)}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-brand-border bg-brand-navy text-[10px] font-bold text-white shadow-sm">
          {(user.name || user.email).slice(0, 2).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
