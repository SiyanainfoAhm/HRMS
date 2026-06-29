"use client";

import { Pencil, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DataTableShell,
  dataTd,
  dataTdLeft,
  dataTdNum,
  dataTh,
  dataThNum,
  dataThSticky,
} from "@/components/ui/DataTable";
import type { PayrollMasterRecord } from "./PayrollMasterScreen";

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

function earningAmount(basic: number | null | undefined, percent: number | string | null | undefined) {
  const b = Number(basic ?? 0);
  const p = Number(percent ?? 0);
  if (!Number.isFinite(b) || !Number.isFinite(p)) return null;
  return Math.round((b * p) / 100);
}

function statusTone(status: string | null | undefined): "success" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "inactive" || status === "resigned") return "neutral";
  return "warning";
}

const stickyLeft =
  "sticky left-0 z-10 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)] after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-slate-100";
const stickyLeft2 =
  "sticky left-[4.5rem] z-10 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.06)]";
const stickyRight =
  "sticky right-0 z-10 bg-white shadow-[-2px_0_4px_-2px_rgba(15,23,42,0.08)] before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-slate-100";

type Props = {
  rows: PayrollMasterRecord[];
  canWrite: boolean;
  cpfRateLabel: string;
  onEdit: (row: PayrollMasterRecord) => void;
  onDeactivate: (row: PayrollMasterRecord) => void;
  resetKey?: string | number;
};

