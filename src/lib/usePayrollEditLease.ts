"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LeaseState = { ready: boolean; acquired: boolean; message: string; leaseToken: string | null; clientId: string; acquire: (takeover?: boolean) => Promise<boolean> };

export function usePayrollEditLease(year: string, month: string, enabled: boolean): LeaseState {
  const clientId = useMemo(() => {
    if (typeof window === "undefined") return "";
    // sessionStorage can be cloned when a tab is duplicated; a fresh ID per
    // mounted tab keeps the server lease truly tab specific.
    return crypto.randomUUID();
  }, []);
  const [ready, setReady] = useState(false);
  const [acquired, setAcquired] = useState(false);
  const [message, setMessage] = useState("");
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const [leasePeriod, setLeasePeriod] = useState("");
  const periodKey = `${year}-${month}`;

  const request = useCallback(async (action: string, takeover = false) => {
    const response = await fetch("/api/payroll/edit-lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, year: Number(year), month: Number(month), clientId, leaseToken, takeover }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Unable to secure payroll editing session.");
    return data;
  }, [clientId, leaseToken, month, year]);

  const acquire = useCallback(async (takeover = false) => {
    if (!enabled || !clientId) { setReady(true); setAcquired(false); return false; }
    if (takeover && typeof window !== "undefined" && !window.confirm("Take over payroll editing in this tab? Unsaved edits in the other tab will not transfer; keep that tab open to recover them.")) return false;
    setReady(false);
    try {
      const data = await request("acquire", takeover);
      const didAcquire = Boolean(data.acquired);
      leaseTokenRef.current = data.leaseToken ?? null; setLeaseToken(data.leaseToken ?? null); setLeasePeriod(periodKey); setAcquired(didAcquire); setMessage(data.message || "");
      return didAcquire;
    } catch (error) { setAcquired(false); setMessage(error instanceof Error ? error.message : "Unable to secure payroll editing session."); return false; }
    finally { setReady(true); }
  }, [clientId, enabled, periodKey, request]);

  useEffect(() => {
    setReady(false); setAcquired(false); setLeaseToken(null); leaseTokenRef.current = null; setLeasePeriod(""); setMessage("");
    if (!enabled || !clientId) { setReady(true); return; }
    let alive = true;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cirt-payroll-edit-lock") : null;
    channel?.postMessage({ type: "editing", clientId, year, month });
    const run = async () => {
      try {
        const response = await fetch("/api/payroll/edit-lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acquire", year: Number(year), month: Number(month), clientId }), cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!alive) return;
        leaseTokenRef.current = data.leaseToken ?? null; setLeasePeriod(periodKey); setAcquired(Boolean(data.acquired)); setLeaseToken(data.leaseToken ?? null); setMessage(data.message || "");
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : "Unable to secure payroll editing session."); }
      finally { if (alive) setReady(true); }
    };
    void run();
    return () => {
      alive = false; channel?.close();
      const token = leaseTokenRef.current;
      const body = JSON.stringify({ action: "release", year: Number(year), month: Number(month), clientId, leaseToken: token });
      if (token) void fetch("/api/payroll/edit-lock", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    };
  // Lease acquisition is period scoped. The token is intentionally read by cleanup when scope changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, enabled, year, month]);

  useEffect(() => {
    if (!enabled || !acquired || !leaseToken) return;
    const timer = window.setInterval(async () => {
      try { await request("heartbeat"); }
      catch (error) { setAcquired(false); setMessage(error instanceof Error ? error.message : "Editing lease was lost."); }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [acquired, enabled, leaseToken, request]);

  const scopeIsCurrent = leasePeriod === periodKey;
  return { ready: !enabled || (ready && scopeIsCurrent), acquired: enabled && acquired && scopeIsCurrent, message, leaseToken: scopeIsCurrent ? leaseToken : null, clientId, acquire };
}
