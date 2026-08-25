"use client";

import { useCallback, useEffect, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
  validateElectricitySlabs,
  type ElectricityTariffConfig,
  type ElectricityTariffSlab,
} from "@/lib/electricityTariffCalculation";

export type ElectricityTariffRecord = ElectricityTariffConfig & {
  id: string;
  isActive: boolean;
};

type SlabForm = { fromUnit: string; toUnit: string; ratePerUnit: string };

type TariffForm = {
  effectiveFrom: string;
  sthirAakar: string;
  vahanAakarPerUnit: string;
  fuelCharge: string;
  dutyPercentage: string;
  slabs: SlabForm[];
};

function emptySlab(): SlabForm {
  return { fromUnit: "", toUnit: "", ratePerUnit: "" };
}

function defaultForm(): TariffForm {
  const t = DEFAULT_APRIL_2026_ELECTRICITY_TARIFF;
  return {
    effectiveFrom: t.effectiveFrom ?? "2026-04-01",
    sthirAakar: String(t.sthirAakar),
    vahanAakarPerUnit: String(t.vahanAakarPerUnit),
    fuelCharge: String(t.fuelCharge),
    dutyPercentage: String(t.dutyPercentage),
    slabs: t.slabs.map((s) => ({
      fromUnit: String(s.fromUnit),
      toUnit: s.toUnit === null ? "" : String(s.toUnit),
      ratePerUnit: String(s.ratePerUnit),
    })),
  };
}

function parseSlabs(forms: SlabForm[]): ElectricityTariffSlab[] {
  return forms.map((s, i) => ({
    fromUnit: Number(s.fromUnit) || 0,
    toUnit: s.toUnit.trim() === "" ? null : Number(s.toUnit),
    ratePerUnit: Number(s.ratePerUnit) || 0,
    sortOrder: i + 1,
  }));
}

