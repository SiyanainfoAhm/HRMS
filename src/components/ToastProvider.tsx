"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

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

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, type, message, createdAt: Date.now(), durationMs: 4500 };
    setToasts((prev) => [...prev, toast]);
    const timeoutId = window.setTimeout(() => removeToast(id), toast.durationMs);
    timersRef.current.set(id, timeoutId);
  }, [removeToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-16 z-[100] flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto overflow-hidden rounded-xl border shadow-lg ${
              t.type === "success" ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"
            }`}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <div
                className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full ${
                  t.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                }`}
                aria-hidden="true"
              >
                ✓
              </div>
              <div className={`min-w-0 flex-1 text-sm ${t.type === "success" ? "text-emerald-950" : "text-red-950"}`}>
                <div className="font-medium">{t.type === "success" ? "Success" : "Error"}</div>
                <div className="mt-0.5 break-words text-[13px] leading-5 opacity-90">{t.message}</div>
              </div>
              <button
                type="button"
                className={`rounded-md px-2 py-1 text-sm ${
                  t.type === "success" ? "text-emerald-900/70 hover:text-emerald-950" : "text-red-900/70 hover:text-red-950"
                }`}
                onClick={() => removeToast(t.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="h-1 w-full bg-black/5">
              <div
                className={`${t.type === "success" ? "bg-emerald-600" : "bg-red-600"} h-1`}
                style={{
                  width: "100%",
                  animation: `toast-shrink ${t.durationMs}ms linear forwards`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toast-shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

