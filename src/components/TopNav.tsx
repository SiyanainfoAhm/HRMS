"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0];
  return local.slice(0, 2).toUpperCase();
}

function roleLabel(role: string): string {
  return role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopNav({
  user,
  onLogout,
  onToggleSidebar,
  sidebarCollapsed,
}: {
  user: SessionUser;
  onLogout: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}) {
  const router = useRouter();
  const [confirmState, setConfirmState] = useState<null | { title: string; message: string; confirmText?: string }>(null);
  const confirmResolveRef = useState<{ fn: ((v: boolean) => void) | null }>({ fn: null })[0];

  function confirmAction(args: { title: string; message: string; confirmText?: string }): Promise<boolean> {
    setConfirmState(args);
    return new Promise((resolve) => {
      confirmResolveRef.fn = resolve;
    });
  }

  function closeConfirm(v: boolean) {
    setConfirmState(null);
    const fn = confirmResolveRef.fn;
    confirmResolveRef.fn = null;
    fn?.(v);
  }

  async function handleLogout() {
    const ok = await confirmAction({
      title: "Logout now?",
      message: "You will be signed out of HRMS on this device.",
      confirmText: "Logout",
    });
    if (!ok) return;
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      {confirmState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => closeConfirm(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{confirmState.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{confirmState.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => closeConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => closeConfirm(true)}>
                {confirmState.confirmText ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? "☰" : "⟨⟩"}
        </button>
        <div className="text-sm text-slate-500">HRMS</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600">{roleLabel(user.role)}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Logout
        </button>
      </div>
      </header>
    </>
  );
}
