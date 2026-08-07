"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatNightAllowanceSlabLabel, DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING } from "@/lib/nightAllowanceCalculation";
import { payLevelSelectOptions } from "@/lib/payLevel";
import { SelectField } from "@/components/ui/SelectField";

export type NightAllowanceRateRecord = {
  id: string;
  slabNo: number;
  payLevel: number;
  ratePerHour: number;
  effectiveFrom?: string | null;
  isActive: boolean;
  label?: string;
};

type RateForm = {
  slabNo: string;
  payLevel: string;
  ratePerHour: string;
  effectiveFrom: string;
};

const emptyForm = (): RateForm => ({
  slabNo: "",
  payLevel: "",
  ratePerHour: "",
  effectiveFrom: "",
});

function validateRateForm(
  form: RateForm,
  rates: NightAllowanceRateRecord[],
  editing: NightAllowanceRateRecord | null,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const slabNo = parseInt(form.slabNo, 10);
  if (!form.slabNo.trim() || !Number.isInteger(slabNo) || slabNo < 1) {
    errors.slabNo = "Slab No is required.";
  } else {
    const duplicate = rates.some(
      (r) => r.slabNo === slabNo && (!editing || r.id !== editing.id),
    );
    if (duplicate) {
      errors.slabNo = "Slab number already exists.";
    }
  }

  const payLevel = parseInt(form.payLevel, 10);
  if (!form.payLevel.trim() || payLevel < 1 || payLevel > 18) {
    errors.payLevel = "Please select a valid Pay Level.";
  }

  const rate = Number(form.ratePerHour);
  if (!form.ratePerHour.trim() || !Number.isFinite(rate) || rate < 0) {
    errors.ratePerHour = "Rate per hour is required.";
  }

  return errors;
}

