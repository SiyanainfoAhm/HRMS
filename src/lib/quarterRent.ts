/** Effective quarter rent: explicit 0 must remain 0 (nullish, not truthy). */

export function parseQuarterRentInput(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/**
 * Prefer manual/master rent when present (including 0); else catalog default.
 */
export function resolveEffectiveQuarterRent(
  manualOrMasterRent: number | null | undefined,
  catalogDefaultRent: number | null | undefined,
): number {
  if (manualOrMasterRent !== null && manualOrMasterRent !== undefined && Number.isFinite(Number(manualOrMasterRent))) {
    return Math.max(0, Number(manualOrMasterRent));
  }
  if (catalogDefaultRent !== null && catalogDefaultRent !== undefined && Number.isFinite(Number(catalogDefaultRent))) {
    return Math.max(0, Number(catalogDefaultRent));
  }
  return 0;
}

/** Run Payroll: run-level override → master/employee rent → catalog default → 0. */
export function resolveRunPayrollQuarterRent(opts: {
  hasQuarter: boolean;
  runManualOverride?: boolean;
  runRent?: number | null;
  masterRent?: number | null;
  catalogDefaultRent?: number | null;
}): number {
  if (!opts.hasQuarter) return 0;
  if (opts.runManualOverride) {
    return resolveEffectiveQuarterRent(opts.runRent, opts.masterRent ?? opts.catalogDefaultRent);
  }
  return resolveEffectiveQuarterRent(opts.masterRent, opts.catalogDefaultRent);
}

export function isCustomQuarterRent(
  currentRent: number | null | undefined,
  catalogDefaultRent: number | null | undefined,
): boolean {
  if (currentRent === null || currentRent === undefined) return false;
  if (catalogDefaultRent === null || catalogDefaultRent === undefined) return false;
  return Number(currentRent) !== Number(catalogDefaultRent);
}

export function formatQuarterOptionLabel(q: {
  quarterName: string;
  quarterType: string;
  monthlyRent: number;
  status?: string;
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string | null;
}): string {
  const base = `${q.quarterName} — ${q.quarterType} — ₹${Math.round(q.monthlyRent).toLocaleString("en-IN")}/month`;
  if (q.status === "assigned" && q.assignedEmployeeName) {
    return `${base} (Assigned: ${q.assignedEmployeeName})`;
  }
  if (q.status === "assigned") {
    return `${base} (Assigned)`;
  }
  return base;
}
