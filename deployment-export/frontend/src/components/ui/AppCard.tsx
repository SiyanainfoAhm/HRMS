"use client";

import { cn } from "@/lib/cn";

export function AppCard({
  children,
  className,
  padding = true,
}: {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-brand-border bg-white shadow-card",
        padding && "p-3 sm:p-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AppCardHeader({
  title,
  subtitle,
  badge,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {badge}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs text-brand-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
