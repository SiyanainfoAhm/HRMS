"use client";

import { useEffect, useRef, useState } from "react";
import { PayrollComponentScroller, type PayrollScrollerHandle } from "./PayrollComponentScroller";
import { PayrollEmployeeCardHeader } from "./PayrollEmployeeCardHeader";
import { FieldChip, PayrollSectionRow, fmtIn, inpWide } from "./payrollRunPreviewShared";

export type PrivateRunPreviewRow = {
  employeeUserId: string;
  employeeName: string | null;
  employeeEmail: string;
  payDays: number;
  unpaidLeaveDays: number;
  grossPay: number;
  netPay: number;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
  profTax: number;
  prBonus?: number;
  incentive?: number;
  reimbursement?: number;
  tds?: number;
  deductions: number;
  takeHome: number;
  ctc: number;
  payslipPending?: boolean;
};

type Props = {
  rows: PrivateRunPreviewRow[];
  effectiveRunDay: number;
  daysInMonth: number;
  readOnly: boolean;
  pfLabel: string;
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

function PrivateEmployeeCard({
  row,
  effectiveRunDay,
  daysInMonth,
  readOnly,
  pfLabel,
  onUpdate,
  expanded,
  onToggleExpand,
}: {
  row: PrivateRunPreviewRow;
  effectiveRunDay: number;
  daysInMonth: number;
  readOnly: boolean;
  pfLabel: string;
  onUpdate: Props["onUpdate"];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const scrollerRef = useRef<PayrollScrollerHandle>(null);
  const displayName = row.employeeName || row.employeeEmail || "—";

  const summaryBlock = (
    <div
      className={
        expanded
          ? "grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3"
          : "flex flex-wrap items-end gap-x-5 gap-y-2"
      }
    >
      <SummaryStat label="Employee" value={displayName} />
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
      <SummaryStat label="Gross" value={fmtIn(row.grossPay)} />
      <SummaryStat label="Deductions" value={fmtIn(row.deductions)} />
      <SummaryStat label="Net pay" value={fmtIn(row.netPay)} emphasis />
      {row.payslipPending ? (
        <span className="self-center rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
          Pending slip
        </span>
      ) : readOnly ? (
        <span className="self-center rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
          Saved
        </span>
      ) : (
        <span className="self-center rounded bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">
          Editable
        </span>
      )}
    </div>
  );

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <PayrollEmployeeCardHeader
        displayName={displayName}
        email={row.employeeEmail}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        gross={row.grossPay}
        deductions={row.deductions}
        net={row.netPay}
        showScrollButtons={expanded}
        onScrollLeft={() => scrollerRef.current?.scrollLeft()}
        onScrollRight={() => scrollerRef.current?.scrollRight()}
        onResetScroll={() => scrollerRef.current?.resetScroll()}
      />

      <div className={expanded ? "flex flex-col md:flex-row" : "px-4 py-3"}>
        <aside
          className={
            expanded
              ? "w-full shrink-0 border-b border-slate-100 p-4 md:w-[min(100%,20rem)] md:border-b-0 md:border-r"
              : "w-full"
          }
        >
          {summaryBlock}
          {expanded ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Take home</p>
              <p className="text-base font-semibold tabular-nums text-slate-900">{fmtIn(row.takeHome)}</p>
            </div>
          ) : null}
        </aside>

        {expanded ? (
          <div className="min-w-0 flex-1 p-4">
            <PayrollComponentScroller ref={scrollerRef}>
              <div className="flex flex-col gap-4">
                <PayrollSectionRow title="Salary" titleClassName="text-emerald-900">
                  <FieldChip
                    label="Gross"
                    readOnly={readOnly}
                    value={row.grossPay}
                    onChange={(n) => onUpdate(row.employeeUserId, "grossPay", n)}
                  />
                  <FieldChip
                    label="Net"
                    readOnly={readOnly}
                    value={row.netPay}
                    onChange={(n) => onUpdate(row.employeeUserId, "netPay", n)}
                  />
                </PayrollSectionRow>
                <PayrollSectionRow title="Statutory" titleClassName="text-rose-900">
                  <FieldChip
                    label={pfLabel}
                    readOnly={readOnly}
                    value={row.pfEmployee}
                    onChange={(n) => onUpdate(row.employeeUserId, "pfEmployee", n)}
                  />
                  <FieldChip
                    label="PF (R)"
                    readOnly={readOnly}
                    value={row.pfEmployer}
                    onChange={(n) => onUpdate(row.employeeUserId, "pfEmployer", n)}
                  />
                  <FieldChip
                    label="ESIC"
                    readOnly={readOnly}
                    value={row.esicEmployee}
                    onChange={(n) => onUpdate(row.employeeUserId, "esicEmployee", n)}
                  />
                  <FieldChip
                    label="ESIC (R)"
                    readOnly={readOnly}
                    value={row.esicEmployer}
                    onChange={(n) => onUpdate(row.employeeUserId, "esicEmployer", n)}
                  />
                  <FieldChip
                    label="P. Tax"
                    readOnly={readOnly}
                    value={row.profTax}
                    onChange={(n) => onUpdate(row.employeeUserId, "profTax", n)}
                  />
                </PayrollSectionRow>
                <PayrollSectionRow title="Variable & other" titleClassName="text-violet-900">
                  <FieldChip
                    label="Bonus"
                    readOnly={readOnly}
                    value={row.prBonus ?? 0}
                    onChange={(n) => onUpdate(row.employeeUserId, "prBonus", n)}
                  />
                  <FieldChip
                    label="Advance"
                    readOnly={readOnly}
                    value={row.incentive ?? 0}
                    onChange={(n) => onUpdate(row.employeeUserId, "incentive", n)}
                  />
                  <FieldChip
                    label="Reimb."
                    readOnly={readOnly}
                    value={row.reimbursement ?? 0}
                    onChange={(n) => onUpdate(row.employeeUserId, "reimbursement", n)}
                  />
                  <FieldChip
                    label="TDS"
                    readOnly={readOnly}
                    value={row.tds ?? 0}
                    onChange={(n) => onUpdate(row.employeeUserId, "tds", n)}
                  />
                  <FieldChip
                    label="Total ded."
                    readOnly={readOnly}
                    value={row.deductions}
                    onChange={(n) => onUpdate(row.employeeUserId, "deductions", n)}
                  />
                  <FieldChip
                    label="Take home"
                    readOnly={readOnly}
                    value={row.takeHome}
                    onChange={(n) => onUpdate(row.employeeUserId, "takeHome", n)}
                  />
                  <FieldChip
                    label="CTC"
                    readOnly={readOnly}
                    value={row.ctc}
                    onChange={(n) => onUpdate(row.employeeUserId, "ctc", n)}
                  />
                </PayrollSectionRow>
              </div>
            </PayrollComponentScroller>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function PrivateRunPreviewCards({
  rows,
  effectiveRunDay,
  daysInMonth,
  readOnly,
  pfLabel,
  onUpdate,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!rows.length) {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds((prev) => {
      if (prev.size > 0) {
        const next = new Set([...prev].filter((id) => rows.some((r) => r.employeeUserId === id)));
        if (next.size > 0) return next;
      }
      return new Set([rows[0].employeeUserId]);
    });
  }, [rows]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-600">
        Each employee appears in its own card. Use horizontal scroll inside the card for all payroll fields; the summary
        stays pinned on the left (or top on small screens).
      </p>
      <div className="space-y-4">
        {rows.map((r) => (
          <PrivateEmployeeCard
            key={r.employeeUserId}
            row={r}
            effectiveRunDay={effectiveRunDay}
            daysInMonth={daysInMonth}
            readOnly={readOnly}
            pfLabel={pfLabel}
            onUpdate={onUpdate}
            expanded={expandedIds.has(r.employeeUserId)}
            onToggleExpand={() => toggleExpand(r.employeeUserId)}
          />
        ))}
      </div>
    </div>
  );
}
