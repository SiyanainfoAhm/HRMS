/**
 * Read-only replay of what the Run Payroll screen does before "Generate": it takes the server preview rows and
 * resolves each with the saved draft (resolveRunPayrollRow), exactly like collectRunRowsForExport. Writes a JSON
 * file of the rows the screen would POST to /payroll/run. Touches no database.
 *
 *   npx tsx scripts/generate-replay-resolve.ts <preview.json> <draft.json> <out.json>
 */
import fs from "node:fs";
import { resolveRunPayrollRow, type RunPayrollRowLike } from "../src/lib/resolveRunPayrollRow";
import { draftStoredMapFromEmployees, type DraftEmployeeApi } from "../src/lib/payrollDraftConflict";

const [previewPath, draftPath, outPath] = process.argv.slice(2);
const previewData = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const draftEmployees = JSON.parse(fs.readFileSync(draftPath, "utf8")) as DraftEmployeeApi[];
const periodKey = "2026-10";
const stored = draftStoredMapFromEmployees(periodKey, draftEmployees);
const rows = (previewData.preview?.rows ?? []) as RunPayrollRowLike[];
const denom = previewData.preview?.daysInMonth ?? previewData.preview?.workingDaysInFullMonth ?? 31;

const resolved = rows.map((r) => {
  const uid = String(r.employeeUserId ?? "");
  return resolveRunPayrollRow(r, {
    denom,
    runYear: 2026,
    runMonth: 10,
    payrollConfig: previewData.payrollConfig,
    alreadyRun: false,
    draftDirty: false,
    preserveEdits: false,
    cached: null,
    cachedPeriodKey: periodKey,
    draftStored: stored.get(`${periodKey}:${uid}`) ?? null,
  });
});
fs.writeFileSync(outPath, JSON.stringify(resolved));
console.log(`resolved ${resolved.length} rows (preview ${rows.length}, draft ${draftEmployees.length}, stored map ${stored.size})`);
