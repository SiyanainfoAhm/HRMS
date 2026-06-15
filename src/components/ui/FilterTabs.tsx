"use client";

import { cn } from "@/lib/cn";

export type FilterTabItem = {
  key: string;
  label: string;
};

export function FilterTabs({
  items,
  activeKey,
  onChange,
  variant = "tab",
  className,
}: {
  items: FilterTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  variant?: "tab" | "pill";
  className?: string;
}) {
  return (
    <div className={cn("filter-scroll", className)}>
      <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
        {items.map((item) => {
          const active = item.key === activeKey;
          const base = variant === "pill" ? "filter-pill" : "filter-tab";
          const state = active
            ? variant === "pill"
              ? "filter-pill-active"
              : "filter-tab-active"
            : variant === "pill"
              ? "filter-pill-inactive"
              : "filter-tab-inactive";
          return (
            <button key={item.key} type="button" onClick={() => onChange(item.key)} className={`${base} ${state}`}>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
