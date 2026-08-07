"use client";

import { motion, AnimatePresence } from "framer-motion";
import { scaleIn } from "@/lib/motion";
import { X } from "lucide-react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Close dialog"
            onClick={onCancel}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            {...scaleIn}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-white shadow-dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-brand-border px-5 py-4">
              <div>
                <h2 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900">
                  {title}
                </h2>
                <p className="mt-1 text-sm text-brand-muted">{message}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost !p-2"
                onClick={onCancel}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
                {cancelText}
              </button>
              <button
                type="button"
                className={variant === "danger" ? "btn btn-danger" : "btn btn-primary"}
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? "Please wait…" : confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
