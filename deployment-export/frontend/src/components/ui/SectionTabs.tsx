"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export type SectionTabItem = {
  key: string;
  label: string;
  href?: string;
};

export function SectionTabs({
  items,
  activeKey,
  onChange,
  className,
}: {
  items: SectionTabItem[];
  activeKey: string;
  onChange?: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("filter-scroll", className)}>
      <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
        {items.map((item) => {
          const active = item.key === activeKey;
          const btnClass = `btn shrink-0 ${active ? "btn-primary" : "btn-outline"}`;
          if (item.href) {
            return (
              <Link key={item.key} href={item.href} className={btnClass}>
                {item.label}
              </Link>
            );
          }
          return (
            <button key={item.key} type="button" className={btnClass} onClick={() => onChange?.(item.key)}>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
