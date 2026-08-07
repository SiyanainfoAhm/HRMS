"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminRole } from "@/lib/roles";
import { EmployeePayrollHistoryTable } from "@/components/employee/EmployeePayrollHistoryTable";
import { AppCard, AppCardHeader } from "@/components/ui/AppCard";
import { AppPageError } from "@/components/ui/AppPageError";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { PageHeader } from "@/components/ui/PageHeader";
import type { EmployeePayrollHistoryRow } from "@/lib/employeeDashboard";

export default function EmployeePayrollHistoryPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EmployeePayrollHistoryRow[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (role && isAdminRole(role)) {
      router.replace("/payroll/master");
    }
  }, [role, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/profile/payroll-history?limit=24");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load history");
        if (!cancelled) setHistory((data.history ?? []) as EmployeePayrollHistoryRow[]);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loading) {
    return <AppPageLoader message="Loading payroll history..." />;
  }

  if (error) {
    return (
      <AppPageError
        message="Unable to load payroll history. Please try again."
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll History"
        description="View and download your previous salary slips."
      />
      <AppCard padding={false} className="p-3 sm:p-3.5">
        <AppCardHeader title="All records" subtitle="Your payroll runs in reverse chronological order." />
        <EmployeePayrollHistoryTable rows={history} showViewAll={false} />
      </AppCard>
    </div>
  );
}
