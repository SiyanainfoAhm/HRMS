/**
 * Run: npx --yes tsx src/lib/payrollMasterConflict.test.ts
 *
 * Regression: an autosave/manual-save 409 must never throw away what the user typed.
 */
import { applyServerFields, mergeMasterForms, saveWithConflictRetry } from "./payrollMasterAutosave";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

type Form = Record<string, unknown>;
const base: Form = { name: "Asha", phone: "9000000000", water: "314", mess: "25", email: "a@x.in" };

// Fake server with optimistic revisions.
function server(initial: Form) {
  let rev = 1;
  let data = { ...initial };
  const calls = { sends: 0, fetches: 0 };
  return {
    calls,
    get data() { return data; },
    other(change: Form) { data = { ...data, ...change }; rev++; },
    send: async (form: Form, revision: string | undefined) => {
      calls.sends++;
      if (revision !== `r${rev}`) return { status: 409, body: { message: "Payroll was updated in another tab or session." } };
      data = { ...form };
      rev++;
      return { status: 200, body: { master: { revision: `r${rev}` } } };
    },
    fetchLatest: async () => { calls.fetches++; return { form: { ...data }, revision: `r${rev}` }; },
  };
}

(async () => {
  // 1. Another session changed the phone while the user typed a new water amount.
  {
    const s = server(base);
    s.other({ phone: "9111111111" });
    const mine = { ...base, water: "400" };
    const r = await saveWithConflictRetry({ mine, base, revision: "r1", send: s.send, fetchLatest: s.fetchLatest });
    assertEq(r.ok, true, "retry succeeds after a 409");
    assertEq(s.data.water, "400", "typed water is saved");
    assertEq(s.data.phone, "9111111111", "the other session's change is merged, not overwritten");
    assertEq(s.calls.sends, 2, "one retry");
    if (r.ok) assertEq(r.report?.takenFromTheirs, ["phone"], "report names the merged field");
  }

  // 2. Same field edited on both sides: the user's value is kept and flagged.
  {
    const s = server(base);
    s.other({ water: "500" });
    const r = await saveWithConflictRetry({ mine: { ...base, water: "400" }, base, revision: "r1", send: s.send, fetchLatest: s.fetchLatest });
    assertEq(r.ok, true, "conflict still resolves");
    assertEq(s.data.water, "400", "typed value wins on a true conflict");
    if (r.ok) assertEq(r.report?.conflicts, ["water"], "conflict reported");
  }

  // 3. Persistent failure: nothing is lost, the caller still holds the typed values.
  {
    const mine = { ...base, water: "400", mess: "0" };
    let n = 0;
    const r = await saveWithConflictRetry({
      mine, base, revision: "r1",
      send: async () => { n++; return { status: 409, body: { message: "busy" } }; },
      fetchLatest: async () => ({ form: { ...base }, revision: "r9" }),
    });
    assertEq(r.ok, false, "gives up after the retries");
    assertEq(r.form.water, "400", "typed water kept");
    assertEq(r.form.mess, "0", "an intentional 0 is kept");
    assertEq(n, 3, "bounded retries");
  }

  // 4. Non-409 errors are not retried.
  {
    let n = 0;
    const r = await saveWithConflictRetry({
      mine: base, base, revision: "r1",
      send: async () => { n++; return { status: 422, body: { message: "Email is required" } }; },
      fetchLatest: async () => { throw new Error("must not fetch"); },
    });
    assertEq(r.ok, false, "validation error surfaces");
    assertEq(n, 1, "no retry on 422");
  }

  // 5. Merge is field-wise; passwords are never taken from the server.
  {
    const m = mergeMasterForms({ a: "1", b: "2", password: "" }, { a: "1", b: "9", password: "secret" }, { a: "7", b: "2", password: "x" });
    assertEq(m.merged, { a: "7", b: "9", password: "secret" }, "field-wise merge");
    assertEq(m.keptMine, ["b"], "kept mine");
    assertEq(m.takenFromTheirs, ["a"], "took theirs");
  }

  // 6. Keystrokes typed while the request was in flight survive the merge.
  {
    const sent: Form = { ...base, water: "400" };
    const report = mergeMasterForms(base, sent, { ...base, phone: "9111111111" });
    const nowOnScreen = { ...sent, mess: "30", water: "4000" }; // user kept typing
    const next = applyServerFields(nowOnScreen, sent, report);
    assertEq(next.phone, "9111111111", "server change applied");
    assertEq(next.water, "4000", "newer keystrokes untouched");
    assertEq(next.mess, "30", "newer keystrokes untouched");
    const typedPhoneToo = applyServerFields({ ...nowOnScreen, phone: "9222222222" }, sent, report);
    assertEq(typedPhoneToo.phone, "9222222222", "a field the user changed meanwhile is not overwritten by the server value");
  }

  console.log("payrollMasterConflict.test.ts: all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
