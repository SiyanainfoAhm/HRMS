/**
 * Produces, for chosen employees, the Run Payroll row the SCREEN would save after an edit: the server preview rows are
 * resolved against the saved draft (like collectRunRowsForExport), then the same edit path as the screen is applied
 * (leave lines: full recompute with day-dependent overrides cleared; transport: the sheet monetary edit).
 * Pure computation: touches no database. Used by `php artisan payroll:apply-leave-lines`.
 *
 *   npx tsx scripts/draft-edit-replay.ts <input.json> <output.json>
 *   input: { preview, draft, edits: [{ userId, kind: "leaveLines" | "transportZero", lines? }], year, month }
 */
import fs from "node:fs";
import { resolveRunPayrollRow, type RunPayrollRowLike } from "../src/lib/resolveRunPayrollRow";
import { draftStoredMapFromEmployees, type DraftEmployeeApi } from "../src/lib/payrollDraftConflict";
import {
  applyGovernmentPayrollRowCompute,
  arrearSnapshotFromRow,
  ensureReferenceSalariesForRecompute,
  governmentRowFromCompute,
} from "../src/lib/govRunRowCompute";
import { applyGovernmentSheetMonetaryEdit, clearDayDependentOverridesFromGovRecalc } from "../src/lib/runPayrollSheetEdit";
import { daysInMonthOf, type LeaveLine } from "../src/lib/leaveDeductions";
import type { GovRecalcPayload } from "../src/lib/govRunPayrollCompute";

type Edit = { userId: string; kind: "leaveLines" | "transportZero"; lines?: LeaveLine[] };
const [inPath, outPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inPath, "utf8")) as {
  preview: { preview?: { rows?: RunPayrollRowLike[]; daysInMonth?: number }; payrollConfig?: { fields?: never } };
  draft: DraftEmployeeApi[];
  edits: Edit[];
  year: number;
  month: number;
};
const { year, month } = input;
const periodKey = `${year}-${month}`;
const stored = draftStoredMapFromEmployees(periodKey, input.draft);
const previewRows = input.preview.preview?.rows ?? [];
const dim = input.preview.preview?.daysInMonth ?? daysInMonthOf(year, month);
const payrollConfig = (input.preview as { payrollConfig?: { fields?: never } }).payrollConfig;

const resolveRow = (r: RunPayrollRowLike): RunPayrollRowLike =>
  resolveRunPayrollRow(r, {
    denom: dim, runYear: year, runMonth: month, payrollConfig, alreadyRun: false, draftDirty: false, preserveEdits: false,
    cached: null, cachedPeriodKey: periodKey, draftStored: stored.get(`${periodKey}:${String(r.employeeUserId ?? "")}`) ?? null,
  });

const out: Array<{ userId: string; kind: string; row: Record<string, unknown> }> = [];
for (const edit of input.edits) {
  const base = previewRows.find((r) => String((r as { employeeUserId?: unknown }).employeeUserId) === edit.userId);
  if (!base) throw new Error(`employee ${edit.userId} not in the preview rows`);
  const row = resolveRow(base) as RunPayrollRowLike & { govRecalc: GovRecalcPayload; payDays: number };
  const gr0 = row.govRecalc;
  let next: unknown;
  if (edit.kind === "leaveLines") {
    const lines = (edit.lines ?? []).map((l) => ({ ...l, days: Math.max(0, Math.round(Number(l.days) || 0)) }));
    const sum = (t: "HPL" | "EOL") => lines.filter((l) => l.type === t).reduce((s, l) => s + Math.min(l.days, daysInMonthOf(l.year, l.month)), 0);
    const grNext: GovRecalcPayload = { ...gr0, leaveLines: lines, hplDays: sum("HPL"), eolDays: sum("EOL"), hplDeductionManualOverride: false, eolDeductionManualOverride: false };
    const grReady = ensureReferenceSalariesForRecompute(clearDayDependentOverridesFromGovRecalc(grNext), year, month);
    const currentArrear = arrearSnapshotFromRow(row);
    const { comp, capped, unpaidDays } = applyGovernmentPayrollRowCompute(row, grReady, row.payDays, {
      daysInMonth: dim, runYear: year, runMonth: month, payrollConfig: payrollConfig as never, arrearOverride: currentArrear,
    });
    next = governmentRowFromCompute(row, grReady, comp, capped, unpaidDays, row, currentArrear, (payrollConfig as { fields?: never } | undefined)?.fields);
  } else {
    next = applyGovernmentSheetMonetaryEdit(row as never, "govEarning_transportPaid", 0, { payrollFieldDefs: (payrollConfig as { fields?: never } | undefined)?.fields });
  }
  out.push({ userId: edit.userId, kind: edit.kind, row: next as Record<string, unknown> });
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`replayed ${out.length} edit(s)`);