export function ElectricityTariffSettings() {
  const [tariffs, setTariffs] = useState<ElectricityTariffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ElectricityTariffRecord | null>(null);
  const [form, setForm] = useState<TariffForm>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<ElectricityTariffRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/electricity-tariffs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Failed to load electricity tariffs");
      setTariffs((data.tariffs ?? []) as ElectricityTariffRecord[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load electricity tariffs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(defaultForm());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(t: ElectricityTariffRecord) {
    setEditing(t);
    setForm({
      effectiveFrom: t.effectiveFrom ?? "",
      sthirAakar: String(t.sthirAakar ?? 0),
      vahanAakarPerUnit: String(t.vahanAakarPerUnit ?? 0),
      fuelCharge: String(t.fuelCharge ?? 0),
      dutyPercentage: String(t.dutyPercentage ?? 0),
      slabs: (t.slabs ?? []).map((s) => ({
        fromUnit: String(s.fromUnit),
        toUnit: s.toUnit === null || s.toUnit === undefined ? "" : String(s.toUnit),
        ratePerUnit: String(s.ratePerUnit),
      })),
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function save() {
    setFormError(null);
    const slabs = parseSlabs(form.slabs);
    const slabErrors = validateElectricitySlabs(slabs);
    if (slabErrors.length) {
      setFormError(slabErrors[0]);
      return;
    }
    const sthir = Number(form.sthirAakar);
    const vahan = Number(form.vahanAakarPerUnit);
    const fuel = Number(form.fuelCharge);
    const duty = Number(form.dutyPercentage);
    if (!form.effectiveFrom.trim()) {
      setFormError("Effective from date is required.");
      return;
    }
    if ([sthir, vahan, fuel, duty].some((n) => !Number.isFinite(n) || n < 0)) {
      setFormError("Charges and duty must be >= 0.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        effectiveFrom: form.effectiveFrom,
        sthirAakar: sthir,
        vahanAakarPerUnit: vahan,
        fuelCharge: fuel,
        dutyPercentage: duty,
        isActive: true,
        slabs,
      };
      const res = await fetch(
        editing ? `/api/settings/electricity-tariffs/${editing.id}` : "/api/settings/electricity-tariffs",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || data.errors?.slabs?.[0] || "Save failed");
      }
      setFormOpen(false);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(t: ElectricityTariffRecord) {
    const res = await fetch(`/api/settings/electricity-tariffs/${t.id}/deactivate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Deactivate failed");
      return;
    }
    setDeactivateTarget(null);
    await load();
  }

  if (loading) {
    return <AppPageLoader variant="inline" message="Loading electricity tariffs..." submessage="" />;
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Electricity Charges Settings</h2>
          <p className="mt-1 text-sm text-slate-600">
            Effective-dated progressive tariffs (Sthir Aakar, slabs, Vahan Aakar, Fuel, Duty %). Historical payroll keeps
            its stored snapshot.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          Add tariff
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Effective from</th>
              <th className="px-2 py-2">Sthir</th>
              <th className="px-2 py-2">Vahan /u</th>
              <th className="px-2 py-2">Fuel</th>
              <th className="px-2 py-2">Duty %</th>
              <th className="px-2 py-2">Slabs</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {tariffs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                  No electricity tariffs configured yet.
                </td>
              </tr>
            ) : (
              tariffs.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium">{t.effectiveFrom}</td>
                  <td className="px-2 py-2 tabular-nums">{t.sthirAakar}</td>
                  <td className="px-2 py-2 tabular-nums">{t.vahanAakarPerUnit}</td>
                  <td className="px-2 py-2 tabular-nums">{t.fuelCharge}</td>
                  <td className="px-2 py-2 tabular-nums">{t.dutyPercentage}</td>
                  <td className="px-2 py-2">{t.slabs?.length ?? 0}</td>
                  <td className="px-2 py-2">
                    <Badge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button type="button" size="sm" variant="outline" className="mr-1" onClick={() => openEdit(t)}>
                      Edit
                    </Button>
                    {t.isActive ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => setDeactivateTarget(t)}>
                        Deactivate
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editing ? "Edit electricity tariff" : "Add electricity tariff"}
        size="lg"
        footer={
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          <FormField label="Effective from">
            <Input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField label="Sthir Aakar">
              <Input
                value={form.sthirAakar}
                onChange={(e) => setForm((f) => ({ ...f, sthirAakar: e.target.value }))}
              />
            </FormField>
            <FormField label="Vahan Aakar / unit">
              <Input
                value={form.vahanAakarPerUnit}
                onChange={(e) => setForm((f) => ({ ...f, vahanAakarPerUnit: e.target.value }))}
              />
            </FormField>
            <FormField label="Fuel Charges">
              <Input
                value={form.fuelCharge}
                onChange={(e) => setForm((f) => ({ ...f, fuelCharge: e.target.value }))}
              />
            </FormField>
            <FormField label="Duty %">
              <Input
                value={form.dutyPercentage}
                onChange={(e) => setForm((f) => ({ ...f, dutyPercentage: e.target.value }))}
              />
            </FormField>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">Unit slabs</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setForm((f) => ({ ...f, slabs: [...f.slabs, emptySlab()] }))}
              >
                Add slab
              </Button>
            </div>
            <div className="space-y-2">
              {form.slabs.map((s, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <Input
                    placeholder="From"
                    value={s.fromUnit}
                    onChange={(e) =>
                      setForm((f) => {
                        const slabs = [...f.slabs];
                        slabs[idx] = { ...slabs[idx], fromUnit: e.target.value };
                        return { ...f, slabs };
                      })
                    }
                  />
                  <Input
                    placeholder="To (blank = ∞)"
                    value={s.toUnit}
                    onChange={(e) =>
                      setForm((f) => {
                        const slabs = [...f.slabs];
                        slabs[idx] = { ...slabs[idx], toUnit: e.target.value };
                        return { ...f, slabs };
                      })
                    }
                  />
                  <Input
                    placeholder="Rate"
                    value={s.ratePerUnit}
                    onChange={(e) =>
                      setForm((f) => {
                        const slabs = [...f.slabs];
                        slabs[idx] = { ...slabs[idx], ratePerUnit: e.target.value };
                        return { ...f, slabs };
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={form.slabs.length <= 1}
                    onClick={() =>
                      setForm((f) => ({ ...f, slabs: f.slabs.filter((_, i) => i !== idx) }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate tariff"
        message="Inactive tariffs are not used for future payroll months. Historical monthly snapshots are unchanged."
        confirmText="Deactivate"
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => deactivateTarget && void deactivate(deactivateTarget)}
      />
    </div>
  );
}
