"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CpfCalculationSettingsForm } from "@/components/payroll/CpfCalculationSettingsForm";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import { earningFieldsForCpfBasis, type PayrollFieldDefinition } from "@/lib/payrollFieldTypes";

type CpfSettingsPayload = {
  cpfUseCompanySettings?: boolean;
  cpfPercentageOverride?: number | null;
  cpfBasisFieldKeysOverride?: string[];
  cpfSettings?: {
    cpfUseCompanySettings?: boolean;
    cpfPercentageOverride?: number | null;
    cpfBasisFieldKeysOverride?: string[];
    companySettings?: { cpfFormulaPreview?: string; cpfPercentage?: number; cpfBasisFieldKeys?: string[] };
    effectiveSettings?: {
      cpfFormulaPreview?: string;
      cpfPercentage?: number;
      cpfBasisFieldKeys?: string[];
      source?: string;
    };
  };
  cpfEffective?: number;
};

type Props = {
  payrollMaster: CpfSettingsPayload | null;
  onSaved?: (master: CpfSettingsPayload) => void;
};

function parseApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const d = data as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  if (typeof d.message === "string") return d.message;
  return fallback;
}

export function EmployeeCpfSettingsCard({ payrollMaster, onSaved }: Props) {
  const { showToast } = useToast();
  const [earningFields, setEarningFields] = useState<PayrollFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [useCompanyDefault, setUseCompanyDefault] = useState(true);
  const [cpfPercentage, setCpfPercentage] = useState("12");
  const [cpfBasisKeys, setCpfBasisKeys] = useState<string[]>([]);

  const companyPreview =
    payrollMaster?.cpfSettings?.companySettings?.cpfFormulaPreview ?? "CPF = (Basic + DA + …) × 12%";
  const effectivePreview = payrollMaster?.cpfSettings?.effectiveSettings?.cpfFormulaPreview;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/settings/payroll-config");
        const data = await res.json();
        if (!res.ok) throw new Error(parseApiError(data, "Failed to load payroll configuration"));
        if (!cancelled) {
          setEarningFields(earningFieldsForCpfBasis((data.fields ?? []) as PayrollFieldDefinition[]));
        }
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!payrollMaster) return;
    const cs = payrollMaster.cpfSettings;
    const useCo = cs?.cpfUseCompanySettings ?? payrollMaster.cpfUseCompanySettings ?? true;
    setUseCompanyDefault(useCo);
    if (useCo) {
      setCpfPercentage(String(cs?.companySettings?.cpfPercentage ?? cs?.effectiveSettings?.cpfPercentage ?? 12));
      setCpfBasisKeys(cs?.companySettings?.cpfBasisFieldKeys ?? []);
    } else {
      setCpfPercentage(
        String(
          cs?.cpfPercentageOverride ??
            payrollMaster.cpfPercentageOverride ??
            cs?.effectiveSettings?.cpfPercentage ??
            12,
        ),
      );
      setCpfBasisKeys(
        cs?.cpfBasisFieldKeysOverride ??
          payrollMaster.cpfBasisFieldKeysOverride ??
          cs?.effectiveSettings?.cpfBasisFieldKeys ??
          [],
      );
    }
  }, [payrollMaster]);

  const toggleBasisKey = useCallback((key: string) => {
    setCpfBasisKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const effectiveCpf = useMemo(() => {
    const n = payrollMaster?.cpfEffective;
    return n != null ? Math.round(Number(n)).toLocaleString("en-IN") : "—";
  }, [payrollMaster?.cpfEffective]);

  async function save() {
    if (!useCompanyDefault && cpfBasisKeys.length === 0) {
      showToast("error", "Select at least one earning field for PF/CPF calculation.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/me/payroll-master/cpf-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpfUseCompanySettings: useCompanyDefault,
          cpfPercentageOverride: useCompanyDefault ? null : parseFloat(cpfPercentage) || 0,
          cpfBasisFieldKeysOverride: useCompanyDefault ? [] : cpfBasisKeys,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data, "Save failed"));
      showToast("success", "CPF settings updated");
      onSaved?.(data.payrollMaster ?? data.master);
    } catch (e: unknown) {
      showToast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!payrollMaster) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-sm text-slate-600">
        Payroll master is not set up yet. CPF settings will appear here once your salary master record exists.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">My PF / CPF settings</h3>
          <p className="mt-1 text-sm text-slate-600">
            View or customize how CPF is calculated on your salary. Institute default applies unless you choose a custom
            setup.
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Current CPF (master)</p>
          <p className="font-semibold text-slate-900">₹{effectiveCpf}</p>
        </div>
      </div>

      {loadError ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      ) : null}

      {effectivePreview && useCompanyDefault ? (
        <p className="mb-4 text-sm text-slate-700">
          <span className="font-medium">Active formula:</span> {effectivePreview}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading earning fields…</p>
      ) : (
        <CpfCalculationSettingsForm
          earningFields={earningFields}
          cpfPercentage={cpfPercentage}
          cpfBasisKeys={cpfBasisKeys}
          onCpfPercentageChange={setCpfPercentage}
          onToggleBasisKey={toggleBasisKey}
          useCompanyDefault={useCompanyDefault}
          onUseCompanyDefaultChange={setUseCompanyDefault}
          companyPreview={companyPreview}
        />
      )}

      <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
        <Button size="sm" onClick={save} loading={saving} disabled={saving || loading}>
          Save CPF settings
        </Button>
      </div>
    </div>
  );
}
