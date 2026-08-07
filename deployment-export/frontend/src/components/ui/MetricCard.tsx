"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "blue",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  accent?: "blue" | "teal" | "amber" | "green" | "navy";
  className?: string;
}) {
  const iconBg = {
    blue: "bg-blue-50 text-brand-blue",
    teal: "bg-teal-50 text-brand-teal",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-success-soft text-success",
    navy: "bg-indigo-50 text-brand-navy",
  }[accent];

  return (
    <motion.div
      whileHover={typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches ? { y: -2 } : undefined}
      transition={{ duration: 0.2 }}
      className={cn("card card-interactive", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-muted">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-brand-muted">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", iconBg)}>
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        )}
      </div>
    </motion.div>
  );
}
