"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PayrollComponentScroller, type PayrollScrollerHandle } from "./PayrollComponentScroller";
import { PayrollEmployeeCardHeader } from "./PayrollEmployeeCardHeader";
import {
  GOV_PREVIEW_DEDUCTION_FIELDS,
  GOV_PREVIEW_EARNING_FIELDS,
  FieldChip,
  PayrollSectionRow,
  d,
  fmtIn,
  inpWide,
  v,
} from "./payrollRunPreviewShared";

/** Monthly compute snapshot from `/api/payroll/run` preview (same shape as `computeGovernmentMonthlyPayroll` result). */
export type GovernmentPreviewMonthly = {
  basicPaid: number;
  spPayPaid: number;
  daPaid: number;
  transportPaid: number;
  hraPaid: number;
  medicalPaid: number;
  extraWorkAllowancePaid: number;
  nightAllowancePaid: number;
  uniformAllowancePaid: number;
  educationAllowancePaid: number;
  daArrearsPaid: number;
  transportArrearsPaid: number;
  encashmentPaid: number;
  encashmentDaPaid: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
  deductions: {
    incomeTax: number;
    pt: number;
    lic: number;
    cpf: number;
    daCpf: number;
    vpf: number;
    pfLoan: number;
    postOffice: number;
    creditSociety: number;
    stdLicenceFee: number;
    electricity: number;
    water: number;
    mess: number;
    horticulture: number;
    welfare: number;
    vehCharge: number;
    other: number;
  };
};

export type GovernmentRunPreviewRow = {
  employeeUserId: string;
  employeeName: string | null;
  employeeEmail: string;
  payDays: number;
  unpaidLeaveDays: number;
  grossMonthly?: number;
  grossPay: number;
  netPay: number;
  deductions: number;
  takeHome: number;
  incentive: number;
  prBonus: number;
  reimbursement: number;
  tds: number;
  pfEmployee: number;
  governmentMonthly?: GovernmentPreviewMonthly | null;
  payslipPending?: boolean;
  arrearLines?: Array<{
    id?: string;
    arrearYear?: number;
    arrearMonth?: number;
    oldDaPercent?: number;
    newDaPercent?: number;
    grossArrear?: number;
    revisionEventId?: string;
  }>;
  arrearLineIds?: string[];
};

type Props = {
  rows: GovernmentRunPreviewRow[];
  daysInMonth: number;
  effectiveRunDay: number;
  readOnly: boolean;
  onUpdate: (employeeUserId: string, field: string, value: number) => void;
};

function SummaryStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`truncate text-sm tabular-nums ${emphasis ? "font-semibold text-slate-900" : "text-slate-800"}`}>
        {value}
      </p>
    </div>
  );
}

function StickyMiniSummary({
  gross,
  deductions,
  net,
  takeHome,
}: {
  gross: number;
  deductions: number;
  net: number;
  takeHome: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 sm:grid-cols-4">
      <SummaryStat label="Gross" value={fmtIn(gross)} />
      <SummaryStat label="Deductions" value={fmtIn(deductions)} />
      <SummaryStat label="Net pay" value={fmtIn(net)} emphasis />
      <SummaryStat label="Take home" value={fmtIn(takeHome)} emphasis />
    </div>
  );
}

