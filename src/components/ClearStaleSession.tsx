"use client";

import { useEffect } from "react";

/** Drops auth cookies that failed validation so they cannot interfere with the next page load. */
export function ClearStaleSession() {
  useEffect(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
  }, []);
  return null;
}