export function NightAllowanceSettings() {
  const [rates, setRates] = useState<NightAllowanceRateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NightAllowanceRateRecord | null>(null);
  const [form, setForm] = useState<RateForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<NightAllowanceRateRecord | null>(null);
  const [basicPayCeiling, setBasicPayCeiling] = useState(String(DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING));
  const [ceilingSaving, setCeilingSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratesRes, calcRes] = await Promise.all([
        fetch("/api/settings/night-allowance-rates"),
        fetch("/api/settings/payroll-calculation-settings"),
      ]);
      const data = await ratesRes.json().catch(() => ({}));
      const calcData = await calcRes.json().catch(() => ({}));
      if (!ratesRes.ok) throw new Error(data.error || data.message || "Failed to load night allowance rates");
      setRates((data.rates ?? []) as NightAllowanceRateRecord[]);
      const cs = calcData.calculationSettings ?? {};
      setBasicPayCeiling(String(cs.nightAllowanceBasicCeiling ?? DEFAULT_NIGHT_ALLOWANCE_BASIC_CEILING));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load night allowance rates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setFormErrors({});
    setFormOpen(true);
  }

  function openEdit(rate: NightAllowanceRateRecord) {
    setEditing(rate);
    setForm({
      slabNo: String(rate.slabNo),
      payLevel: String(rate.payLevel),
      ratePerHour: String(rate.ratePerHour),
      effectiveFrom: rate.effectiveFrom?.slice(0, 10) ?? "",
    });
    setFormErrors({});
    setFormOpen(true);
  }

  const rateFormValidation = useMemo(
    () => validateRateForm(form, rates, editing),
    [form, rates, editing],
  );

  const rateFormValid = Object.keys(rateFormValidation).length === 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateRateForm(form, rates, editing);
    setFormErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = {
        slabNo: Number(form.slabNo),
        payLevel: Number(form.payLevel),
        ratePerHour: Number(form.ratePerHour),
        effectiveFrom: form.effectiveFrom.trim() || null,
        isActive: true,
      };
      const res = await fetch(
        editing ? `/api/settings/night-allowance-rates/${editing.id}` : "/api/settings/night-allowance-rates",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Save failed");
      setFormOpen(false);
      setFormErrors({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(rate: NightAllowanceRateRecord) {
    setError(null);
    const res = await fetch(`/api/settings/night-allowance-rates/${rate.id}/deactivate`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || data.error || "Deactivate failed");
      return;
    }
    setDeactivateTarget(null);
    await load();
  }

  async function saveCeiling(e: React.FormEvent) {
    e.preventDefault();
    setCeilingSaving(true);
    setError(null);
    try {
      const ceiling = Number(basicPayCeiling);
      if (!Number.isFinite(ceiling) || ceiling < 0) {
        throw new Error("Night allowance basic pay ceiling must be ≥ 0.");
      }
      const calcRes = await fetch("/api/settings/payroll-calculation-settings");
      const calcData = await calcRes.json().catch(() => ({}));
      if (!calcRes.ok) throw new Error(calcData.error || calcData.message || "Failed to load calculation settings");
      const cs = calcData.calculationSettings ?? {};
      const res = await fetch("/api/settings/payroll-calculation-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpfPercentage: cs.cpfPercentage ?? 12,
          cpfBasisFieldKeys: cs.cpfBasisFieldKeys ?? [],
          cpfCalculationMode: cs.cpfCalculationMode ?? "percentage",
          cpfFixedAmount: cs.cpfFixedAmount ?? 0,
          electricityUnitRate: cs.electricityUnitRate ?? 0,
          nightAllowanceBasicCeiling: ceiling,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || "Save failed");
      setBasicPayCeiling(String(data.calculationSettings?.nightAllowanceBasicCeiling ?? ceiling));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setCeilingSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <form onSubmit={saveCeiling} className="flex flex-wrap items-end gap-3">
          <FormField label="Night Allowance Basic Pay Ceiling (₹)" className="min-w-[220px] flex-1">
            <Input
              type="number"
              min={0}
              step="1"
              value={basicPayCeiling}
              onChange={(e) => setBasicPayCeiling(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={ceilingSaving}>
            {ceilingSaving ? "Saving…" : "Save ceiling"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-600">
          Night Duty Allowance is payable only when monthly Basic Pay is at or below this ceiling (default ₹43,600).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Night Allowance</h2>
          <p className="text-sm text-slate-600">
            Manage pay-level wise hourly night allowance rates. Slab numbers must be unique.
          </p>
        </div>
        <Button onClick={openAdd}>Add Rate</Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <AppPageLoader variant="inline" message="Loading settings..." submessage="" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">S.No</th>
                <th className="px-2 py-2">Pay Level</th>
                <th className="px-2 py-2 text-right">Allowance Rate / Hour</th>
                <th className="px-2 py-2">Effective From</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium">{rate.slabNo}</td>
                  <td className="px-2 py-2">Level {rate.payLevel}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    ₹{rate.ratePerHour.toFixed(2)}
                  </td>
                  <td className="px-2 py-2">{rate.effectiveFrom ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Badge tone={rate.isActive ? "success" : "neutral"}>
                      {rate.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(rate)}>
                        Edit
                      </Button>
                      {rate.isActive ? (
                        <Button variant="outline" size="sm" onClick={() => setDeactivateTarget(rate)}>
                          Deactivate
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                    No night allowance rates configured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Edit Night Allowance Rate" : "Add Night Allowance Rate"}>
        <form onSubmit={handleSave} className="space-y-4">
          <FormField label="Slab No" required error={formErrors.slabNo}>
            <Input
              type="number"
              min={1}
              step={1}
              value={form.slabNo}
              onChange={(e) => {
                setForm((f) => ({ ...f, slabNo: e.target.value }));
                setFormErrors((prev) => {
                  const next = { ...prev };
                  delete next.slabNo;
                  return next;
                });
              }}
              required
            />
          </FormField>
          <FormField label="Pay Level" required error={formErrors.payLevel}>
            <SelectField
              value={form.payLevel}
              onChange={(v) => {
                setForm((f) => ({ ...f, payLevel: v }));
                setFormErrors((prev) => {
                  const next = { ...prev };
                  delete next.payLevel;
                  return next;
                });
              }}
              options={payLevelSelectOptions()}
              placeholder="Select pay level"
              error={formErrors.payLevel}
              required
            />
          </FormField>
          <FormField label="Rate Per Hour (₹)" required error={formErrors.ratePerHour}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.ratePerHour}
              onChange={(e) => {
                setForm((f) => ({ ...f, ratePerHour: e.target.value }));
                setFormErrors((prev) => {
                  const next = { ...prev };
                  delete next.ratePerHour;
                  return next;
                });
              }}
              required
            />
          </FormField>
          <FormField label="Effective From">
            <Input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
            />
          </FormField>
          {form.slabNo && form.payLevel && form.ratePerHour ? (
            <p className="text-xs text-slate-600">
              Preview:{" "}
              {formatNightAllowanceSlabLabel(
                Number(form.slabNo) || 0,
                Number(form.payLevel) || 0,
                Number(form.ratePerHour) || 0,
              )}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !rateFormValid}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget != null}
        title="Deactivate rate?"
        message={`Deactivate slab ${deactivateTarget?.slabNo} (Level ${deactivateTarget?.payLevel})?`}
        confirmText="Deactivate"
        variant="danger"
        onConfirm={() => deactivateTarget && void deactivate(deactivateTarget)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
