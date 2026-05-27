"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, X } from "lucide-react";

type ToastType = "success" | "error";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
  durationMs: number;
};

type ToastContextValue = {
  showToast: (type: ToastType, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) window.clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string) => {
      const id = crypto.randomUUID();
      const toast: Toast = { id, type, message, createdAt: Date.now(), durationMs: 4500 };
      setToasts((prev) => [...prev, toast]);
      const timeoutId = window.setTimeout(() => removeToast(id), toast.durationMs);
      timersRef.current.set(id, timeoutId);
    },
    [removeToast],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-3 md:top-16">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              role="status"
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              className={`pointer-events-auto overflow-hidden rounded-2xl border shadow-card ${
                t.type === "success" ? "border-green-200 bg-white" : "border-red-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    t.type === "success" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                  }`}
                  aria-hidden
                >
                  {t.type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1 text-sm text-slate-800">
                  <div className="font-semibold text-slate-900">{t.type === "success" ? "Success" : "Error"}</div>
                  <div className="mt-0.5 break-words text-[13px] leading-5 text-brand-muted">{t.message}</div>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => removeToast(t.id)}
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-1 w-full bg-slate-100">
                <motion.div
                  className={`h-1 ${t.type === "success" ? "bg-success" : "bg-danger"}`}
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: t.durationMs / 1000, ease: "linear" }}
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
