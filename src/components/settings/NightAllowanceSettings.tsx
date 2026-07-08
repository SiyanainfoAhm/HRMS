"use client";

import { useCallback, useEffect, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatNightAllowanceSlabLabel } from "@/lib/nightAllowanceCalculation";

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

export function NightAllowanceSettings() {
  const [rates, setRates] = useState<NightAllowanceRateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NightAllowanceRateRecord | null>(null);
  const [form, setForm] = useState<RateForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<NightAllowanceRateRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/night-allowance-rates");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "Failed to load night allowance rates");
      setRates((data.rates ?? []) as NightAllowanceRateRecord[]);
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
    setFormOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="card space-y-4">
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
          <FormField label="Slab No" required>
            <Input
              type="number"
              min={1}
              value={form.slabNo}
              onChange={(e) => setForm((f) => ({ ...f, slabNo: e.target.value }))}
              required
            />
          </FormField>
          <FormField label="Pay Level" required>
            <Input
              type="number"
              min={1}
              value={form.payLevel}
              onChange={(e) => setForm((f) => ({ ...f, payLevel: e.target.value }))}
              required
            />
          </FormField>
          <FormField label="Rate Per Hour (₹)" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.ratePerHour}
              onChange={(e) => setForm((f) => ({ ...f, ratePerHour: e.target.value }))}
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
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget != null}
        title="Deactivate rate?"
        description={`Deactivate slab ${deactivateTarget?.slabNo} (Level ${deactivateTarget?.payLevel})?`}
        confirmLabel="Deactivate"
        onConfirm={() => deactivateTarget && void deactivate(deactivateTarget)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
