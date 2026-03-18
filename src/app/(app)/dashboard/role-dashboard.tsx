"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export function DashboardContent() {
  const { role } = useAuth();

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="muted">You are viewing the {role.replace("_", " ")} workflow.</p>
      </div>

      <div className="grid-3">
        {(role === "super_admin" || role === "admin" || role === "hr" || role === "manager") && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Attendance overview</h2>
            <p className="muted">
              View attendance insight and time tracking for your company / department / team.
            </p>
          </div>
        )}

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Leaves</h2>
          <p className="muted">
            See your current leave balance and recent requests. Managers and HR can see their team
            or company.
          </p>
          <Link href="/approvals?tab=leave" className="btn btn-primary mt-3">
            Go to Leave module
          </Link>
        </div>

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Payroll & Payslips</h2>
          <p className="muted">
            View generated payslips for each payroll period. Admin / HR can run payroll per company.
          </p>
          <Link href="/profile?tab=pay" className="btn btn-primary mt-3">
            View my payslips
          </Link>
        </div>

        <div className="card">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Holidays</h2>
          <p className="muted">
            Company holiday calendar as configured by Admin / HR, visible to all employees.
          </p>
        </div>

        {(role === "super_admin" || role === "admin" || role === "hr") && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Employee Hub</h2>
            <p className="muted">
              Search, view and manage employee records for the entire company (and for Super Admin,
              across companies).
            </p>
          </div>
        )}

        {role === "super_admin" && (
          <div className="card">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Companies</h2>
            <p className="muted">
              Register companies, configure their business details and onboard HR / Admin users.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
