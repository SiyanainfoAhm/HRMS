"use client";

import { AppCard, AppCardHeader } from "@/components/ui/AppCard";
import { Badge } from "@/components/ui/Badge";
import { fmtDmy } from "@/lib/dateFormat";
import type { EmployeePayrollMaster, EmployeeProfileUser } from "@/lib/employeeDashboard";

type Props = {
  user: EmployeeProfileUser | null;
  master: EmployeePayrollMaster | null;
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="truncate text-[13px] font-medium text-slate-900">{value || "—"}</p>
    </div>
  );
}

export function EmployeeProfileReadOnly({ user, master }: Props) {
  const name = master?.name || user?.name || "—";
  const status = master?.status || user?.employmentStatus || "—";

  return (
    <AppCard>
      <AppCardHeader
        title="Employee Details"
        subtitle="Your employment information (read-only)."
        badge={<Badge tone="neutral">View Only</Badge>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Employee Code" value={master?.employeeCode || user?.employeeCode || ""} />
        <Detail label="Name" value={name} />
        <Detail label="Designation" value={master?.designation || user?.designation || ""} />
        <Detail label="Department" value={master?.department || ""} />
        <Detail label="Division" value={master?.division || ""} />
        <Detail label="Pay Level" value={master?.payLevel != null ? String(master.payLevel) : ""} />
        <Detail
          label="Date of Joining"
          value={fmtDmy(master?.dateOfJoining || user?.dateOfJoining || "")}
        />
        <Detail label="Increment Month" value={master?.incrementMonth || ""} />
        <Detail label="Status" value={String(status)} />
      </div>
      {user?.email ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{user.email}</span>
        </p>
      ) : null}
    </AppCard>
  );
}
