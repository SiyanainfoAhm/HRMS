"use client";

import type { SessionUser } from "@/lib/auth";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { ToastProvider } from "./ToastProvider";

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-screen flex-col bg-slate-50">
        <TopNav user={user} onLogout={() => {}} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl p-6">{children}</div>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
