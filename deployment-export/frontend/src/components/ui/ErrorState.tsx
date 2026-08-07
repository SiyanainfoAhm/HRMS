"use client";

import { AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { fadeIn } from "@/lib/motion";

export function ErrorState({
  title = "Something went wrong",
  message = "We could not load this data. Please try again.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <motion.div
      {...fadeIn}
      className="flex flex-col items-center justify-center rounded-2xl border border-red-200/80 bg-danger-soft/40 px-6 py-12 text-center"
      role="alert"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-brand-muted">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary mt-5" onClick={onRetry}>
          Try again
        </button>
      )}
    </motion.div>
  );
}
