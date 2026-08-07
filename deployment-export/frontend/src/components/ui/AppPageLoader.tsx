"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  message: string;
  submessage?: string;
  /** `page` fills the content area; `overlay` covers the full viewport; `inline` is compact for modals/sections. */
  variant?: "page" | "overlay" | "inline";
  className?: string;
};

export function AppPageLoader({
  message,
  submessage = "Please wait while we fetch the latest data.",
  variant = "page",
  className,
}: Props) {
  const isOverlay = variant === "overlay";
  const isInline = variant === "inline";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        isOverlay
          ? "fixed inset-0 z-[200] bg-white/85 backdrop-blur-sm"
          : isInline
            ? "w-full rounded-lg border border-brand-border/50 bg-slate-50/80 py-10"
            : "min-h-[min(420px,60vh)] w-full rounded-xl border border-brand-border/60 bg-white/50 py-16",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2
        className={cn("animate-spin text-brand-blue", isInline ? "h-8 w-8" : "h-10 w-10")}
        aria-hidden
      />
      <p className="mt-4 text-sm font-semibold text-brand-navy">{message}</p>
      {submessage ? <p className="mt-1 max-w-xs text-xs text-brand-muted">{submessage}</p> : null}
    </div>
  );
}