export function PayrollMasterDataGrid({ rows, canWrite, cpfRateLabel, onEdit, onDeactivate, resetKey }: Props) {
  return (
    <DataTableShell
      resetScrollKey={resetKey ?? rows.length}
      toolbar={
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
          <Badge tone="info">{cpfRateLabel}</Badge>
        </span>
      }
      footer={`${rows.length} employee${rows.length === 1 ? "" : "s"} · scroll for additional deduction columns`}
    >
      <table className="w-full min-w-[1400px] border-collapse text-sm">
        <thead>
          <tr className={dataThSticky}>
            <th className={`${dataTh} ${stickyLeft} min-w-[4.5rem]`}>Code</th>
            <th className={`${dataTh} ${stickyLeft2} min-w-[10rem] !text-left`}>Name</th>
            <th className={dataTh}>Designation</th>
            <th className={dataTh}>Dept</th>
            <th className={dataTh}>Div</th>
            <th className={dataThNum}>Level</th>
            <th className={dataTh}>Increment Month</th>
            <th className={dataThNum}>Gross Basic</th>
            <th className={dataThNum}>DA %</th>
            <th className={dataThNum}>DA Amt</th>
            <th className={dataThNum}>HRA %</th>
            <th className={dataThNum}>HRA Amt</th>
            <th className={dataThNum}>Med</th>
            <th className={dataThNum}>Transport</th>
            <th className={dataThNum}>Total Earn.</th>
            <th className={dataThNum}>CPF</th>
            <th className={dataThNum}>Take Home</th>
            <th className={dataTh}>Status</th>
            <th className="px-2 py-1.5 text-right border-l border-slate-200">DA CPF</th>
            <th className="px-2 py-1.5 text-right">PT</th>
            <th className="px-2 py-1.5 text-right">Inc. Tax</th>
            <th className="px-2 py-1.5 text-right">LIC</th>
            <th className="px-2 py-1.5 text-right">Mess</th>
            <th className="px-2 py-1.5 text-right">Welfare</th>
            <th className="px-2 py-1.5 text-right">VPF</th>
            <th className="px-2 py-1.5 text-right">P.O.</th>
            <th className="px-2 py-1.5 text-right">Credit</th>
            <th className="px-2 py-1.5 text-right">Elec.</th>
            <th className="px-2 py-1.5 text-right">Water</th>
            <th className="px-2 py-1.5 text-right">Bank Rec.</th>
            <th className="px-2 py-1.5 text-right">Other</th>
            <th className="px-2 py-1.5 text-right">Advance</th>
            <th className="px-2 py-1.5 text-left">Effective</th>
            {canWrite ? <th className={`${dataTh} ${stickyRight} min-w-[7rem]`}>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className={`group transition-colors hover:bg-brand-blue/[0.03] ${i % 2 === 1 ? "bg-slate-50/40" : "bg-white"}`}
            >
              <td className={`${dataTdLeft} ${stickyLeft} font-mono text-xs text-slate-600`}>{row.employeeCode || "—"}</td>
              <td className={`${dataTdLeft} ${stickyLeft2} max-w-[12rem]`}>
                <span className="block truncate font-medium text-slate-900" title={row.name ?? row.email ?? undefined}>
                  {row.name || row.email || "—"}
                </span>
              </td>
              <td className={dataTdLeft}>{row.designation || "—"}</td>
              <td className={dataTdLeft}>{row.department || "—"}</td>
              <td className={dataTdLeft}>{row.division || "—"}</td>
              <td className={dataTdNum}>{row.payLevel ?? "—"}</td>
              <td className={dataTdLeft}>{row.incrementMonth ?? "—"}</td>
              <td className={dataTdNum}>{fmt(row.grossBasicPay)}</td>
              <td className={dataTdNum}>{row.daPercent ?? row.da_percent ?? "—"}</td>
              <td className={dataTdNum}>
                {fmt(row.daAmount ?? earningAmount(row.grossBasicPay, row.daPercent ?? row.da_percent))}
              </td>
              <td className={dataTdNum}>{row.hraPercent ?? row.hra_percent ?? "—"}</td>
              <td className={dataTdNum}>
                {fmt(row.hraAmount ?? earningAmount(row.grossBasicPay, row.hraPercent ?? row.hra_percent))}
              </td>
              <td className={dataTdNum}>{fmt(row.medical)}</td>
              <td className={dataTdNum}>{fmt(row.transportTotal)}</td>
              <td className={`${dataTdNum} font-medium`}>{fmt(row.totalEarnings)}</td>
              <td className={dataTdNum}>{fmt(row.cpfEffective ?? row.cpfDefault)}</td>
              <td className={`${dataTdNum} font-semibold text-slate-900`}>{fmt(row.takeHome)}</td>
              <td className={dataTdLeft}>
                <Badge tone={statusTone(row.status)}>{row.status ?? "active"}</Badge>
              </td>
              <td className={`${dataTdNum} border-l border-slate-100`}>{fmt(row.daCpf)}</td>
              <td className={dataTdNum}>{fmt(row.professionalTax)}</td>
              <td className={dataTdNum}>{fmt(row.incomeTax)}</td>
              <td className={dataTdNum}>{fmt(row.lic)}</td>
              <td className={dataTdNum}>{fmt(row.mess)}</td>
              <td className={dataTdNum}>{fmt(row.welfare)}</td>
              <td className={dataTdNum}>{fmt(row.vpf)}</td>
              <td className={dataTdNum}>{fmt(row.postOffice)}</td>
              <td className={dataTdNum}>{fmt(row.creditSociety)}</td>
              <td className={dataTdNum}>{fmt(row.electricity)}</td>
              <td className={dataTdNum}>{fmt(row.water)}</td>
              <td className={dataTdNum}>{fmt(row.loanRecovery)}</td>
              <td className={dataTdNum}>{fmt(row.otherDeduction)}</td>
              <td className={dataTdNum}>{fmt(row.advance)}</td>
              <td className={dataTdLeft}>{row.effectiveFrom?.slice(0, 10) ?? "—"}</td>
              {canWrite && (
                <td className={`${dataTd} ${stickyRight} !px-2`}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {row.status === "active" && (
                      <Button variant="ghost" size="sm" className="!text-amber-800 hover:!bg-amber-50" onClick={() => onDeactivate(row)}>
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableShell>
  );
}
