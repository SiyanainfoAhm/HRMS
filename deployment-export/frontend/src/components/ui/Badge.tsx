"use client";

import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/60",
  warning: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/60",
  info: "bg-sky-50 text-sky-900 ring-1 ring-sky-200/60",
  danger: "bg-red-50 text-red-800 ring-1 ring-red-200/60",
  navy: "bg-brand-navy/10 text-brand-navy ring-1 ring-brand-navy/15",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
