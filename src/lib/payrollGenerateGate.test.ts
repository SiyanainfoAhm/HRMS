/**
 * Run: npx --yes tsx src/lib/payrollGenerateGate.test.ts
 *
 * Regression: "Generate payroll" must never run past, or throw away, edits that exist
 * only in the browser.
 */
import {
  clearSavedPayrollDraftMasks,
  ensureDraftSavedBeforeGenerate,
  hasUnsavedDraftEdits,
  markPayrollDraftFieldEdited,
  snapshotPayrollDraftMasks,
} from "./payrollDraftPatch";
import { saveDraftWithConflictRetry, type DraftPatchRow } from "./payrollDraftConflict";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

(async () => {
  // --- hasUnsavedDraftEdits reads the masks, not just a flag
  {
    const masks = new Map<string, Set<string>>();
    assertEq(hasUnsavedDraftEdits(masks, new Set(), false), false, "clean screen");
    markPayrollDraftFieldEdited(masks, "2026-09:e1", "electricityUnitsConsumed");
    assertEq(hasUnsavedDraftEdits(masks, new Set(), false), true, "a typed edit counts even when the dirty flag says clean");
    assertEq(hasUnsavedDraftEdits(new Map(), new Set(["2026-09:e1"]), false), true, "an edited row counts");
    assertEq(hasUnsavedDraftEdits(new Map(), new Set(), true), true, "the flag still counts");
  }

  // --- gate: clean screen proceeds without saving
  {
    let saves = 0;
    const gate = await ensureDraftSavedBeforeGenerate({ hasUnsaved: () => false, confirmSave: () => true, save: async () => { saves++; return true; } });
    assertEq(gate.proceed, true, "nothing to save");
    assertEq(saves, 0, "no needless save");
  }

  // --- gate: unsaved edits and the user cancels -> blocked, edits untouched
  {
    let saves = 0;
    const gate = await ensureDraftSavedBeforeGenerate({ hasUnsaved: () => true, confirmSave: () => false, save: async () => { saves++; return true; } });
    assertEq(gate.proceed, false, "cancel blocks Generate");
    assertEq(saves, 0, "cancel does not save");
    if (!gate.proceed) assertEq(gate.message.includes("still on screen"), true, "clear message");
  }

  // --- gate: save fails (e.g. persistent 409) -> blocked with a clear message
  {
    const gate = await ensureDraftSavedBeforeGenerate({ hasUnsaved: () => true, confirmSave: () => true, save: async () => false });
    assertEq(gate.proceed, false, "failed save blocks Generate");
    if (!gate.proceed) assertEq(gate.message.includes("not generated"), true, "message says payroll was not generated");
  }

  // --- gate: save ok -> proceeds
  {
    let unsaved = true;
    const gate = await ensureDraftSavedBeforeGenerate({ hasUnsaved: () => unsaved, confirmSave: () => true, save: async () => { unsaved = false; return true; } });
    assertEq(gate.proceed, true, "saved draft lets Generate proceed");
  }

  // --- gate: something typed while the save was running -> blocked, not slipped past
  {
    const masks = new Map<string, Set<string>>();
    const key = "2026-09:e1";
    markPayrollDraftFieldEdited(masks, key, "electricityUnitsConsumed");
    const gate = await ensureDraftSavedBeforeGenerate({
      hasUnsaved: () => hasUnsavedDraftEdits(masks, new Set(), false),
      confirmSave: () => true,
      save: async () => {
        const sent = snapshotPayrollDraftMasks(masks);
        markPayrollDraftFieldEdited(masks, key, "govDeduction_water"); // typed while the request ran
        clearSavedPayrollDraftMasks(masks, sent);
        return true;
      },
    });
    assertEq(gate.proceed, false, "late keystrokes block Generate");
    if (!gate.proceed) assertEq(gate.message.includes("Save Draft once more"), true, "tells the user what to do");
    assertEq([...(masks.get(key) ?? [])], ["govDeduction_water"], "the late edit is still marked unsaved");
  }

  // --- end to end: units 80 + water typed, forced 409 from another session, Generate -> save merges, then proceeds
  {
    let version = 1;
    const stored = { units: 0, water: 314, mess: 25, incentive: 0 };
    const masks = new Map<string, Set<string>>();
    const key = "2026-09:e1";
    markPayrollDraftFieldEdited(masks, key, "electricityUnitsConsumed");
    markPayrollDraftFieldEdited(masks, key, "govDeduction_water");
    const mine = { units: 80, water: 400 };
    // another session saves incentive and bumps the version, so our version is stale
    stored.incentive = 500;
    version = 2;
    const patches: DraftPatchRow[] = [{ employeeUserId: "e1", changedFields: [...masks.get(key)!], rowPayload: {} }];
    let generated = false;

    const gate = await ensureDraftSavedBeforeGenerate({
      hasUnsaved: () => hasUnsavedDraftEdits(masks, new Set(), false),
      confirmSave: () => true,
      save: async () => {
        const sent = snapshotPayrollDraftMasks(masks);
        const out = await saveDraftWithConflictRetry({
          patches, version: 1, base: new Map(),
          send: async (v) => {
            if (v !== version) return { status: 409, body: {} };
            stored.units = mine.units; stored.water = mine.water; version++;
            return { status: 200, body: { draft: { version } } };
          },
          fetchLatest: async () => ({ version, rows: new Map() }),
        });
        if (out.ok) clearSavedPayrollDraftMasks(masks, sent);
        return out.ok;
      },
    });
    if (gate.proceed) generated = true;
    assertEq(generated, true, "Generate proceeds after the merged save");
    assertEq(stored, { units: 80, water: 400, mess: 25, incentive: 500 }, "typed units/water saved, mess unchanged, other session's incentive kept");
    assertEq(hasUnsavedDraftEdits(masks, new Set(), false), false, "nothing left unsaved");
  }

  console.log("payrollGenerateGate.test.ts: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
