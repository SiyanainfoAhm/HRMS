"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { EmployeePayrollHistoryRow } from "@/lib/employeeDashboard";
import { fmtInr } from "@/lib/employeeDashboard";

type Props = {
  rows: EmployeePayrollHistoryRow[];
  limit?: number;
  showViewAll?: boolean;
};

export function EmployeePayrollHistoryTable({ rows, limit, showViewAll = true }: Props) {
  const display = limit ? rows.slice(0, limit) : rows;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-600">
        No payroll history found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2">Month</th>
            <th className="px-2 py-2">Year</th>
            <th className="px-2 py-2 text-right">Gross</th>
            <th className="px-2 py-2 text-right">Deductions</th>
            <th className="px-2 py-2 text-right">Net Pay</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {display.map((row) => (
            <tr key={row.id ?? row.periodMonth} className="border-b border-slate-100 hover:bg-slate-50/80">
              <td className="px-2 py-2 font-medium text-slate-800">{row.periodLabel.split(" ")[0]}</td>
              <td className="px-2 py-2 text-slate-700">{row.year}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtInr(row.grossEarnings)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtInr(row.deductions)}</td>
              <td className="px-2 py-2 text-right font-medium tabular-nums text-emerald-800">{fmtInr(row.netPay)}</td>
              <td className="px-2 py-2">
                <Badge tone="success">{row.status}</Badge>
              </td>
              <td className="px-2 py-2 text-right">
                <Link
                  href={`/profile?tab=pay&month=${String(row.month).padStart(2, "0")}&year=${row.year}`}
                  className="text-xs font-medium text-brand-navy hover:underline"
                >
                  Download
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showViewAll && rows.length > (limit ?? rows.length) ? (
        <div className="mt-3 text-right">
          <Link href="/employee/payroll-history" className="text-xs font-medium text-brand-navy hover:underline">
            View all history
          </Link>
        </div>
      ) : null}
      {showViewAll && limit && rows.length > 0 ? (
        <div className="mt-3 flex justify-end">
          <Link href="/employee/payroll-history">
            <Button size="sm" variant="outline">
              View full history
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
