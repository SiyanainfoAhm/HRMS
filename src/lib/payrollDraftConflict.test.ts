/**
 * Run: npx --yes tsx src/lib/payrollDraftConflict.test.ts
 *
 * Regression: a 409 on the Run Payroll draft save must never lose typed values.
 */
import {
  draftFieldValue,
  draftStoredMapFromEmployees,
  findDraftConflicts,
  saveDraftWithConflictRetry,
  storedRowsByEmployee,
  type DraftPatchRow,
} from "./payrollDraftConflict";
import {
  clearSavedPayrollDraftMasks,
  markPayrollDraftFieldEdited,
  snapshotPayrollDraftMasks,
} from "./payrollDraftPatch";
import { payrollRowCacheKey } from "./payrollPeriodIsolation";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

type Row = Record<string, any>;
const EMP = "emp-1";
const OTHER = "emp-2";

const storedRow = (): Row => ({
  employeeUserId: EMP,
  daArrear: 0,
  incentive: 0,
  governmentMonthly: {
    daArrearsPaid: 0,
    deductions: { electricity: 49, water: 314, mess: 25 },
    electricityUnitsConsumed: 0,
  },
  govRecalc: { electricityUnitsConsumed: 0 },
});

/** In-memory draft server with the same rules as PayrollDraftService: version check, then apply ONLY the masked fields. */
function server() {
  let version = 1;
  const rows = new Map<string, Row>([[EMP, storedRow()], [OTHER, { ...storedRow(), employeeUserId: OTHER }]]);
  const calls = { sends: 0, fetches: 0 };
  const setToken = (row: Row, token: string, mine: Row) => {
    const gm = row.governmentMonthly;
    if (token === "electricityUnitsConsumed") {
      // the units token carries units, the derived electricity amount and the mode
      gm.electricityUnitsConsumed = mine.governmentMonthly.electricityUnitsConsumed;
      row.govRecalc.electricityUnitsConsumed = mine.govRecalc.electricityUnitsConsumed;
      gm.deductions.electricity = mine.governmentMonthly.deductions.electricity;
    } else if (token.startsWith("govDeduction_")) {
      const k = token.slice("govDeduction_".length);
      gm.deductions[k] = mine.governmentMonthly.deductions[k];
    } else if (token === "daArrear") {
      row.daArrear = mine.daArrear;
      gm.daArrearsPaid = mine.governmentMonthly.daArrearsPaid;
    } else {
      row[token] = mine[token];
    }
  };
  return {
    calls,
    rows,
    get version() { return version; },
    /** another browser saves something while this one is editing */
    otherSession(uid: string, mutate: (r: Row) => void) {
      mutate(rows.get(uid)!);
      version++;
    },
    send: async (patches: DraftPatchRow[], sentVersion: number | undefined) => {
      calls.sends++;
      if (sentVersion !== version) return { status: 409, body: { message: "Payroll was updated in another tab or session." } };
      for (const patch of patches) {
        const stored = rows.get(patch.employeeUserId)!;
        for (const token of patch.changedFields ?? []) setToken(stored, token, patch.rowPayload as Row);
      }
      version++;
      return { status: 200, body: { draft: { version } } };
    },
    fetchLatest: async () => {
      calls.fetches++;
      return { version, rows: new Map([...rows].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])) };
    },
  };
}

/** What the browser holds after the user typed units 80 (electricity re-derived to 98), water 400 and an arrear. */
const typedPatch = (): DraftPatchRow[] => {
  const mine = storedRow();
  mine.governmentMonthly.electricityUnitsConsumed = 80;
  mine.govRecalc.electricityUnitsConsumed = 80;
  mine.governmentMonthly.deductions.electricity = 98;
  mine.governmentMonthly.deductions.water = 400;
  mine.daArrear = 1000;
  mine.governmentMonthly.daArrearsPaid = 1000;
  return [{ employeeUserId: EMP, changedFields: ["electricityUnitsConsumed", "govDeduction_water", "daArrear"], rowPayload: mine }];
};

