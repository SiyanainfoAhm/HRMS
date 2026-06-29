"use client";

import { Loader2 } from "lucide-react";

export function AuthLoadingOverlay({ message }: { message: string }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white/85 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-10 w-10 animate-spin text-brand-blue" aria-hidden />
      <p className="mt-4 text-sm font-semibold text-brand-navy">{message}</p>
      <p className="mt-1 text-xs text-brand-muted">Please wait…</p>
    </div>
  );
}
