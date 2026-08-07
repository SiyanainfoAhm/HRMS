"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { CpfCalculationSettingsForm } from "@/components/payroll/CpfCalculationSettingsForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import {
  CALCULATION_TYPES,
  earningFieldsForCpfBasis,
  FIELD_GROUPS,
  FIELD_TYPES,
  fieldKeyFromLabel,
  RETIRED_PAYROLL_FIELD_KEYS,
  type PayrollFieldDefinition,
  type PayrollFieldGroup,
} from "@/lib/payrollFieldTypes";

type PanelTab = "fields" | "calculation";

type FieldFormState = {
  id?: string;
  fieldLabel: string;
  fieldKey: string;
  fieldGroup: PayrollFieldGroup;
  fieldType: string;
  calculationType: string;
  defaultValue: string;
  dropdownOptions: string;
  isRequired: boolean;
  showInPayrollMaster: boolean;
  showInRunPayroll: boolean;
  showInSalarySlip: boolean;
  includeInTotalEarnings: boolean;
  includeInTotalDeductions: boolean;
  isActive: boolean;
  displayOrder: string;
  isSystem: boolean;
};

const emptyFieldForm = (): FieldFormState => ({
  fieldLabel: "",
  fieldKey: "",
  fieldGroup: "earnings",
  fieldType: "number",
  calculationType: "manual_entry",
  defaultValue: "",
  dropdownOptions: "",
  isRequired: false,
  showInPayrollMaster: true,
  showInRunPayroll: true,
  showInSalarySlip: true,
  includeInTotalEarnings: true,
  includeInTotalDeductions: true,
  isActive: true,
  displayOrder: "100",
  isSystem: false,
});

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

