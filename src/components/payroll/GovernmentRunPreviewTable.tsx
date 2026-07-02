"use client";

import { useEffect, useRef, useState } from "react";
import type { PayrollFieldDefinition } from "@/lib/payrollFieldTypes";
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
  customFieldAmount,
  inpWide,
  payrollDaysInputClass,
  v,
} from "./payrollRunPreviewShared";

function leaveDaysFromRow(row: GovernmentRunPreviewRow) {
  const gr = row.govRecalc as { hplDays?: number; eolDays?: number } | undefined;
  const gm = row.governmentMonthly as { hplDays?: number; eolDays?: number } | undefined;
  return {
    hplDays: gr?.hplDays ?? gm?.hplDays ?? 0,
    eolDays: gr?.eolDays ?? gm?.eolDays ?? 0,
  };
}

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
  customEarnings?: Record<string, number>;
  customDeductions?: Record<string, number>;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  hplDays?: number;
  eolDays?: number;
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
    loanRecovery: number;
    welfare: number;
    hpl: number;
    eol: number;
    vehCharge: number;
    other: number;
    quarterRent: number;
  };
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
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
  daArrear?: number;
  transportArrear?: number;
  grossArrear?: number;
  cpfArrear?: number;
  netArrear?: number;
  hasQuarter?: boolean;
  quarterName?: string | null;
  quarterType?: string | null;
  hraEligible?: boolean;
  govRecalc?: {
    customEarnings?: Record<string, number>;
    customDeductions?: Record<string, number>;
    hplDays?: number;
    eolDays?: number;
  };
};

type Props = {
  rows: GovernmentRunPreviewRow[];
  daysInMonth: number;
  effectiveRunDay: number;
  readOnly: boolean;
  customEarningFields?: PayrollFieldDefinition[];
  customDeductionFields?: PayrollFieldDefinition[];
  onUpdate: (employeeUserId: string, field: string, value: number) => void;
};

function SummaryStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`truncate text-[13px] tabular-nums ${emphasis ? "font-semibold text-slate-900" : "text-slate-800"}`}>
        {value}
      </p>
    </div>
  );
}

function StickyMiniSummary({
  gross,
  deductions,
  net,
}: {
  gross: number;
  deductions: number;
  net: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5">
      <SummaryStat label="Gross" value={fmtIn(gross)} />
      <SummaryStat label="Deductions" value={fmtIn(deductions)} />
      <SummaryStat label="Net Pay" value={fmtIn(net)} emphasis />
    </div>
  );
}

function resolveUnpaidArrears(row: GovernmentRunPreviewRow) {
  const g = row.governmentMonthly;
  return {
    daArrear: Math.round(Number(row.daArrear ?? g?.daArrearsPaid ?? 0) || 0),
    trArrear: Math.round(Number(row.transportArrear ?? g?.transportArrearsPaid ?? 0) || 0),
    grossArrear: Math.round(Number(row.grossArrear ?? g?.grossArrear ?? 0) || 0),
    cpfArrear: Math.round(Number(row.cpfArrear ?? g?.cpfArrear ?? 0) || 0),
    netArrear: Math.round(Number(row.netArrear ?? g?.netArrear ?? 0) || 0),
  };
}

function ArrearField({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: number;
  readOnly: boolean;
  onChange?: (n: number) => void;
}) {
  return (
    <div className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-0.5">
      <span className="text-center text-[9px] font-medium uppercase tracking-wide text-slate-600">{label}</span>
      {readOnly || !onChange ? (
        <span className="text-center text-[13px] tabular-nums text-slate-900">{fmtIn(value)}</span>
      ) : (
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={inpWide}
        />
      )}
    </div>
  );
}

function ArrearsUnpaidSection({
  row,
  readOnly,
  onUpdate,
}: {
  row: GovernmentRunPreviewRow;
  readOnly: boolean;
  onUpdate: Props["onUpdate"];
}) {
  const arrears = resolveUnpaidArrears(row);
  const title = readOnly ? "ARREARS (INCLUDED)" : "ARREARS (UNPAID)";

  return (
    <section className="w-full shrink-0 border-t border-slate-100 pt-2.5" aria-label={title}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-900">{title}</p>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200/90 bg-white/90 p-1.5 sm:flex-nowrap">
        <ArrearField
          label="DA arr."
          value={arrears.daArrear}
          readOnly={readOnly}
          onChange={(n) => onUpdate(row.employeeUserId, "daArrear", n)}
        />
        <ArrearField
          label="Tr. arr."
          value={arrears.trArrear}
          readOnly={readOnly}
          onChange={(n) => onUpdate(row.employeeUserId, "transportArrear", n)}
        />
        <ArrearField
          label="Gross arr."
          value={arrears.grossArrear}
          readOnly={readOnly}
          onChange={(n) => onUpdate(row.employeeUserId, "grossArrear", n)}
        />
        <ArrearField
          label="CPF arr."
          value={arrears.cpfArrear}
          readOnly={readOnly}
          onChange={(n) => onUpdate(row.employeeUserId, "cpfArrear", n)}
        />
        <ArrearField
          label="Net arr."
          value={arrears.netArrear}
          readOnly={readOnly}
          onChange={(n) => onUpdate(row.employeeUserId, "netArrear", n)}
        />
      </div>
    </section>
  );
}

