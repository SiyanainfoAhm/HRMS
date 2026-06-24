"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function DataTableShell({
  children,
  className,
  resetScrollKey,
  toolbar,
  footer,
}: {
  children: ReactNode;
  className?: string;
  /** When this changes, horizontal scroll resets to start */
  resetScrollKey?: string | number;
  toolbar?: ReactNode;
  footer?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [resetScrollKey]);

  return (
    <div className={cn("data-table-shell flex flex-col", className)}>
      {toolbar ? <div className="shrink-0 border-b border-brand-border bg-slate-50/80 px-3 py-2">{toolbar}</div> : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>
      {footer ? <div className="shrink-0 border-t border-brand-border bg-slate-50/60 px-3 py-2 text-xs text-slate-500">{footer}</div> : null}
    </div>
  );
}

export const dataTh =
  "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600";
export const dataThNum = cn(dataTh, "text-right");
export const dataTd = "whitespace-nowrap border-t border-slate-100 px-3 py-2 text-sm text-slate-800";
export const dataTdNum = cn(dataTd, "text-right tabular-nums");
export const dataTdLeft = cn(dataTd, "text-left");
export const dataThSticky =
  "sticky top-0 z-20 bg-slate-50/95 backdrop-blur-sm shadow-[0_1px_0_0_rgba(226,232,240,1)]";
