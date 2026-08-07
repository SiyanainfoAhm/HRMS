"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageLoader } from "@/components/ui/AppPageLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";
import {
  normalizeQuarterName,
  normalizeQuarterTypeName,
  validateQuarterName,
  validateQuarterTypeName,
} from "@/lib/quarterValidation";

export type QuarterRecord = {
  id: string;
  quarterName: string;
  quarterType: string;
  quarterTypeId?: string | null;
  monthlyRent: number;
  status: "available" | "assigned" | "inactive" | string;
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string | null;
  assignedEmployeeCode?: string | null;
};

export type QuarterTypeRecord = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder?: number | null;
};

type QuarterForm = {
  quarterName: string;
  quarterTypeId: string;
  monthlyRent: string;
};

const ADD_TYPE_VALUE = "__add_new_quarter_type__";

const emptyForm = (): QuarterForm => ({
  quarterName: "",
  quarterTypeId: "",
  monthlyRent: "",
});

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "available") return "success";
  if (status === "assigned") return "warning";
  return "neutral";
}

function firstValidationMessage(data: Record<string, unknown>): string | null {
  const errors = data.errors;
  if (errors && typeof errors === "object") {
    const first = Object.values(errors as Record<string, string[]>).flat()[0];
    if (typeof first === "string" && first) return first;
  }
  if (typeof data.message === "string" && data.message) return data.message;
  if (typeof data.error === "string" && data.error) return data.error;
  return null;
}

