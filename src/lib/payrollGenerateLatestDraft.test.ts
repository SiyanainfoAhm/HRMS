/**
 * Run: npx --yes tsx src/lib/payrollGenerateLatestDraft.test.ts
 *
 * Generate must use the latest saved draft, and must say (and ask) when another session
 * changed values the user did not edit. Cancel blocks; nothing changed means no prompt.
 */
import {
  chooseLatestDraftForGenerate,
  describeExternalChanges,
  externalDraftChanges,
  type ExternalDraftChange,
} from "./payrollDraftConflict";
import { ensureDraftSavedBeforeGenerate } from "./payrollDraftPatch";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

type Row = Record<string, any>;
const EMP = "emp-1";
const OTHER = "emp-2";

const row = (uid: string, over: Record<string, any> = {}): Row => ({
  employeeUserId: uid,
  payDays: 30,
  incentive: 0,
  daArrear: 0,
  governmentMonthly: {
    daArrearsPaid: 0,
    electricityUnitsConsumed: 0,
    deductions: { electricity: 49, water: 314, mess: 25 },
    ...(over.gm ?? {}),
  },
  govRecalc: { electricityUnitsConsumed: 0 },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "gm")),
});

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** The latest draft on the server after the user's own save: units 80 + water 400 are in it (they win). */
const latestAfterUserSave = (extra: (r: Row) => void = () => {}): Map<string, Row> => {
  const a = row(EMP);
  a.governmentMonthly.electricityUnitsConsumed = 80;
  a.govRecalc.electricityUnitsConsumed = 80;
  a.governmentMonthly.deductions.electricity = 98;
  a.governmentMonthly.deductions.water = 400;
  extra(a);
  return new Map([[EMP, a], [OTHER, row(OTHER)]]);
};

const shownOnScreen = (): Map<string, Row> => new Map([[EMP, row(EMP)], [OTHER, row(OTHER)]]);
const userEdited = (): Map<string, Set<string>> => new Map([[EMP, new Set(["electricityUnitsConsumed", "govDeduction_water"])]]);

