"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { motion } from "framer-motion";
import { fadeIn } from "@/lib/motion";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      {...fadeIn}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-brand-border bg-slate-50/50 px-5 py-10 text-center"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-navy">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-brand-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