function GovernmentEmployeeDetail({
  row,
  daysInMonth,
  effectiveRunDay,
  readOnly,
  onUpdate,
}: {
  row: GovernmentRunPreviewRow;
  daysInMonth: number;
  effectiveRunDay: number;
  readOnly: boolean;
  onUpdate: Props["onUpdate"];
}) {
  const scrollerRef = useRef<PayrollScrollerHandle>(null);
  const g = row.governmentMonthly;
  const gb = row.grossMonthly ?? 0;
  const displayName = row.employeeName || row.employeeEmail || "—";
  const totalEarn = v(g, "totalEarnings");
  const totalDed = v(g, "totalDeductions");

  const showArrears =
    v(g, "grossArrear" as keyof GovernmentPreviewMonthly) > 0 ||
    v(g, "daArrearsPaid") > 0 ||
    v(g, "transportArrearsPaid") > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PayrollEmployeeCardHeader
        displayName={displayName}
        email={row.employeeEmail}
        expanded
        onToggleExpand={() => {}}
        gross={totalEarn}
        deductions={totalDed}
        net={row.netPay}
        showScrollButtons
        onScrollLeft={() => scrollerRef.current?.scrollLeft()}
        onScrollRight={() => scrollerRef.current?.scrollRight()}
        onResetScroll={() => scrollerRef.current?.resetScroll()}
        hideExpandToggle
      />

      <StickyMiniSummary
        gross={totalEarn}
        deductions={totalDed}
        net={row.netPay}
        takeHome={row.takeHome}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col lg:flex-row">
          <aside className="w-full shrink-0 border-b border-slate-100 p-4 lg:w-56 lg:border-b-0 lg:border-r xl:w-64">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <SummaryStat label="Gr. basic" value={fmtIn(gb)} />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Days</p>
                {readOnly ? (
                  <p className="text-sm tabular-nums text-slate-800">
                    {row.payDays}
                    {row.unpaidLeaveDays > 0 ? ` (−${row.unpaidLeaveDays})` : ""}
                  </p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={effectiveRunDay ?? daysInMonth}
                    value={row.payDays}
                    onChange={(e) => onUpdate(row.employeeUserId, "payDays", parseInt(e.target.value, 10) || 0)}
                    className={`${inpWide} w-[4.5rem] min-w-[4rem]`}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Advance</p>
                {readOnly ? (
                  <p className="text-sm tabular-nums">{fmtIn(row.incentive ?? 0)}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={row.incentive ?? 0}
                    onChange={(e) => onUpdate(row.employeeUserId, "incentive", parseInt(e.target.value, 10) || 0)}
                    className={inpWide}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Reimb.</p>
                {readOnly ? (
                  <p className="text-sm tabular-nums">{fmtIn(row.reimbursement ?? 0)}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={row.reimbursement ?? 0}
                    onChange={(e) => onUpdate(row.employeeUserId, "reimbursement", parseInt(e.target.value, 10) || 0)}
                    className={inpWide}
                  />
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {row.payslipPending ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">Pending slip</span>
              ) : readOnly ? (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Saved</span>
              ) : (
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">Editable</span>
              )}
            </div>
          </aside>

          <div className="min-w-0 flex-1 p-4">
            <PayrollComponentScroller ref={scrollerRef}>
              <div className="flex flex-col gap-4">
                <PayrollSectionRow title="Earnings" titleClassName="text-emerald-900">
                  {GOV_PREVIEW_EARNING_FIELDS.map(({ key, label }) => (
                    <FieldChip
                      key={key}
                      label={label}
                      readOnly={readOnly}
                      value={v(g, key)}
                      onChange={(n) => onUpdate(row.employeeUserId, `govEarning_${key}`, n)}
                    />
                  ))}
                </PayrollSectionRow>
                <PayrollSectionRow title="Deductions" titleClassName="text-rose-900">
                  {GOV_PREVIEW_DEDUCTION_FIELDS.map(({ key, label }) => (
                    <FieldChip
                      key={key}
                      label={label}
                      readOnly={readOnly}
                      value={d(g, key)}
                      onChange={(n) => onUpdate(row.employeeUserId, `govDeduction_${key}`, n)}
                    />
                  ))}
                </PayrollSectionRow>
                {showArrears ? (
                  <PayrollSectionRow
                    title={readOnly ? "Arrears (included)" : "Arrears (unpaid)"}
                    titleClassName="text-violet-900"
                  >
                    {[
                      { label: "DA arr.", value: v(g, "daArrearsPaid") },
                      { label: "Tr. arr.", value: v(g, "transportArrearsPaid") },
                      { label: "Gross arr.", value: v(g, "grossArrear" as keyof GovernmentPreviewMonthly) },
                      { label: "CPF arr.", value: v(g, "cpfArrear" as keyof GovernmentPreviewMonthly) },
                      { label: "Net arr.", value: v(g, "netArrear" as keyof GovernmentPreviewMonthly) },
                    ].map(({ label, value }) => (
                      <FieldChip key={label} label={label} readOnly value={value} onChange={() => {}} />
                    ))}
                  </PayrollSectionRow>
                ) : null}
              </div>
            </PayrollComponentScroller>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GovernmentRunPreviewTable({ rows, daysInMonth, effectiveRunDay, readOnly, onUpdate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && rows.some((r) => r.employeeUserId === prev)) return prev;
      return rows[0].employeeUserId;
    });
  }, [rows]);

  const selected = rows.find((r) => r.employeeUserId === selectedId);

  return (
    <div className="page-workspace h-[min(calc(100dvh-17rem),680px)] min-h-[380px]">
      <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(220px,260px)_1fr]">
        <div className="flex min-h-0 flex-col border-b border-brand-border xl:border-b-0 xl:border-r">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employees</span>
            <span className="text-xs tabular-nums text-slate-500">{rows.length}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Payroll employees">
            {rows.map((r) => {
              const name = r.employeeName || r.employeeEmail || "—";
              const active = r.employeeUserId === selectedId;
              const g = r.governmentMonthly;
              return (
                <li key={r.employeeUserId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedId(r.employeeUserId)}
                    className={cn(
                      "w-full border-b border-slate-50 px-3 py-2.5 text-left transition-colors",
                      active ? "bg-brand-navy/5 ring-1 ring-inset ring-brand-blue/30" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="truncate text-sm font-medium text-slate-900">{name}</div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">{r.employeeEmail}</span>
                      <span className="shrink-0 tabular-nums font-medium text-slate-700">
                        {fmtIn(v(g, "totalEarnings") || r.netPay)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-h-0 overflow-hidden">
          {selected ? (
            <GovernmentEmployeeDetail
              key={selected.employeeUserId}
              row={selected}
              daysInMonth={daysInMonth}
              effectiveRunDay={effectiveRunDay}
              readOnly={readOnly}
              onUpdate={onUpdate}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">
              Select an employee to view payroll details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
