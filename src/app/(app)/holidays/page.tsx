"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SkeletonTable } from "@/components/Skeleton";

type Holiday = {
  id: string;
  name: string;
  holiday_date: string;
  is_optional: boolean;
  location: string | null;
};

export default function HolidaysPage() {
  const { role } = useAuth();
  const canManage = useMemo(() => role === "super_admin" || role === "admin" || role === "hr", [role]);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [location, setLocation] = useState("");
  const [isOptional, setIsOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/holidays");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load holidays");
        if (!cancelled) setHolidays(data.holidays || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load holidays");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsDialogOpen(false);
    }
    if (isDialogOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDialogOpen]);

  function resetForm() {
    setFormError(null);
    setName("");
    setHolidayDate("");
    setLocation("");
    setIsOptional(false);
  }

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          holidayDate,
          location: location.trim() || undefined,
          isOptional,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to add holiday");
      setHolidays((prev) => [...prev, data.holiday]);
      resetForm();
      setIsDialogOpen(false);
    } catch (e: any) {
      setFormError(e?.message || "Failed to add holiday");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Holidays</h1>
        <p className="muted">Company holiday calendar.</p>
      </div>

      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              resetForm();
              setIsDialogOpen(true);
            }}
          >
            Add holiday
          </button>
        </div>
      )}

      {isDialogOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close dialog"
            onClick={() => setIsDialogOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add holiday</h2>
                <p className="text-sm text-slate-500">Create a holiday for your company.</p>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setIsDialogOpen(false)}>
                Close
              </button>
            </div>

            <form onSubmit={addHoliday} className="p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Holiday name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date</label>
                  <input
                    type="date"
                    required
                    value={holidayDate}
                    onChange={(e) => setHolidayDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Location (optional)</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="md:col-span-3 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={isOptional}
                      onChange={(e) => setIsOptional(e.target.checked)}
                    />
                    Optional holiday
                  </label>
                  <div className="flex flex-col items-end">
                    {formError && <p className="text-sm text-red-600">{formError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          resetForm();
                          setIsDialogOpen(false);
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={saving}>
                        {saving ? "Adding..." : "Add holiday"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <SkeletonTable rows={6} columns={4} />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : holidays.length === 0 ? (
          <p className="muted">No holidays configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Optional</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">{new Date(h.holiday_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{h.name}</td>
                    <td className="px-3 py-2">{h.location || "-"}</td>
                    <td className="px-3 py-2">{h.is_optional ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