function fieldFromApi(f: PayrollFieldDefinition): FieldFormState {
  return {
    id: f.id,
    fieldLabel: f.fieldLabel,
    fieldKey: f.fieldKey,
    fieldGroup: (f.fieldGroup as PayrollFieldGroup) || "earnings",
    fieldType: f.fieldType,
    calculationType: f.calculationType || "manual_entry",
    defaultValue: f.defaultValue ?? "",
    dropdownOptions: (f.dropdownOptions ?? []).join(", "),
    isRequired: f.isRequired,
    showInPayrollMaster: f.showInPayrollMaster,
    showInRunPayroll: f.showInRunPayroll,
    showInSalarySlip: f.showInSalarySlip,
    includeInTotalEarnings: f.includeInTotalEarnings,
    includeInTotalDeductions: f.includeInTotalDeductions,
    isActive: f.isActive,
    displayOrder: String(f.displayOrder ?? 0),
    isSystem: f.isSystem,
  };
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-slate-700", disabled && "opacity-60")}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function PayrollConfigurationSettings() {
  const { showToast } = useToast();
  const [panelTab, setPanelTab] = useState<PanelTab>("fields");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<PayrollFieldDefinition[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FieldFormState>(emptyFieldForm());
  const [saving, setSaving] = useState(false);
  const [cpfPercentage, setCpfPercentage] = useState("12");
  const [cpfBasisKeys, setCpfBasisKeys] = useState<string[]>([]);
  const [cpfCalculationMode, setCpfCalculationMode] = useState<"percentage" | "fixed_amount">("percentage");
  const [cpfFixedAmount, setCpfFixedAmount] = useState("0");
  const [electricityUnitRate, setElectricityUnitRate] = useState("0");
  const [nightAllowanceBasicCeiling, setNightAllowanceBasicCeiling] = useState("43600");
  const [cpfSaving, setCpfSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PayrollFieldDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [fieldsRes, cpfRes] = await Promise.all([
        fetch("/api/settings/payroll-fields?active_only=0"),
        fetch("/api/settings/payroll-calculation-settings"),
      ]);
      const fieldsData = await fieldsRes.json();
      const cpfData = await cpfRes.json();
      if (!fieldsRes.ok) throw new Error(parseApiError(fieldsData, "Failed to load payroll fields"));
      if (!cpfRes.ok) throw new Error(parseApiError(cpfData, "Failed to load CPF settings"));
      const list = (fieldsData.fields ?? []) as PayrollFieldDefinition[];
      setFields(list);
      const cs = cpfData.calculationSettings ?? {};
      setCpfPercentage(String(cs.cpfPercentage ?? 12));
      setCpfBasisKeys(Array.isArray(cs.cpfBasisFieldKeys) ? cs.cpfBasisFieldKeys : []);
      setCpfCalculationMode(cs.cpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage");
      setCpfFixedAmount(String(cs.cpfFixedAmount ?? 0));
      setElectricityUnitRate(String(cs.electricityUnitRate ?? 0));
      setNightAllowanceBasicCeiling(String(cs.nightAllowanceBasicCeiling ?? 43600));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Load failed";
      setLoadError(msg);
      showToast("error", msg);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const earningFields = useMemo(() => earningFieldsForCpfBasis(fields), [fields]);

  const filteredFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fields.filter((f) => {
      if (RETIRED_PAYROLL_FIELD_KEYS.has(f.fieldKey)) return false;
      if (groupFilter !== "all" && f.fieldGroup !== groupFilter) return false;
      if (!q) return true;
      return (
        f.fieldLabel.toLowerCase().includes(q) ||
        f.fieldKey.toLowerCase().includes(q) ||
        String(f.fieldGroup).toLowerCase().includes(q)
      );
    });
  }, [fields, groupFilter, search]);

  const groupLabel = (g: string) => FIELD_GROUPS.find((x) => x.value === g)?.label ?? g;

  function openAdd() {
    setForm(emptyFieldForm());
    setDialogOpen(true);
  }

  function openEdit(f: PayrollFieldDefinition) {
    setForm(fieldFromApi(f));
    setDialogOpen(true);
  }

  async function saveField() {
    if (!form.fieldLabel.trim()) {
      showToast("error", "Field label is required.");
      return;
    }
    const fieldKey = form.fieldKey.trim() || fieldKeyFromLabel(form.fieldLabel);
    const payload = {
      fieldLabel: form.fieldLabel.trim(),
      fieldKey,
      fieldGroup: form.fieldGroup,
      fieldType: form.fieldType,
      calculationType: form.calculationType,
      defaultValue: form.defaultValue || null,
      dropdownOptions:
        form.fieldType === "dropdown"
          ? form.dropdownOptions
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      isRequired: form.isRequired,
      showInPayrollMaster: form.showInPayrollMaster,
      showInRunPayroll: form.showInRunPayroll,
      showInSalarySlip: form.showInSalarySlip,
      includeInTotalEarnings: form.fieldGroup === "earnings" ? form.includeInTotalEarnings : false,
      includeInTotalDeductions: form.fieldGroup === "deductions" ? form.includeInTotalDeductions : false,
      isActive: form.isActive,
      displayOrder: parseInt(form.displayOrder, 10) || 0,
    };

    setSaving(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch(
        isEdit ? "/api/settings/payroll-fields/update" : "/api/settings/payroll-fields",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isEdit ? { id: form.id, ...payload } : payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Save failed"));
      showToast("success", isEdit ? "Field updated" : "Field created");
      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateField(id: string) {
    try {
      const res = await fetch("/api/settings/payroll-fields/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Deactivate failed"));
      showToast("success", "Field deactivated");
      await load();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Deactivate failed");
    }
  }

  async function confirmDeleteField() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/settings/payroll-fields/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Delete failed"));
      showToast("success", `"${deleteTarget.fieldLabel}" deleted`);
      setDeleteTarget(null);
      await load();
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function saveCpfSettings() {
    const pct = parseFloat(cpfPercentage);
    const fixed = parseFloat(cpfFixedAmount);
    const elecRate = parseFloat(electricityUnitRate);
    const nightCeiling = parseFloat(nightAllowanceBasicCeiling);
    if (!Number.isFinite(pct) || pct < 0) {
      showToast("error", "CPF percentage must be a number ≥ 0.");
      return;
    }
    if (cpfCalculationMode === "percentage" && cpfBasisKeys.length === 0) {
      showToast("error", "Select at least one earning field for PF/CPF calculation.");
      return;
    }
    if (cpfCalculationMode === "fixed_amount" && (!Number.isFinite(fixed) || fixed < 0)) {
      showToast("error", "Fixed CPF amount must be ≥ 0.");
      return;
    }
    if (!Number.isFinite(elecRate) || elecRate < 0) {
      showToast("error", "Electricity unit rate must be ≥ 0.");
      return;
    }
    if (!Number.isFinite(nightCeiling) || nightCeiling < 0) {
      showToast("error", "Night allowance basic pay ceiling must be ≥ 0.");
      return;
    }
    setCpfSaving(true);
    try {
      const res = await fetch("/api/settings/payroll-calculation-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpfPercentage: pct,
          cpfBasisFieldKeys: cpfBasisKeys,
          cpfCalculationMode,
          cpfFixedAmount: fixed,
          electricityUnitRate: elecRate,
          nightAllowanceBasicCeiling: nightCeiling,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Save failed"));
      showToast("success", "Institute payroll calculation defaults saved");
      const cs = data.calculationSettings ?? {};
      setCpfPercentage(String(cs.cpfPercentage ?? pct));
      setCpfBasisKeys(cs.cpfBasisFieldKeys ?? cpfBasisKeys);
      setCpfCalculationMode(cs.cpfCalculationMode === "fixed_amount" ? "fixed_amount" : "percentage");
      setCpfFixedAmount(String(cs.cpfFixedAmount ?? fixed));
      setElectricityUnitRate(String(cs.electricityUnitRate ?? elecRate));
      setNightAllowanceBasicCeiling(String(cs.nightAllowanceBasicCeiling ?? nightCeiling));
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setCpfSaving(false);
    }
  }

  function toggleBasisKey(key: string) {
    setCpfBasisKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const tabBtn = (id: PanelTab, label: string) => (
    <button
      type="button"
      onClick={() => setPanelTab(id)}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
        panelTab === id
          ? "bg-brand-navy text-white shadow-sm"
          : "border border-brand-border bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-border bg-white p-4 shadow-card sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Payroll configuration</h2>
            <p className="mt-1 text-sm text-slate-600">
              Manage dynamic payroll fields and institute-wide PF/CPF defaults. Employees can override CPF on their My
              Pay page when needed.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-100 pb-4">
          {tabBtn("fields", "Payroll fields")}
          {tabBtn("calculation", "Payroll calculation")}
        </div>

        {loadError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">Could not load payroll configuration</p>
            <p className="mt-1">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}

        {panelTab === "fields" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">Define earnings, deductions, statutory, and bank fields.</p>
              <Button size="sm" onClick={openAdd}>
                Add field
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Search" className="min-w-[200px] flex-1 sm:max-w-xs">
                <Input
                  placeholder="Label or key…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </FormField>
              <SelectField
                label="Group"
                value={groupFilter}
                onChange={setGroupFilter}
                className="min-w-[180px]"
                options={[
                  { value: "all", label: "All groups" },
                  ...FIELD_GROUPS.map((g) => ({ value: g.value, label: g.label })),
                ]}
              />
            </div>

            {loading ? (
              <AppPageLoader variant="inline" message="Loading settings..." submessage="" />
            ) : filteredFields.length === 0 ? (
              <EmptyState
                title="No payroll fields"
                description="Add a field or adjust your filters. Run database migration if this is a new install."
                action={
                  <Button size="sm" onClick={openAdd}>
                    Add field
                  </Button>
                }
              />
            ) : (
              <div className="table-shell overflow-x-auto">
                <table className="table-modern w-full min-w-[960px]">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Key</th>
                      <th>Group</th>
                      <th>Type</th>
                      <th>Calc</th>
                      <th>Req</th>
                      <th>Master</th>
                      <th>Run</th>
                      <th>Slip</th>
                      <th>Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFields.map((f) => (
                      <tr key={f.id}>
                        <td className="font-medium">
                          {f.fieldLabel}
                          {f.isSystem ? (
                            <Badge tone="neutral" className="ml-1 normal-case">
                              System
                            </Badge>
                          ) : null}
                        </td>
                        <td className="font-mono text-xs text-slate-600">{f.fieldKey}</td>
                        <td>{groupLabel(f.fieldGroup)}</td>
                        <td>{f.fieldType}</td>
                        <td>{(f.calculationType || "manual_entry").replace(/_/g, " ")}</td>
                        <td>{f.isRequired ? "Yes" : "—"}</td>
                        <td>{f.showInPayrollMaster ? "Yes" : "—"}</td>
                        <td>{f.showInRunPayroll ? "Yes" : "—"}</td>
                        <td>{f.showInSalarySlip ? "Yes" : "—"}</td>
                        <td>
                          <Badge tone={f.isActive ? "success" : "neutral"} className="normal-case">
                            {f.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
                              Edit
                            </Button>
                            {!f.isSystem && f.isActive ? (
                              <Button size="sm" variant="outline" onClick={() => deactivateField(f.id)}>
                                Deactivate
                              </Button>
                            ) : null}
                            {!f.isSystem ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="!text-red-700 hover:!bg-red-50"
                                onClick={() => setDeleteTarget(f)}
                              >
                                Delete
                              </Button>
                            ) : f.isActive ? (
                              <Button size="sm" variant="outline" onClick={() => deactivateField(f.id)}>
                                Deactivate
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Institute-wide payroll calculation defaults (CPF and electricity). Per-employee overrides are set in Payroll Master.
            </p>

            {loading ? (
              <AppPageLoader variant="inline" message="Loading settings..." submessage="" />
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h4 className="text-sm font-semibold text-slate-800">Electricity unit rate</h4>
                  <p className="mt-1 text-xs text-slate-600">
                    Used in Run Payroll: Electricity deduction = units consumed × this rate. Admins can still override the amount per employee per month.
                  </p>
                  <div className="mt-3 max-w-xs">
                    <FormField label="Electricity unit rate (₹)" htmlFor="institute-electricity-rate">
                      <Input
                        id="institute-electricity-rate"
                        type="number"
                        min={0}
                        step="0.01"
                        value={electricityUnitRate}
                        onChange={(e) => setElectricityUnitRate(e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h4 className="text-sm font-semibold text-slate-800">Night allowance basic pay ceiling</h4>
                  <p className="mt-1 text-xs text-slate-600">
                    Night Duty Allowance is payable only when monthly Basic Pay is at or below this ceiling. Above the ceiling, night allowance is ₹0.
                  </p>
                  <div className="mt-3 max-w-xs">
                    <FormField label="Basic pay ceiling (₹)" htmlFor="institute-night-ceiling">
                      <Input
                        id="institute-night-ceiling"
                        type="number"
                        min={0}
                        step="1"
                        value={nightAllowanceBasicCeiling}
                        onChange={(e) => setNightAllowanceBasicCeiling(e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>

                <CpfCalculationSettingsForm
                  earningFields={earningFields}
                  cpfPercentage={cpfPercentage}
                  cpfBasisKeys={cpfBasisKeys}
                  cpfCalculationMode={cpfCalculationMode}
                  cpfFixedAmount={cpfFixedAmount}
                  onCpfPercentageChange={setCpfPercentage}
                  onToggleBasisKey={toggleBasisKey}
                  onCpfCalculationModeChange={setCpfCalculationMode}
                  onCpfFixedAmountChange={setCpfFixedAmount}
                  idPrefix="company-cpf"
                />
              </>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <Button size="sm" onClick={saveCpfSettings} loading={cpfSaving} disabled={cpfSaving || loading}>
                Save payroll calculation settings
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={form.id ? "Edit payroll field" : "Add payroll field"}
        size="lg"
      >
        <div className="space-y-3">
          <FormField label="Field label">
            <Input
              value={form.fieldLabel}
              disabled={form.isSystem}
              onChange={(e) => {
                const label = e.target.value;
                setForm((f) => ({
                  ...f,
                  fieldLabel: label,
                  fieldKey: f.id || f.isSystem ? f.fieldKey : fieldKeyFromLabel(label),
                }));
              }}
            />
          </FormField>
          <FormField label="Field key / code">
            <Input
              value={form.fieldKey}
              disabled={form.isSystem || Boolean(form.id)}
              onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value }))}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Field group"
              value={form.fieldGroup}
              disabled={form.isSystem}
              onChange={(v) => setForm((f) => ({ ...f, fieldGroup: v as PayrollFieldGroup }))}
              options={FIELD_GROUPS.map((g) => ({ value: g.value, label: g.label }))}
            />
            <SelectField
              label="Field type"
              value={form.fieldType}
              disabled={form.isSystem && Boolean(form.id)}
              onChange={(v) => setForm((f) => ({ ...f, fieldType: v }))}
              options={FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <SelectField
            label="Calculation type"
            value={form.calculationType}
            disabled={form.isSystem}
            onChange={(v) => setForm((f) => ({ ...f, calculationType: v }))}
            options={CALCULATION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <FormField label="Default value (optional)">
            <Input
              value={form.defaultValue}
              onChange={(e) => setForm((f) => ({ ...f, defaultValue: e.target.value }))}
            />
          </FormField>
          {form.fieldType === "dropdown" ? (
            <FormField label="Dropdown options (comma-separated)">
              <Input
                value={form.dropdownOptions}
                onChange={(e) => setForm((f) => ({ ...f, dropdownOptions: e.target.value }))}
              />
            </FormField>
          ) : null}
          <FormField label="Display order">
            <Input
              type="number"
              value={form.displayOrder}
              onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
            />
          </FormField>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="Required" checked={form.isRequired} onChange={(v) => setForm((f) => ({ ...f, isRequired: v }))} />
            <Toggle
              label="Show in Payroll Master"
              checked={form.showInPayrollMaster}
              onChange={(v) => setForm((f) => ({ ...f, showInPayrollMaster: v }))}
            />
            <Toggle
              label="Show in Run Payroll"
              checked={form.showInRunPayroll}
              onChange={(v) => setForm((f) => ({ ...f, showInRunPayroll: v }))}
            />
            <Toggle
              label="Show in Salary Slip"
              checked={form.showInSalarySlip}
              onChange={(v) => setForm((f) => ({ ...f, showInSalarySlip: v }))}
            />
            {form.fieldGroup === "earnings" ? (
              <Toggle
                label="Include in total earnings"
                checked={form.includeInTotalEarnings}
                onChange={(v) => setForm((f) => ({ ...f, includeInTotalEarnings: v }))}
              />
            ) : null}
            {form.fieldGroup === "deductions" ? (
              <Toggle
                label="Include in total deductions"
                checked={form.includeInTotalDeductions}
                onChange={(v) => setForm((f) => ({ ...f, includeInTotalDeductions: v }))}
              />
            ) : null}
            <Toggle
              label="Active"
              checked={form.isActive}
              onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              disabled={form.isSystem}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveField} loading={saving} disabled={saving}>
              Save field
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete payroll field?"
        message={
          deleteTarget
            ? `Permanently delete "${deleteTarget.fieldLabel}" (${deleteTarget.fieldKey})? Saved values on employee payroll records will be removed. This cannot be undone.`
            : ""
        }
        confirmText="Delete field"
        cancelText="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={() => void confirmDeleteField()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
