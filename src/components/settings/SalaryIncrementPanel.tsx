"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  calculateNewGrossBasic,
  defaultEffectiveStartDate,
  effectiveDateMatchesMonth,
  INCREMENT_MONTH_OPTIONS,
  incrementAmount,
  type IncrementMonthOption,
  yearOptions,
} from "@/lib/salaryIncrement";
import { cn } from "@/lib/cn";

type EligibleEmployee = {
  masterId: string;
  employeeUserId: string | null;
  employeeCode: string | null;
  name: string | null;
  designation: string | null;
  department: string | null;
  currentGrossBasic: number;
  incrementPercentage: number | null;
  incrementAmount: number | null;
  newGrossBasic: number | null;
  effectiveStartDate: string;
  alreadyApplied: boolean;
  duplicateMessage?: string | null;
  selectedPct?: string;
};

type HistoryRow = {
  id: string;
  employeeCode: string | null;
  incrementMonth: string;
  effectiveStartDate: string | null;
  oldGrossBasic: number;
  incrementPercentage: number;
  incrementAmount: number;
  newGrossBasic: number;
  appliedAt: string | null;
  status: string;
};

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

function parseApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const d = data as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  if (typeof d.message === "string") return d.message;
  const errors = d.errors as Record<string, string[]> | undefined;
  if (errors) {
    const first = Object.values(errors).flat()[0];
    if (first) return first;
  }
  return fallback;
}

