"use client";

import { useEffect } from "react";
import { clearLegacyAuthStorage } from "@/lib/clientAuthStorage";

let cleared = false;

/** Drops auth state that failed validation, once: the auth cookies and any legacy browser storage token. */
export function ClearStaleSession() {
  useEffect(() => {
    if (cleared) return;
    cleared = true;
    clearLegacyAuthStorage(window.localStorage, window.sessionStorage); // legacy key; auth lives only in httpOnly cookies
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
  }, []);
  return null;
}