(async () => {
  // 1. Another session changed an UNTOUCHED field (mess): it is listed, the user's own edits and their derived
  //    electricity figure are not, and Generate is handed the latest values.
  {
    const latest = latestAfterUserSave((r) => { r.governmentMonthly.deductions.mess = 30; });
    const seen: ExternalDraftChange[][] = [];
    const out = await chooseLatestDraftForGenerate({
      shown: shownOnScreen(), userEdited: userEdited(),
      fetchLatest: async () => ({ rows: latest, version: 7 }),
      confirmChanges: (c) => { seen.push(c); return true; },
    });
    assertEq(seen.length, 1, "exactly one confirmation");
    assertEq(seen[0].map((c) => [c.employeeUserId, c.field, c.before, c.after]), [[EMP, "govDeduction_mess", 25, 30]], "only the other session's change is listed");
    assertEq(out.proceed, true, "OK proceeds");
    if (out.proceed) {
      // "Generate uses the new value": what generation reads is the latest row.
      const generatedFrom = out.latest.rows.get(EMP)!;
      assertEq(generatedFrom.governmentMonthly.deductions.mess, 30, "the other session's mess value is used");
      assertEq(generatedFrom.governmentMonthly.electricityUnitsConsumed, 80, "the user's units are used");
      assertEq(generatedFrom.governmentMonthly.deductions.water, 400, "the user's water is used");
      assertEq(generatedFrom.governmentMonthly.deductions.electricity, 98, "electricity follows the user's units");
    }
  }

  // 2. Cancel blocks Generate and carries a clear message.
  {
    let generated = false;
    const out = await chooseLatestDraftForGenerate({
      shown: shownOnScreen(), userEdited: userEdited(),
      fetchLatest: async () => ({ rows: latestAfterUserSave((r) => { r.governmentMonthly.deductions.mess = 30; }) }),
      confirmChanges: () => false,
    });
    if (out.proceed) generated = true;
    assertEq(generated, false, "Cancel blocks Generate");
    if (!out.proceed) assertEq(out.message.includes("Nothing was generated"), true, "message says nothing was generated");
  }

  // 3. Nothing changed elsewhere: no extra prompt at all.
  {
    let prompts = 0;
    const out = await chooseLatestDraftForGenerate({
      shown: shownOnScreen(), userEdited: userEdited(),
      fetchLatest: async () => ({ rows: latestAfterUserSave() }),
      confirmChanges: () => { prompts++; return true; },
    });
    assertEq(prompts, 0, "no prompt when only the user's own edits differ");
    assertEq(out.proceed, true, "proceeds");
    assertEq(out.changes, [], "no external changes");
  }

  // 4. A different employee's field and an arrear line are caught too; a user-edited arrear (and the lines it drives) is not.
  {
    const shown = shownOnScreen();
    const latest = latestAfterUserSave((r) => { r.daArrear = 1000; r.governmentMonthly.daArrearsPaid = 1000; r.grossArrear = 1000; });
    latest.get(OTHER)!.incentive = 250;
    const edited = userEdited();
    edited.get(EMP)!.add("daArrear");
    const changes = externalDraftChanges(shown, latest, edited);
    assertEq(changes.map((c) => `${c.employeeUserId}:${c.field}`), [`${OTHER}:incentive`], "own arrear edit and its derived lines are not external; the other employee's incentive is");
    const text = describeExternalChanges(changes, (uid) => (uid === OTHER ? "Asha Rao" : uid));
    assertEq(text, '• Asha Rao: Incentive 0 → 250', "readable line");
  }

  // 5. Confirmation text is capped.
  {
    const many: ExternalDraftChange[] = Array.from({ length: 12 }, (_, i) => ({ employeeUserId: EMP, field: `govDeduction_k${i}`, before: 1, after: 2 }));
    const lines = describeExternalChanges(many, () => "X").split("\n");
    assertEq(lines.length, 9, "8 lines plus a summary");
    assertEq(lines[8], "…and 4 more", "summary line");
  }

  // 6. Whole flow: pre-save gate (merge-and-retry) -> latest draft -> confirmation -> generate; each failure blocks.
  {
    const run = async (opts: { saveOk: boolean; confirmChanges: boolean; otherChange: boolean }) => {
      let generated = false;
      const log: string[] = [];
      const gate = await ensureDraftSavedBeforeGenerate({
        hasUnsaved: () => !log.includes("saved"),
        confirmSave: () => true,
        save: async () => { if (opts.saveOk) log.push("saved"); return opts.saveOk; },
      });
      if (gate.proceed) {
        const out = await chooseLatestDraftForGenerate({
          shown: shownOnScreen(), userEdited: userEdited(),
          fetchLatest: async () => ({ rows: latestAfterUserSave(opts.otherChange ? (r) => { r.governmentMonthly.deductions.mess = 30; } : undefined) }),
          confirmChanges: () => { log.push("confirm"); return opts.confirmChanges; },
        });
        if (out.proceed) generated = true;
      }
      return { generated, log };
    };
    assertEq(await run({ saveOk: true, confirmChanges: true, otherChange: true }), { generated: true, log: ["saved", "confirm"] }, "save, confirm, generate");
    assertEq(await run({ saveOk: true, confirmChanges: false, otherChange: true }), { generated: false, log: ["saved", "confirm"] }, "cancel after save blocks");
    assertEq(await run({ saveOk: true, confirmChanges: true, otherChange: false }), { generated: true, log: ["saved"] }, "no extra prompt when unchanged");
    assertEq(await run({ saveOk: false, confirmChanges: true, otherChange: true }), { generated: false, log: [] }, "failed save never reaches the re-fetch");
  }

  console.log("payrollGenerateLatestDraft.test.ts: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
