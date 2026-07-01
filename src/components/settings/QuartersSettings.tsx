"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";

export type QuarterRecord = {
  id: string;
  quarterName: string;
  quarterType: string;
  monthlyRent: number;
  status: "available" | "assigned" | "inactive" | string;
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string | null;
  assignedEmployeeCode?: string | null;
};

type QuarterForm = {
  quarterName: string;
  quarterType: string;
  monthlyRent: string;
};

const emptyForm = (): QuarterForm => ({
  quarterName: "",
  quarterType: "Type II",
  monthlyRent: "",
});

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "available") return "success";
  if (status === "assigned") return "warning";
  return "neutral";
}

export function QuartersSettings() {
  const [quarters, setQuarters] = useState<QuarterRecord[]>([]);
  const [quarterTypes, setQuarterTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuarterRecord | null>(null);
  const [form, setForm] = useState<QuarterForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<QuarterRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/quarters");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load quarters");
      setQuarters((data.quarters ?? []) as QuarterRecord[]);
      setQuarterTypes((data.quarterTypes ?? []) as string[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quarters");
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

  function openEdit(q: QuarterRecord) {
    setEditing(q);
    setForm({
      quarterName: q.quarterName,
      quarterType: q.quarterType,
      monthlyRent: String(q.monthlyRent ?? ""),
    });
    setFormOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        quarterName: form.quarterName.trim(),
        quarterType: form.quarterType,
        monthlyRent: Number(form.monthlyRent),
      };
      const res = await fetch(editing ? `/api/settings/quarters/${editing.id}` : "/api/settings/quarters", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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

  async function unassign(q: QuarterRecord) {
    setError(null);
    const res = await fetch(`/api/settings/quarters/${q.id}/unassign`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || data.error || "Unassign failed");
      return;
    }
    await load();
  }

  async function deactivate(q: QuarterRecord) {
    setError(null);
    const res = await fetch(`/api/settings/quarters/${q.id}/deactivate`, { method: "POST" });
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
          <h2 className="text-lg font-semibold text-slate-900">Quarters</h2>
          <p className="text-sm text-slate-600">Manage official government accommodation and monthly rent.</p>
        </div>
        <Button onClick={openAdd}>Add Quarter</Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading quarters…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Quarter</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2 text-right">Monthly Rent</th>
                <th className="px-2 py-2">Assigned Employee</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium">{q.quarterName}</td>
                  <td className="px-2 py-2">{q.quarterType}</td>
                  <td className="px-2 py-2 text-right">₹{Math.round(q.monthlyRent).toLocaleString("en-IN")}</td>
                  <td className="px-2 py-2">
                    {q.assignedEmployeeName
                      ? `${q.assignedEmployeeName}${q.assignedEmployeeCode ? ` (${q.assignedEmployeeCode})` : ""}`
                      : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(q.status)}>{q.status}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(q)}>
                        Edit
                      </Button>
                      {q.status === "assigned" ? (
                        <Button variant="ghost" size="sm" onClick={() => void unassign(q)}>
                          Unassign
                        </Button>
                      ) : null}
                      {q.status !== "inactive" ? (
                        <Button variant="ghost" size="sm" className="!text-amber-800" onClick={() => setDeactivateTarget(q)}>
                          Deactivate
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {quarters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-slate-500">
                    No quarters configured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Quarter" : "Add Quarter"}
        asForm
        onSubmit={handleSave}
        footer={
          <>
            <Button variant="outline" type="button" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Quarter Number / Name" required>
            <Input
              value={form.quarterName}
              onChange={(e) => setForm((f) => ({ ...f, quarterName: e.target.value }))}
              required
            />
          </FormField>
          <SelectField
            label="Quarter Type"
            required
            value={form.quarterType}
            onChange={(value) => setForm((f) => ({ ...f, quarterType: value }))}
            options={(quarterTypes.length
              ? quarterTypes
              : ["Type I", "Type II", "Type III", "Type IV", "Type V", "Other"]
            ).map((t) => ({ value: t, label: t }))}
          />
          <FormField label="Monthly Rent" required>
            <Input
              type="number"
              min={0}
              value={form.monthlyRent}
              onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))}
              required
            />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate quarter?"
        message="Inactive quarters cannot be assigned until reactivated from the database."
        confirmText="Deactivate"
        variant="danger"
        onConfirm={() => deactivateTarget && void deactivate(deactivateTarget)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
