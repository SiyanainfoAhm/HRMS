"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/Skeleton";

const TEAL = "#0d9488";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "S";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function AvatarUrl({ userId, gender }: { userId: string; gender: string | null }) {
  const seed = encodeURIComponent(userId);
  const base = `https://api.dicebear.com/9.x/personas/svg?seed=${seed}&backgroundColor=0d9488`;
  if (gender === "female") {
    return `${base}&hair=bobCut,long,pigtails,curlyBun,straightBun,bobBangs&facialHairProbability=0`;
  }
  return `${base}&hair=bald,buzzcut,shortCombover,fade,mohawk,balding&facialHairProbability=50`;
}

export function DashboardContent() {
  const { role, name, id } = useAuth();
  const [user, setUser] = useState<{ gender: string | null } | null>(null);
  const [leaveBalances, setLeaveBalances] = useState<{ leaveTypeName: string; used: number; remaining: number | null; isPaid: boolean }[]>([]);
  const [payslips, setPayslips] = useState<{ periodFormatted: string; generatedAt: string; payDays: number | null }[]>([]);
  const [upcomingHolidays, setUpcomingHolidays] = useState<{ name: string; holiday_date: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, balanceRes, payslipRes, holidaysRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/leave/balance"),
          fetch("/api/payslips/me"),
          fetch("/api/holidays"),
        ]);
        if (!cancelled && meRes.ok) {
          const d = await meRes.json();
          setUser(d.user ?? null);
        }
        if (!cancelled && balanceRes.ok) {
          const d = await balanceRes.json();
          const balances = (d.balances ?? []).slice(0, 3).map((b: any) => ({
            leaveTypeName: b.leaveTypeName,
            used: b.used ?? 0,
            remaining: b.remaining != null ? b.remaining : null,
            isPaid: b.isPaid ?? true,
          }));
          setLeaveBalances(balances);
        }
        if (!cancelled && payslipRes.ok) {
          const d = await payslipRes.json();
          setPayslips((d.payslips ?? []).slice(0, 1));
        }
        if (!cancelled && holidaysRes.ok) {
          const d = await holidaysRes.json();
          const today = new Date().toISOString().slice(0, 10);
          const upcoming = (d.holidays ?? [])
            .filter((h: any) => String(h.holiday_date) >= today)
            .slice(0, 5)
            .map((h: any) => ({ name: h.name ?? "", holiday_date: String(h.holiday_date) }));
          setUpcomingHolidays(upcoming);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const displayName = name || "Employee";
  const greeting = getGreeting();

  // Employee-focused dashboard (attractive layout from reference)
  if (role === "employee") {
    const lastPay = payslips[0];
    const lastPayDate = lastPay?.generatedAt
      ? new Date(lastPay.generatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

    return (
      <section className="min-h-[60vh]">
        {/* Top greeting banner */}
        <div
          className="mb-6 rounded-xl px-6 py-4 text-center text-white"
          style={{ backgroundColor: TEAL }}
        >
          <h1 className="text-xl font-semibold">
            {greeting} {displayName}
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: Profile + Leave summary */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-4">
                <Image
                  src={AvatarUrl({ userId: id, gender: user?.gender ?? null })}
                  alt=""
                  width={80}
                  height={80}
                  unoptimized
                  className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-200"
                />
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{displayName}</h2>
                  <p className="text-sm text-slate-500">Employee</p>
                </div>
              </div>

              <div className="space-y-4">
                {loading ? (
                  <div className="space-y-3" aria-busy="true" aria-label="Loading leave balances">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                        <Skeleton className="h-8 w-12" />
                      </div>
                    ))}
                  </div>
                ) : leaveBalances.length > 0 ? (
                  leaveBalances.map((b) => (
                    <div
                      key={b.leaveTypeName}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${TEAL}20` }}
                        >
                          {b.isPaid ? (
                            <svg className="h-5 w-5" style={{ color: TEAL }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" style={{ color: TEAL }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: TEAL }}>
                            {b.leaveTypeName}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold" style={{ color: TEAL }}>
                          {b.remaining != null ? b.remaining : "∞"}
                        </p>
                        <p className="text-xs font-medium text-slate-500">Available</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-sm text-slate-500">
                    No leave policies configured.
                  </div>
                )}
              </div>

              <Link
                href="/approvals?tab=leave"
                className="mt-4 block w-full rounded-lg py-2.5 text-center text-sm font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: TEAL }}
              >
                Go to Leave module
              </Link>
            </div>
          </div>

          {/* Right: My Pay + placeholder */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div
                className="px-6 py-3 text-lg font-semibold text-white"
                style={{ backgroundColor: TEAL }}
              >
                My Pay
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-600">Last Pay Period</span>
                    <span className="font-medium text-slate-900">
                      {lastPay?.periodFormatted || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <span className="text-sm text-slate-600">Last Pay Date</span>
                    <span className="font-medium text-slate-900">{lastPayDate}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">No. Of Pay Days</span>
                    <span className="font-medium text-slate-900">
                      {lastPay?.payDays != null ? lastPay.payDays : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Upcoming holidays</h3>
                <Link href="/holidays" className="text-xs font-medium" style={{ color: TEAL }}>
                  View all
                </Link>
              </div>
              {upcomingHolidays.length > 0 ? (
                <ul className="space-y-3">
                  {upcomingHolidays.map((h, idx) => {
                    const d = new Date(h.holiday_date + "T12:00:00Z");
                    const fmt = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                    return (
                      <li key={idx} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                        <span className="text-sm font-medium text-slate-900">{h.name}</span>
                        <span className="text-sm text-slate-600">{fmt}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No upcoming holidays.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Managerial / Admin dashboard (cleaner card layout, teal accents)
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="muted">You are viewing the {role.replace("_", " ")} workflow.</p>
      </div>

      <div
        className="mb-6 rounded-xl px-6 py-4 text-white"
        style={{ backgroundColor: TEAL }}
      >
        <h2 className="text-lg font-semibold">
          {greeting}, {displayName}
        </h2>
      </div>

      <div className="grid-3">
        {(role === "super_admin" || role === "admin" || role === "hr" || role === "manager") && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Attendance overview</h2>
            <p className="muted">View attendance insight and time tracking for your company / department / team.</p>
          </div>
        )}

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Leaves</h2>
          <p className="muted">
            See your current leave balance and recent requests. Managers and HR can see their team or company.
          </p>
          <Link
            href="/approvals?tab=leave"
            className="mt-3 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: TEAL }}
          >
            Go to Leave module
          </Link>
        </div>

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Payroll & Payslips</h2>
          <p className="muted">
            View generated payslips for each payroll period. Admin / HR can run payroll per company.
          </p>
          <Link
            href="/profile?tab=pay"
            className="mt-3 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: TEAL }}
          >
            View my payslips
          </Link>
        </div>

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Holidays</h2>
          <p className="muted">Company holiday calendar as configured by Admin / HR, visible to all employees.</p>
          <Link
            href="/holidays"
            className="mt-3 inline-flex rounded-lg border-2 px-4 py-2 text-sm font-medium transition hover:bg-slate-50"
            style={{ borderColor: TEAL, color: TEAL }}
          >
            View calendar
          </Link>
        </div>

        {(role === "super_admin" || role === "admin" || role === "hr") && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Employee Hub</h2>
            <p className="muted">Search, view and manage employee records for the entire company.</p>
            <Link
              href="/employees"
              className="mt-3 inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: TEAL }}
            >
              Go to Employees
            </Link>
          </div>
        )}

        {role === "super_admin" && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Companies</h2>
            <p className="muted">Register companies, configure their business details and onboard HR / Admin users.</p>
          </div>
        )}
      </div>
    </section>
  );
}
