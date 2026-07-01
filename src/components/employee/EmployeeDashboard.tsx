"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { EmployeePayrollHistoryTable } from "@/components/employee/EmployeePayrollHistoryTable";
import { EmployeeProfileReadOnly } from "@/components/employee/EmployeeProfileReadOnly";
import { EmployeeSalarySlipPanel, type PayslipBundle } from "@/components/employee/EmployeeSalarySlipPanel";
import { AppCard, AppCardHeader } from "@/components/ui/AppCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppPageError } from "@/components/ui/AppPageError";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import {
  currentMonthYearLabel,
  fmtInr,
  fmtNum,
  type EmployeeLatestPayroll,
  type EmployeePayrollHistoryRow,
  type EmployeePayrollMaster,
  type EmployeeProfileUser,
} from "@/lib/employeeDashboard";

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-3 shadow-card">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${accent ? "text-emerald-800" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

function SalaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-[12px] text-slate-600">{label}</span>
      <span className="text-[13px] font-medium tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

export function EmployeeDashboard() {
  const user = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileUser, setProfileUser] = useState<EmployeeProfileUser | null>(null);
  const [master, setMaster] = useState<EmployeePayrollMaster | null>(null);
  const [latest, setLatest] = useState<EmployeeLatestPayroll | null>(null);
  const [history, setHistory] = useState<EmployeePayrollHistoryRow[]>([]);
  const [payslips, setPayslips] = useState<PayslipBundle | null>(null);
  const [payslipsLoading, setPayslipsLoading] = useState(true);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const pageLoading = loading || payslipsLoading;
  const pageError = error || payslipsError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, latestRes, historyRes] = await Promise.all([
          fetch("/api/profile/me"),
          fetch("/api/profile/latest-payroll"),
          fetch("/api/profile/payroll-history?limit=12"),
        ]);
        const profileData = await profileRes.json();
        const latestData = await latestRes.json();
        const historyData = await historyRes.json();
        if (!profileRes.ok) throw new Error(profileData?.error || "Failed to load profile");
        if (!cancelled) {
          setProfileUser(profileData.user ?? null);
          setMaster(profileData.payrollMaster ?? null);
          setLatest(latestData.latest ?? null);
          setHistory((historyData.history ?? []) as EmployeePayrollHistoryRow[]);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPayslipsLoading(true);
      setPayslipsError(null);
      try {
        const res = await fetch("/api/payslips/me");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load payslips");
        if (!cancelled) {
          setPayslips({
            company: data.company,
            user: data.user,
            payslips: data.payslips || [],
          });
        }
      } catch (e: unknown) {
        if (!cancelled) setPayslipsError(e instanceof Error ? e.message : "Failed to load payslips");
      } finally {
        if (!cancelled) setPayslipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const displayName = profileUser?.name || user?.name || "Employee";
  const hasQuarter = Boolean(master?.hasQuarter || master?.quarterAssigned);

  const stats = useMemo(() => {
    const src = latest ?? history[0];
    return {
      netPay: src?.netPay ?? master?.takeHome,
      gross: src?.grossEarnings ?? master?.totalEarnings,
      deductions: src?.deductions,
      payDays: src?.payDays,
      tds: master?.incomeTax,
      cpf: master?.cpfEffective,
    };
  }, [latest, history, master]);

  if (pageLoading) {
    return <AppPageLoader message="Loading your dashboard..." />;
  }

  if (pageError) {
    return (
      <AppPageError
        message="Unable to load your dashboard. Please try again."
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome, ${displayName}`}
        description="Here is your payroll and employment summary."
        badge={
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="navy">Employee</Badge>
            <Badge tone="info">{currentMonthYearLabel()}</Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Latest Net Pay" value={fmtInr(stats.netPay)} accent />
        <StatCard label="Gross Earnings" value={fmtInr(stats.gross)} />
        <StatCard label="Total Deductions" value={fmtInr(stats.deductions)} />
        <StatCard label="Paid Days" value={stats.payDays != null ? fmtNum(stats.payDays) : "—"} />
        <StatCard label="TDS (Monthly)" value={fmtInr(stats.tds)} />
        <StatCard label="CPF" value={fmtInr(stats.cpf)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <EmployeeProfileReadOnly user={profileUser} master={master} />

          <AppCard>
            <AppCardHeader
              title="Salary Structure"
              subtitle="Current payroll master summary (view only)."
              badge={<Badge tone="neutral">View Only</Badge>}
            />
            {!master ? (
              <EmptyState title="Payroll details unavailable" description="Payroll details are not available yet." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <SalaryRow label="Gross Basic" value={fmtInr(master.grossBasicPay)} />
                  <SalaryRow label="DA %" value={master.daPercent != null ? `${master.daPercent}%` : "—"} />
                  <SalaryRow label="HRA %" value={master.hraPercent != null ? `${master.hraPercent}%` : "—"} />
                  <SalaryRow label="DA Amount" value={fmtInr(master.daAmount)} />
                  <SalaryRow
                    label="HRA Amount"
                    value={hasQuarter ? "₹0" : fmtInr(master.hraAmount)}
                  />
                  <SalaryRow label="Medical" value={fmtInr(master.medical)} />
                  <SalaryRow label="Transport" value={fmtInr(master.transportTotal)} />
                  <SalaryRow label="Total Earnings" value={fmtInr(master.totalEarnings)} />
                </div>
                <div>
                  <SalaryRow label="CPF" value={fmtInr(master.cpfEffective)} />
                  <SalaryRow label="Professional Tax" value={fmtInr(master.professionalTax)} />
                  <SalaryRow label="Net Pay / Take Home" value={fmtInr(master.takeHome)} />
                  {hasQuarter ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <Badge tone="warning">Quarter Assigned</Badge>
                        <Badge tone="warning">HRA Not Applicable</Badge>
                      </div>
                      <SalaryRow label="Quarter" value={master.quarterName || "—"} />
                      <SalaryRow label="Quarter Type" value={master.quarterType || "—"} />
                      <SalaryRow label="Quarter Rent" value={fmtInr(master.quarterRent)} />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </AppCard>

          <AppCard padding={false} className="p-3 sm:p-3.5">
            <AppCardHeader title="Payroll History" subtitle="Your recent salary runs (last 12 months)." />
            <EmployeePayrollHistoryTable rows={history} limit={6} />
          </AppCard>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <AppCard>
            <AppCardHeader title="Latest Payroll" subtitle="Most recent generated payslip." />
            {!latest ? (
              <EmptyState
                title="No payslip yet"
                description="No payslip has been generated yet."
              />
            ) : (
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-slate-600">Period</span>
                  <span className="font-medium">{latest.periodLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Gross Earnings</span>
                  <span className="font-medium tabular-nums">{fmtInr(latest.grossEarnings)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Deductions</span>
                  <span className="font-medium tabular-nums">{fmtInr(latest.deductions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Net Pay</span>
                  <span className="font-semibold tabular-nums text-emerald-800">{fmtInr(latest.netPay)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Paid Days</span>
                  <span className="font-medium">{fmtNum(latest.payDays)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Working Days</span>
                  <span className="font-medium">{fmtNum(latest.workingDays)}</span>
                </div>
                <div className="pt-2">
                  <Link
                    href={`/profile?tab=pay&month=${String(latest.month).padStart(2, "0")}&year=${latest.year}`}
                  >
                    <Button size="sm" className="w-full sm:w-auto">
                      Download Payslip
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </AppCard>

          <EmployeeSalarySlipPanel
            data={payslips}
            error={payslipsError}
            compact
            title="Salary Slip Quick Access"
          />
        </div>
      </div>
    </div>
  );
}