function GovernmentEmployeeDetail({
  row,
  daysInMonth,
  effectiveRunDay,
  readOnly,
  customEarningFields,
  customDeductionFields,
  onUpdate,
}: {
  row: GovernmentRunPreviewRow;
  daysInMonth: number;
  effectiveRunDay: number;
  readOnly: boolean;
  customEarningFields: PayrollFieldDefinition[];
  customDeductionFields: PayrollFieldDefinition[];
  onUpdate: Props["onUpdate"];
}) {
  const scrollerRef = useRef<PayrollScrollerHandle>(null);
  const g = row.governmentMonthly;
  const gb = row.grossMonthly ?? 0;
  const displayName = row.employeeName || row.employeeEmail || "—";
  const totalEarn = v(g, "totalEarnings");
  const totalDed = v(g, "totalDeductions");

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

      <StickyMiniSummary gross={totalEarn} deductions={totalDed} net={row.netPay} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col lg:flex-row">
          <aside className="w-full shrink-0 border-b border-slate-100 p-3 lg:w-52 lg:border-b-0 lg:border-r xl:w-56">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <SummaryStat label="Gr. basic" value={fmtIn(gb)} />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Days</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums text-slate-800">{row.payDays}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={effectiveRunDay ?? daysInMonth}
                    value={row.payDays}
                    onChange={(e) => onUpdate(row.employeeUserId, "payDays", parseInt(e.target.value, 10) || 0)}
                    className={payrollDaysInputClass}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">HPL days</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums text-slate-800">{leaveDaysFromRow(row).hplDays}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={daysInMonth}
                    value={leaveDaysFromRow(row).hplDays}
                    onChange={(e) =>
                      onUpdate(row.employeeUserId, "hplDays", parseInt(e.target.value, 10) || 0)
                    }
                    className={payrollDaysInputClass}
                    title="Half pay leave — 2 days = 1 day effect on Basic + DA"
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">EOL days</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums text-slate-800">{leaveDaysFromRow(row).eolDays}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={daysInMonth}
                    value={leaveDaysFromRow(row).eolDays}
                    onChange={(e) =>
                      onUpdate(row.employeeUserId, "eolDays", parseInt(e.target.value, 10) || 0)
                    }
                    className={payrollDaysInputClass}
                    title="EOL — 1 day effect each on Basic, DA, HRA, Transport"
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Advance</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums">{fmtIn(row.incentive ?? 0)}</p>
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
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">PR Bonus</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums">{fmtIn(row.prBonus ?? 0)}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={row.prBonus ?? 0}
                    onChange={(e) => onUpdate(row.employeeUserId, "prBonus", parseInt(e.target.value, 10) || 0)}
                    className={inpWide}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">EOL (Enc.)</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums">{fmtIn(v(g, "encashmentPaid"))}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={v(g, "encashmentPaid")}
                    onChange={(e) =>
                      onUpdate(row.employeeUserId, "govEarning_encashmentPaid", parseInt(e.target.value, 10) || 0)
                    }
                    className={inpWide}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">EOL DA</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums">{fmtIn(v(g, "encashmentDaPaid"))}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={v(g, "encashmentDaPaid")}
                    onChange={(e) =>
                      onUpdate(row.employeeUserId, "govEarning_encashmentDaPaid", parseInt(e.target.value, 10) || 0)
                    }
                    className={inpWide}
                  />
                )}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Reimb.</p>
                {readOnly ? (
                  <p className="text-[13px] tabular-nums">{fmtIn(row.reimbursement ?? 0)}</p>
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
            <div className="mt-2 flex flex-wrap gap-1">
              {row.payslipPending ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">Pending slip</span>
              ) : readOnly ? (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Saved</span>
              ) : (
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">Editable</span>
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
            <PayrollComponentScroller ref={scrollerRef}>
              <div className="flex flex-col gap-2.5">
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
                  {customEarningFields.map((f) => (
                    <FieldChip
                      key={f.id}
                      label={f.fieldLabel}
                      readOnly={readOnly}
                      value={customFieldAmount(g, row.govRecalc, f.fieldKey, "earnings")}
                      onChange={(n) => onUpdate(row.employeeUserId, `govCustom_${f.fieldKey}`, n)}
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
                  {customDeductionFields.map((f) => (
                    <FieldChip
                      key={f.id}
                      label={f.fieldLabel}
                      readOnly={readOnly}
                      value={customFieldAmount(g, row.govRecalc, f.fieldKey, "deductions")}
                      onChange={(n) => onUpdate(row.employeeUserId, `govCustomDeduction_${f.fieldKey}`, n)}
                    />
                  ))}
                </PayrollSectionRow>
              </div>
            </PayrollComponentScroller>
            <ArrearsUnpaidSection row={row} readOnly={readOnly} onUpdate={onUpdate} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GovernmentRunPreviewTable({
  rows,
  daysInMonth,
  effectiveRunDay,
  readOnly,
  customEarningFields = [],
  customDeductionFields = [],
  onUpdate,
}: Props) {
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
    <div className="page-workspace h-[min(calc(100dvh-13rem),760px)] min-h-[340px]">
      <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(200px,240px)_1fr]">
        <div className="flex min-h-0 flex-col border-b border-brand-border xl:border-b-0 xl:border-r">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Employees</span>
            <span className="text-[11px] tabular-nums text-slate-500">{rows.length}</span>
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
                      "w-full border-b border-slate-50 px-2.5 py-2 text-left transition-colors",
                      active ? "bg-brand-navy/5 ring-1 ring-inset ring-brand-blue/30" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="truncate text-[13px] font-medium leading-tight text-slate-900">{name}</div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] leading-tight text-slate-500">
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
              customEarningFields={customEarningFields}
              customDeductionFields={customDeductionFields}
              onUpdate={onUpdate}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-[13px] text-slate-500">
              Select an employee to view payroll details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