export function SalaryIncrementPanel() {
  const { showToast } = useToast();
  const years = useMemo(() => yearOptions(), []);

  const [incrementMonth, setIncrementMonth] = useState<IncrementMonthOption>("July");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [effectiveStartDate, setEffectiveStartDate] = useState(
    defaultEffectiveStartDate("July", new Date().getFullYear()),
  );
  const [incrementPercentage, setIncrementPercentage] = useState("3");
  const [employees, setEmployees] = useState<EligibleEmployee[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payrollWarning, setPayrollWarning] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pctWarning, setPctWarning] = useState<string | null>(null);

  const syncEffectiveDate = useCallback((month: IncrementMonthOption, y: number) => {
    setEffectiveStartDate(defaultEffectiveStartDate(month, y));
  }, []);

  useEffect(() => {
    syncEffectiveDate(incrementMonth, Number(year));
  }, [incrementMonth, year, syncEffectiveDate]);

  const pctNum = parseFloat(incrementPercentage);
  const pctValid = incrementPercentage.trim() !== "" && Number.isFinite(pctNum) && pctNum > 0;

  useEffect(() => {
    if (!pctValid) {
      setPctWarning(null);
      return;
    }
    setPctWarning(pctNum > 20 ? "Increment above 20% is unusually high. Please verify before applying." : null);
  }, [pctNum, pctValid]);

  const validationError = useMemo(() => {
    if (!incrementMonth) return "Increment Month is required.";
    if (!incrementPercentage.trim()) return "Increment percentage is required.";
    if (!Number.isFinite(pctNum) || pctNum <= 0) return "Increment percentage must be greater than 0.";
    if (!effectiveStartDate) return "Effective Start Date is required.";
    if (!effectiveDateMatchesMonth(incrementMonth, effectiveStartDate)) {
      return "Effective date must be in the selected increment month.";
    }
    return null;
  }, [incrementMonth, incrementPercentage, pctNum, effectiveStartDate]);

  const loadEligible = useCallback(async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        incrementMonth,
        year,
        effectiveStartDate,
        defaultIncrementPercentage: String(pctNum),
      });
      const res = await fetch(`/api/settings/salary-increment/eligible?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Failed to load eligible employees"));
      const list: EligibleEmployee[] = (data.employees ?? []).map((e: EligibleEmployee) => ({
        ...e,
        selectedPct: String(pctNum),
      }));
      setEmployees(list);
      setPayrollWarning(data.payrollPeriodWarning ?? null);
      const nextSelected: Record<string, boolean> = {};
      for (const e of list) {
        if (!e.alreadyApplied && e.masterId) nextSelected[e.masterId] = true;
      }
      setSelected(nextSelected);
      if (list.length === 0) {
        setError("No employees found for selected increment month.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load eligible employees";
      setError(msg);
      setEmployees([]);
      showToast("error", msg);
    } finally {
      setLoading(false);
    }
  }, [incrementMonth, year, effectiveStartDate, pctNum, validationError, showToast]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const qs = new URLSearchParams({ incrementMonth, year });
      const res = await fetch(`/api/settings/salary-increment/history?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Failed to load increment history"));
      setHistory(data.increments ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [incrementMonth, year]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedEmployees = employees.filter((e) => e.masterId && selected[e.masterId] && !e.alreadyApplied);

  function previewFor(emp: EligibleEmployee) {
    const pct = parseFloat(emp.selectedPct ?? incrementPercentage);
    if (!Number.isFinite(pct) || pct <= 0) {
      return { pct: null, amount: null, newGross: null };
    }
    const newGross = calculateNewGrossBasic(emp.currentGrossBasic, pct);
    return { pct, amount: incrementAmount(emp.currentGrossBasic, pct), newGross };
  }

  async function applyIncrement(confirmPayrollOverwrite = false) {
    if (validationError) {
      setError(validationError);
      return;
    }
    if (selectedEmployees.length === 0) {
      setError("Select at least one employee.");
      return;
    }

    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/salary-increment/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incrementMonth,
          year: Number(year),
          effectiveStartDate,
          defaultIncrementPercentage: pctNum,
          confirmPayrollOverwrite,
          employees: selectedEmployees.map((e) => ({
            masterId: e.masterId,
            employeeUserId: e.employeeUserId,
            incrementPercentage: parseFloat(e.selectedPct ?? incrementPercentage) || pctNum,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = parseApiError(data, "Failed to apply increment");
        if (
          !confirmPayrollOverwrite &&
          (msg.includes("Payroll for this period already exists") ||
            data?.errors?.confirmPayrollOverwrite)
        ) {
          setConfirmOpen(true);
          setPayrollWarning(msg);
          return;
        }
        throw new Error(msg);
      }
      setConfirmOpen(false);
      showToast(
        "success",
        `Applied: ${data.applied ?? 0}, skipped: ${data.skipped ?? 0}, failed: ${data.failed ?? 0}`,
      );
      await loadEligible();
      await loadHistory();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to apply increment";
      setError(msg);
      showToast("error", msg);
    } finally {
      setApplying(false);
    }
  }

  const allSelectableIds = employees.filter((e) => !e.alreadyApplied && e.masterId).map((e) => e.masterId);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selected[id]);

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Salary Increment</h2>
          <p className="mt-1 text-sm text-slate-600">
            Apply percentage-based gross basic increments for employees by increment cycle (January or July).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Increment Month</label>
            <SelectField
              value={incrementMonth}
              onChange={(v) => setIncrementMonth(v as IncrementMonthOption)}
              options={INCREMENT_MONTH_OPTIONS.map((m) => ({ value: m, label: m }))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Year</label>
            <SelectField
              value={year}
              onChange={setYear}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Effective Start Date</label>
            <DatePickerField
              label=""
              value={effectiveStartDate}
              onChange={setEffectiveStartDate}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Increment Percentage</label>
            <Input
              type="number"
              min={0.01}
              max={100}
              step={0.1}
              value={incrementPercentage}
              onChange={(e) => setIncrementPercentage(e.target.value)}
            />
            {pctWarning ? <p className="mt-1 text-xs text-amber-700">{pctWarning}</p> : null}
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {payrollWarning ? <p className="text-sm text-amber-700">{payrollWarning}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void loadEligible()} disabled={loading}>
            {loading ? "Loading…" : "Load eligible employees"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (validationError) {
                setError(validationError);
                return;
              }
              if (selectedEmployees.length === 0) {
                setError("Select at least one employee.");
                return;
              }
              setConfirmOpen(true);
            }}
            disabled={applying || employees.length === 0}
          >
            Apply increment
          </Button>
        </div>
      </div>

      {employees.length > 0 ? (
        <div className="card overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Eligible employees</h3>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const next: Record<string, boolean> = {};
                  for (const id of allSelectableIds) next[id] = checked;
                  setSelected(next);
                }}
              />
              Select all
            </label>
          </div>
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Select</th>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Designation</th>
                <th className="px-2 py-2">Department</th>
                <th className="px-2 py-2 text-right">Current Gross Basic</th>
                <th className="px-2 py-2 text-right">Increment %</th>
                <th className="px-2 py-2 text-right">New Gross Basic</th>
                <th className="px-2 py-2">Effective Date</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const preview = previewFor(emp);
                const disabled = emp.alreadyApplied;
                return (
                  <tr
                    key={emp.masterId}
                    className={cn("border-b border-slate-100", disabled && "bg-slate-50 text-slate-500")}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={Boolean(emp.masterId && selected[emp.masterId])}
                        onChange={(e) => {
                          if (!emp.masterId) return;
                          setSelected((s) => ({ ...s, [emp.masterId]: e.target.checked }));
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{emp.employeeCode ?? "—"}</td>
                    <td className="px-2 py-2">{emp.name ?? "—"}</td>
                    <td className="px-2 py-2">{emp.designation ?? "—"}</td>
                    <td className="px-2 py-2">{emp.department ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{fmt(emp.currentGrossBasic)}</td>
                    <td className="px-2 py-2 text-right">
                      {disabled ? (
                        "—"
                      ) : (
                        <Input
                          className="!w-20 text-right"
                          type="number"
                          min={0.01}
                          step={0.1}
                          value={emp.selectedPct ?? incrementPercentage}
                          onChange={(e) => {
                            setEmployees((rows) =>
                              rows.map((r) =>
                                r.masterId === emp.masterId ? { ...r, selectedPct: e.target.value } : r,
                              ),
                            );
                          }}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-medium">{fmt(preview.newGross)}</td>
                    <td className="px-2 py-2">{emp.effectiveStartDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {employees.some((e) => e.alreadyApplied) ? (
            <p className="mt-2 text-xs text-slate-500">
              Rows with an existing increment for this effective date cannot be selected again.
            </p>
          ) : null}
        </div>
      ) : (
        !loading && <EmptyState title="No eligible employees loaded" description="Choose month and year, then load eligible employees." />
      )}

      <div className="card overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Increment history</h3>
        {historyLoading ? (
          <p className="text-sm text-slate-500">Loading history…</p>
        ) : history.length === 0 ? (
          <EmptyState title="No increment history" description="Applied increments for the selected filters will appear here." />
        ) : (
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Month</th>
                <th className="px-2 py-2">Effective</th>
                <th className="px-2 py-2 text-right">Old Gross</th>
                <th className="px-2 py-2 text-right">%</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right">New Gross</th>
                <th className="px-2 py-2">Applied</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-mono text-xs">{h.employeeCode ?? "—"}</td>
                  <td className="px-2 py-2">{h.incrementMonth}</td>
                  <td className="px-2 py-2">{h.effectiveStartDate ?? "—"}</td>
                  <td className="px-2 py-2 text-right">{fmt(h.oldGrossBasic)}</td>
                  <td className="px-2 py-2 text-right">{h.incrementPercentage}</td>
                  <td className="px-2 py-2 text-right">{fmt(h.incrementAmount)}</td>
                  <td className="px-2 py-2 text-right">{fmt(h.newGrossBasic)}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{h.appliedAt?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Confirm salary increment</h3>
            <p className="mt-2 text-sm text-slate-600">
              Apply {pctNum}% salary increment to {selectedEmployees.length} employee
              {selectedEmployees.length === 1 ? "" : "s"} effective {effectiveStartDate}?
            </p>
            {payrollWarning ? <p className="mt-2 text-sm text-amber-700">{payrollWarning}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void applyIncrement(Boolean(payrollWarning))}
                disabled={applying}
              >
                {applying ? "Applying…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