export function QuartersSettings() {
  const [quarters, setQuarters] = useState<QuarterRecord[]>([]);
  const [typeRecords, setTypeRecords] = useState<QuarterTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuarterRecord | null>(null);
  const [form, setForm] = useState<QuarterForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<QuarterRecord | null>(null);

  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeError, setNewTypeError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [typeBeforeAdd, setTypeBeforeAdd] = useState("");
  // new type input uses autoFocus when addingType opens

  const [renameTarget, setRenameTarget] = useState<QuarterTypeRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/quarters");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(firstValidationMessage(data) || "Failed to load quarters");
      setQuarters((data.quarters ?? []) as QuarterRecord[]);
      const records = (data.quarterTypeRecords ?? []) as QuarterTypeRecord[];
      if (records.length) {
        setTypeRecords(records);
      } else {
        const names = (data.quarterTypes ?? []) as string[];
        setTypeRecords(names.map((name, i) => ({ id: `legacy-${i}`, name, isActive: true })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quarters");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTypes = useMemo(
    () => typeRecords.filter((t) => t.isActive || (editing && t.id === editing.quarterTypeId)),
    [typeRecords, editing],
  );

  const defaultTypeId = useMemo(() => {
    const typeIi = typeRecords.find((t) => t.isActive && t.name === "Type II");
    if (typeIi) return typeIi.id;
    return typeRecords.find((t) => t.isActive)?.id ?? "";
  }, [typeRecords]);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm(), quarterTypeId: defaultTypeId });
    setFormError(null);
    setAddingType(false);
    setNewTypeName("");
    setNewTypeError(null);
    setFormOpen(true);
  }

  function openEdit(q: QuarterRecord) {
    setEditing(q);
    setForm({
      quarterName: q.quarterName,
      quarterTypeId: q.quarterTypeId || typeRecords.find((t) => t.name === q.quarterType)?.id || "",
      monthlyRent: String(q.monthlyRent ?? ""),
    });
    setFormError(null);
    setAddingType(false);
    setNewTypeName("");
    setNewTypeError(null);
    setFormOpen(true);
  }

  function cancelAddType() {
    setAddingType(false);
    setNewTypeName("");
    setNewTypeError(null);
    setForm((f) => ({ ...f, quarterTypeId: typeBeforeAdd || defaultTypeId }));
  }

  async function saveNewType() {
    const validation = validateQuarterTypeName(newTypeName);
    if (validation) {
      setNewTypeError(validation);
      return;
    }
    setSavingType(true);
    setNewTypeError(null);
    try {
      const res = await fetch("/api/settings/quarter-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizeQuarterTypeName(newTypeName) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(firstValidationMessage(data) || "Failed to create quarter type");
      const created = (data.quarterType ?? data) as QuarterTypeRecord;
      setTypeRecords((prev) => {
        const without = prev.filter((t) => t.id !== created.id);
        return [...without, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setForm((f) => ({ ...f, quarterTypeId: created.id }));
      setAddingType(false);
      setNewTypeName("");
    } catch (err) {
      setNewTypeError(err instanceof Error ? err.message : "Failed to create quarter type");
    } finally {
      setSavingType(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (addingType) {
      setFormError("Finish or cancel adding a Quarter Type first.");
      return;
    }
    const nameError = validateQuarterName(form.quarterName);
    if (nameError) {
      setFormError(nameError);
      return;
    }
    if (!form.quarterTypeId) {
      setFormError("Quarter Type is required.");
      return;
    }
    const rent = Number(form.monthlyRent);
    if (!Number.isFinite(rent) || rent < 0) {
      setFormError("Monthly Rent must be numeric and >= 0.");
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const payload = {
        quarterName: normalizeQuarterName(form.quarterName),
        quarterTypeId: form.quarterTypeId,
        monthlyRent: rent,
      };
      const res = await fetch(editing ? `/api/settings/quarters/${editing.id}` : "/api/settings/quarters", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(firstValidationMessage(data) || "Save failed");
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function unassign(q: QuarterRecord) {
    setError(null);
    const res = await fetch(`/api/settings/quarters/${q.id}/unassign`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(firstValidationMessage(data) || "Unassign failed");
      return;
    }
    await load();
  }

  async function deactivate(q: QuarterRecord) {
    setError(null);
    const res = await fetch(`/api/settings/quarters/${q.id}/deactivate`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(firstValidationMessage(data) || "Deactivate failed");
      return;
    }
    setDeactivateTarget(null);
    await load();
  }

  async function setTypeActive(t: QuarterTypeRecord, active: boolean) {
    setError(null);
    const res = await fetch(`/api/settings/quarter-types/${t.id}/${active ? "activate" : "deactivate"}`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(firstValidationMessage(data) || "Update failed");
      return;
    }
    const updated = (data.quarterType ?? null) as QuarterTypeRecord | null;
    if (updated) {
      setTypeRecords((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
    } else {
      await load();
    }
  }

  async function saveRename() {
    if (!renameTarget) return;
    const validation = validateQuarterTypeName(renameValue);
    if (validation) {
      setRenameError(validation);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/settings/quarter-types/${renameTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizeQuarterTypeName(renameValue) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(firstValidationMessage(data) || "Rename failed");
      setRenameTarget(null);
      await load();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenaming(false);
    }
  }

  const typeOptions = [
    ...activeTypes.map((t) => ({
      value: t.id,
      label: t.isActive ? t.name : `${t.name} (inactive)`,
    })),
    { value: ADD_TYPE_VALUE, label: "+ Add New Quarter Type" },
  ];

  return (
    <div className="space-y-4">
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
          <AppPageLoader variant="inline" message="Loading settings..." submessage="" />
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="!text-amber-800"
                            onClick={() => setDeactivateTarget(q)}
                          >
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
      </div>

      <div className="card space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Quarter Types</h3>
          <p className="text-sm text-slate-600">
            Manage types offered in the Quarter form. Deactivated types stay visible on existing quarters.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {typeRecords.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium">{t.name}</td>
                  <td className="px-2 py-2">
                    <Badge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRenameTarget(t);
                          setRenameValue(t.name);
                          setRenameError(null);
                        }}
                      >
                        Rename
                      </Button>
                      {t.isActive ? (
                        <Button variant="ghost" size="sm" onClick={() => void setTypeActive(t, false)}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void setTypeActive(t, true)}>
                          Activate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {typeRecords.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-slate-500">
                    No quarter types yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={formOpen}
        onClose={() => {
          if (saving || savingType) return;
          setFormOpen(false);
        }}
        title={editing ? "Edit Quarter" : "Add Quarter"}
        asForm
        onSubmit={handleSave}
        footer={
          <>
            <Button
              variant="outline"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving || savingType}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || savingType || addingType}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Quarter Number / Name"
            required
            helperText="Letters, numbers, spaces, /, -, periods and parentheses are allowed."
            error={formError && formError.toLowerCase().includes("number/name") ? formError : null}
          >
            <Input
              value={form.quarterName}
              onChange={(e) => setForm((f) => ({ ...f, quarterName: e.target.value }))}
              required
            />
          </FormField>

          <div className="space-y-2">
            <SelectField
              label="Quarter Type"
              required
              searchable={activeTypes.length > 8}
              value={addingType ? "" : form.quarterTypeId}
              onChange={(value) => {
                if (value === ADD_TYPE_VALUE) {
                  setTypeBeforeAdd(form.quarterTypeId);
                  setAddingType(true);
                  setNewTypeName("");
                  setNewTypeError(null);
                  return;
                }
                setForm((f) => ({ ...f, quarterTypeId: value }));
              }}
              options={typeOptions}
              disabled={addingType}
            />
            {addingType ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                <FormField label="New Quarter Type Name" required error={newTypeError}>
                  <Input
                    autoFocus
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveNewType();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelAddType();
                      }
                    }}
                    disabled={savingType}
                  />
                </FormField>
                <div className="flex gap-2">
                  <Button type="button" size="sm" loading={savingType} onClick={() => void saveNewType()}>
                    Save Type
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={savingType} onClick={cancelAddType}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

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
        {formError && !formError.toLowerCase().includes("number/name") ? (
          <p className="mt-3 text-sm text-red-600">{formError}</p>
        ) : null}
      </Modal>

      <Modal
        open={!!renameTarget}
        onClose={() => (!renaming ? setRenameTarget(null) : undefined)}
        title="Rename Quarter Type"
        asForm
        onSubmit={(e) => {
          e.preventDefault();
          void saveRename();
        }}
        footer={
          <>
            <Button variant="outline" type="button" disabled={renaming} onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={renaming}>
              {renaming ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <FormField label="Quarter Type Name" required error={renameError}>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        </FormField>
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
