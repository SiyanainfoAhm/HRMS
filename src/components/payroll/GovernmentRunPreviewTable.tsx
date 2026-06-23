"use client";

import { useEffect, useRef, useState } from "react";
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

function GovernmentEmployeeCard({
  row,
  daysInMonth,
  effectiveRunDay,
  readOnly,
  onUpdate,
  expanded,
  onToggleExpand,
}: {
  row: GovernmentRunPreviewRow;
  daysInMonth: number;
  effectiveRunDay: number;
  readOnly: boolean;
  onUpdate: Props["onUpdate"];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const scrollerRef = useRef<PayrollScrollerHandle>(null);
  const g = row.governmentMonthly;
  const gb = row.grossMonthly ?? 0;
  const displayName = row.employeeName || row.employeeEmail || "—";
  const totalEarn = v(g, "totalEarnings");
  const totalDed = v(g, "totalDeductions");

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
      <SummaryStat label="Gr. basic" value={fmtIn(gb)} />
      <SummaryStat label="Gross earnings" value={fmtIn(totalEarn)} />
      <SummaryStat label="Total deductions" value={fmtIn(totalDed)} />
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

  const showArrears =
    v(g, "grossArrear" as keyof GovernmentPreviewMonthly) > 0 ||
    v(g, "daArrearsPaid") > 0 ||
    v(g, "transportArrearsPaid") > 0;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <PayrollEmployeeCardHeader
        displayName={displayName}
        email={row.employeeEmail}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        gross={totalEarn}
        deductions={totalDed}
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
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
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
              <div className="col-span-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Take home</p>
                <p className="text-base font-semibold tabular-nums text-slate-900">{fmtIn(row.takeHome)}</p>
              </div>
            </div>
          ) : null}
        </aside>

        {expanded ? (
          <div className="min-w-0 flex-1 p-4">
            <PayrollComponentScroller ref={scrollerRef}>
              <div className="flex flex-col gap-4">
                <PayrollSectionRow title="Earnings (paid month)" titleClassName="text-emerald-900">
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
                  <PayrollSectionRow title="DA arrears (auto)" titleClassName="text-violet-900">
                    {[
                      { label: "DA ARR.", value: v(g, "daArrearsPaid") },
                      { label: "TR. ARR.", value: v(g, "transportArrearsPaid") },
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
        ) : null}
      </div>
    </article>
  );
}

export function GovernmentRunPreviewTable({ rows, daysInMonth, effectiveRunDay, readOnly, onUpdate }: Props) {
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
        Each employee has a separate preview card. Scroll earnings and deductions horizontally inside the card — the
        summary on the left stays visible. Expand or collapse cards to review multiple employees quickly.
      </p>
      <div className="space-y-4">
        {rows.map((r) => (
          <GovernmentEmployeeCard
            key={r.employeeUserId}
            row={r}
            daysInMonth={daysInMonth}
            effectiveRunDay={effectiveRunDay}
            readOnly={readOnly}
            onUpdate={onUpdate}
            expanded={expandedIds.has(r.employeeUserId)}
            onToggleExpand={() => toggleExpand(r.employeeUserId)}
          />
        ))}
      </div>
      <p className="text-[10px] leading-snug text-slate-500">
        Paid days max {effectiveRunDay ?? daysInMonth} (month length {daysInMonth} days). Σ Ded includes all deduction
        fields; the payslip &quot;CPF&quot; bundle is CPF + DA CPF + VPF + PF loan.
      </p>
    </div>
  );
}