(async () => {
  const baseRows = () => new Map<string, Row>([[EMP, storedRow()], [OTHER, { ...storedRow(), employeeUserId: OTHER }]]);

  // 1. Regression: units 80 + water + arrear typed, forced 409 (someone else saved), retry keeps everything.
  {
    const s = server();
    s.otherSession(EMP, (r) => { r.incentive = 500; }); // an unrelated field on the same employee
    s.otherSession(OTHER, (r) => { r.governmentMonthly.deductions.mess = 30; }); // and another employee
    const patches = typedPatch();
    const out = await saveDraftWithConflictRetry({
      patches, version: 1, base: baseRows(), send: (v) => s.send(patches, v), fetchLatest: s.fetchLatest,
    });
    assertEq(out.ok, true, "retry succeeds after the forced 409");
    assertEq(s.calls.sends, 2, "exactly one retry");
    const saved = s.rows.get(EMP)!;
    assertEq(saved.governmentMonthly.electricityUnitsConsumed, 80, "units survive");
    assertEq(saved.govRecalc.electricityUnitsConsumed, 80, "units survive in govRecalc");
    assertEq(saved.governmentMonthly.deductions.electricity, 98, "electricity follows the 80 units, not the old 49");
    assertEq(saved.governmentMonthly.deductions.water, 400, "typed water survives");
    assertEq(saved.governmentMonthly.deductions.mess, 25, "mess untouched by the user is unchanged");
    assertEq(saved.daArrear, 1000, "arrear survives");
    assertEq(saved.governmentMonthly.daArrearsPaid, 1000, "arrear line survives");
    assertEq(saved.incentive, 500, "the other session's change to a field the user did not touch is kept");
    assertEq(s.rows.get(OTHER)!.governmentMonthly.deductions.mess, 30, "another employee's merged change is kept");
    if (out.ok) {
      assertEq(out.conflicts, [], "no true conflict");
      assertEq(out.changedElsewhere.sort(), [EMP, OTHER].sort(), "reports employees changed elsewhere");
    }
  }

  // 2. A field both sides changed: the user's value wins and the conflict is reported.
  {
    const s = server();
    s.otherSession(EMP, (r) => { r.governmentMonthly.deductions.water = 500; });
    const patches = typedPatch();
    const out = await saveDraftWithConflictRetry({
      patches, version: 1, base: baseRows(), send: (v) => s.send(patches, v), fetchLatest: s.fetchLatest,
    });
    assertEq(out.ok, true, "true conflict still saves");
    assertEq(s.rows.get(EMP)!.governmentMonthly.deductions.water, 400, "typed water wins");
    if (out.ok) {
      assertEq(out.conflicts.map((c) => [c.employeeUserId, c.field, c.base, c.mine, c.theirs]), [[EMP, "govDeduction_water", 314, 400, 500]], "conflict reported with all three values");
    }
  }

  // 3. Persistent 409: bounded, nothing mutated, caller still owns every typed value.
  {
    const patches = typedPatch();
    const snapshot = JSON.stringify(patches);
    let sends = 0;
    const out = await saveDraftWithConflictRetry({
      patches, version: 1, base: baseRows(),
      send: async () => { sends++; return { status: 409, body: { message: "busy" } }; },
      fetchLatest: async () => ({ version: 9, rows: new Map() }),
    });
    assertEq(out.ok, false, "gives up");
    assertEq(sends, 3, "bounded retries (1 + 2)");
    assertEq(JSON.stringify(patches), snapshot, "typed patch untouched");
    if (!out.ok) assertEq(out.status, 409, "reports the conflict");
  }

  // 4. No retry for a first save (nothing to merge) or for non-409 errors; no latest fetch either.
  {
    const patches = typedPatch();
    let fetches = 0;
    const first = await saveDraftWithConflictRetry({
      patches, version: undefined, base: new Map(), maxRetries: 0,
      send: async () => ({ status: 409, body: {} }), fetchLatest: async () => { fetches++; return { version: 1, rows: new Map() }; },
    });
    assertEq(first.ok, false, "first-save conflict is surfaced");
    assertEq(fetches, 0, "no fetch when retries are 0");
    let sends = 0;
    const invalid = await saveDraftWithConflictRetry({
      patches, version: 1, base: new Map(),
      send: async () => { sends++; return { status: 422, body: { message: "Existing drafts accept patches for existing employees only" } }; },
      fetchLatest: async () => { throw new Error("must not fetch"); },
    });
    assertEq(invalid.ok, false, "422 surfaces");
    assertEq(sends, 1, "422 is not retried");
  }

  // 5. Keystrokes typed while the request is in flight stay marked as unsaved.
  {
    const masks = new Map<string, Set<string>>();
    const key = payrollRowCacheKey("2026-09", EMP);
    markPayrollDraftFieldEdited(masks, key, "electricityUnitsConsumed");
    markPayrollDraftFieldEdited(masks, key, "govDeduction_water");
    const sent = snapshotPayrollDraftMasks(masks);
    markPayrollDraftFieldEdited(masks, key, "electricityUnitsConsumed"); // typed again during the request
    markPayrollDraftFieldEdited(masks, key, "govDeduction_mess"); // a new field during the request
    const dirty = clearSavedPayrollDraftMasks(masks, sent);
    assertEq([...(masks.get(key) ?? [])].sort(), ["electricityUnitsConsumed", "govDeduction_mess"], "only the unsent edits remain marked");
    assertEq([...dirty], [key], "the row is still dirty");
    const sent2 = snapshotPayrollDraftMasks(masks);
    assertEq([...clearSavedPayrollDraftMasks(masks, sent2)], [], "nothing left once everything is saved");
    assertEq(masks.size, 0, "mask map emptied");
  }

  // 6. The stored-draft map uses the key every reader uses.
  {
    const periodKey = "2026-09";
    const map = draftStoredMapFromEmployees(periodKey, [{ employeeUserId: EMP, rowPayload: storedRow(), payDays: 30 }, { employeeUserId: "no-payload" }]);
    assertEq([...map.keys()], [payrollRowCacheKey(periodKey, EMP)], "keyed by period:employee, rows without a payload skipped");
    assertEq(storedRowsByEmployee(map).get(EMP)?.employeeUserId, EMP, "round-trips to employee-keyed rows");
  }

  // 7. Field lookup and conflict detection use the same token paths as the server.
  {
    const row = storedRow();
    assertEq(draftFieldValue(row, "govDeduction_water"), 314, "deduction token");
    assertEq(draftFieldValue(row, "electricityUnitsConsumed"), 0, "units token");
    assertEq(draftFieldValue(row, "daArrear"), 0, "arrear token");
    assertEq(findDraftConflicts(baseRows(), baseRows(), typedPatch()), [], "nothing changed elsewhere, nothing in conflict");
  }

  console.log("payrollDraftConflict.test.ts: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
