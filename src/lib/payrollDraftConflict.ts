/**
 * Run Payroll draft save conflicts (HTTP 409).
 *
 * The draft API is already field-level: an existing draft accepts, per employee, the
 * edited row plus `changedFields`, and the server applies ONLY those fields onto the
 * stored row. So merging after a 409 means: fetch the latest draft version, then send
 * the same patch again against it. The user's touched fields win; every field the user
 * did not touch keeps the latest stored value (another session's work is not lost).
 * This module adds the parts the screen needs around that: bounded retries, an
 * honest report of true conflicts, and keystroke-safe clearing of the edit masks.
 */

export type DraftPatchRow = {
  employeeUserId: string;
  changedFields?: string[];
  rowPayload?: Record<string, unknown> | null;
};

export type DraftConflict = {
  employeeUserId: string;
  field: string;
  /** Value when the user loaded the draft. */
  base: unknown;
  /** The user's typed value. */
  mine: unknown;
  /** The value another session saved meanwhile. */
  theirs: unknown;
};

export type LatestDraft = {
  draftId?: string;
  version: number | undefined;
  /** employeeUserId -> stored row payload */
  rows: Map<string, Record<string, unknown>>;
};

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

/** Where a changed-field token lives inside a row payload (mirrors PayrollDraftService::applyChangedFields). */
export function draftFieldValue(payload: Rec | null | undefined, token: string): unknown {
  const p = asRec(payload);
  const gm = asRec(p.governmentMonthly);
  const gr = asRec(p.govRecalc);
  if (token.startsWith("govDeduction_")) return asRec(gm.deductions)[token.slice("govDeduction_".length)];
  if (token.startsWith("govEarning_")) return gm[token.slice("govEarning_".length)];
  if (token.startsWith("govCustomDeduction_")) return asRec(gm.customDeductions)[token.slice("govCustomDeduction_".length)];
  if (token.startsWith("govCustom_")) return asRec(gm.customEarnings)[token.slice("govCustom_".length)];
  if (["electricityUnitsConsumed", "nightHours", "nightAllowanceRate", "hplDays", "eolDays", "leaveLines", "leaveRemarks"].includes(token)) {
    return gr[token] ?? gm[token];
  }
  return p[token] ?? gm[token];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Fields the user touched where another session saved a different value than both the base and the user's. */
export function findDraftConflicts(
  base: Map<string, Rec>,
  latest: Map<string, Rec>,
  patches: DraftPatchRow[],
): DraftConflict[] {
  const out: DraftConflict[] = [];
  for (const patch of patches) {
    const uid = patch.employeeUserId;
    for (const field of patch.changedFields ?? []) {
      const baseV = draftFieldValue(base.get(uid), field);
      const mine = draftFieldValue(patch.rowPayload ?? undefined, field);
      const theirs = draftFieldValue(latest.get(uid), field);
      if (!same(theirs, baseV) && !same(theirs, mine)) out.push({ employeeUserId: uid, field, base: baseV, mine, theirs });
    }
  }
  return out;
}

/** Employees whose stored row changed since the user loaded it (their untouched fields are merged in by the server). */
export function employeesChangedElsewhere(base: Map<string, Rec>, latest: Map<string, Rec>): string[] {
  const ids: string[] = [];
  for (const [uid, row] of latest) {
    if (base.has(uid) && !same(base.get(uid), row)) ids.push(uid);
  }
  return ids;
}

export type DraftSendResult = { status: number; body: Rec };

export type DraftSaveOutcome =
  | { ok: true; body: Rec; version: number | undefined; conflicts: DraftConflict[]; changedElsewhere: string[]; retries: number }
  | { ok: false; status: number; error: string; body: Rec; version: number | undefined; conflicts: DraftConflict[]; retries: number };

/**
 * Send the patch; on a 409 fetch the latest draft and send the SAME patch against its
 * version (the server keeps the user's touched fields and everything else as stored).
 * The patch rows are never modified or discarded, so a persistent failure leaves every
 * typed value with the caller.
 */
export async function saveDraftWithConflictRetry(opts: {
  patches: DraftPatchRow[];
  version: number | undefined;
  /** Stored rows as the user last saw them (to tell a true conflict from a harmless merge). */
  base: Map<string, Rec>;
  send: (version: number | undefined) => Promise<DraftSendResult>;
  fetchLatest: () => Promise<LatestDraft>;
  maxRetries?: number;
}): Promise<DraftSaveOutcome> {
  let version = opts.version;
  const retriesAllowed = opts.maxRetries ?? 2;
  let conflicts: DraftConflict[] = [];
  let changedElsewhere: string[] = [];
  for (let attempt = 0; attempt <= retriesAllowed; attempt++) {
    const res = await opts.send(version);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, body: res.body, version: Number((asRec(res.body.draft)).version ?? version) || version, conflicts, changedElsewhere, retries: attempt };
    }
    if (res.status !== 409 || attempt === retriesAllowed) {
      const error = String(res.body?.message ?? res.body?.error ?? "Failed to save draft");
      return { ok: false, status: res.status, error, body: res.body, version, conflicts, retries: attempt };
    }
    const latest = await opts.fetchLatest();
    conflicts = findDraftConflicts(opts.base, latest.rows, opts.patches);
    changedElsewhere = employeesChangedElsewhere(opts.base, latest.rows);
    version = latest.version;
  }
  return { ok: false, status: 409, error: "Failed to save draft", body: {}, version, conflicts, retries: retriesAllowed };
}

export type DraftEmployeeApi = Record<string, unknown>;

/**
 * Stored-draft lookup for the screen: keyed by `${periodKey}:${employeeUserId}`
 * (payrollRowCacheKey), the key every reader uses. The save path used to key by the
 * bare employee id, so right after Save the screen could not find the draft it had
 * just saved and re-resolved rows from the calculated preview instead.
 */
export function draftStoredMapFromEmployees(
  periodKey: string,
  employees: DraftEmployeeApi[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const emp of employees) {
    const uid = String(emp.employeeUserId ?? emp.employee_user_id ?? "");
    const payload = (emp.rowPayload ?? emp.row_payload ?? null) as Record<string, unknown> | null;
    if (!uid || !payload) continue;
    map.set(`${periodKey}:${uid}`, {
      employeeUserId: uid,
      employeeCode: emp.employeeCode ?? emp.employee_code ?? null,
      payrollMasterId: emp.payrollMasterId ?? emp.payroll_master_id ?? null,
      payDays: emp.payDays ?? emp.pay_days ?? null,
      grossPay: emp.grossPay ?? emp.gross_pay ?? null,
      totalEarnings: emp.totalEarnings ?? emp.total_earnings ?? null,
      totalDeductions: emp.totalDeductions ?? emp.total_deductions ?? null,
      totalArrears: emp.totalArrears ?? emp.total_arrears ?? null,
      netPay: emp.netPay ?? emp.net_pay ?? null,
      remarks: emp.remarks ?? null,
      rowPayload: payload,
    });
  }
  return map;
}

/** employeeUserId -> stored row payload, from a stored-draft map. */
export function storedRowsByEmployee(stored: Map<string, Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const value of stored.values()) {
    const uid = String(value.employeeUserId ?? "");
    const payload = value.rowPayload as Record<string, unknown> | null | undefined;
    if (uid && payload) out.set(uid, payload);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generate: use the latest saved draft, and say what another session changed.
// ---------------------------------------------------------------------------

export type ExternalDraftChange = { employeeUserId: string; field: string; before: unknown; after: unknown };

const DERIVED_BY: Record<string, string[]> = {
  // Editing these moves other stored figures with them; those are not "another session" changes.
  electricityUnitsConsumed: ["govDeduction_electricity"],
  daArrear: ["govEarning_daArrearsPaid", "grossArrear", "cpfArrear", "netArrear"],
  transportArrear: ["govEarning_transportArrearsPaid", "grossArrear", "cpfArrear", "netArrear"],
  grossArrear: ["cpfArrear", "netArrear"],
};

/** Every editable field token present in a stored row. */
export function draftTokensOf(payload: Record<string, unknown> | null | undefined): string[] {
  const p = asRec(payload);
  const gm = asRec(p.governmentMonthly);
  const out = new Set<string>([
    "payDays", "incentive", "prBonus", "reimbursement", "tds", "daArrear", "transportArrear", "grossArrear", "cpfArrear",
    "netArrear", "electricityUnitsConsumed", "nightHours", "nightAllowanceRate", "hplDays", "eolDays", "leaveLines", "leaveRemarks",
  ]);
  for (const k of Object.keys(asRec(gm.deductions))) out.add(`govDeduction_${k}`);
  for (const k of Object.keys(gm)) if (/Paid$/.test(k)) out.add(`govEarning_${k}`);
  for (const k of Object.keys(asRec(gm.customEarnings))) out.add(`govCustom_${k}`);
  for (const k of Object.keys(asRec(gm.customDeductions))) out.add(`govCustomDeduction_${k}`);
  return [...out];
}

/**
 * Fields whose saved value differs between what the screen showed and the latest
 * draft, excluding anything the user edited (their values are already in the latest
 * draft, so they win) and the figures derived from those edits.
 */
export function externalDraftChanges(
  shown: Map<string, Rec>,
  latest: Map<string, Rec>,
  userEdited: Map<string, Set<string>>,
): ExternalDraftChange[] {
  const out: ExternalDraftChange[] = [];
  for (const [uid, latestRow] of latest) {
    const shownRow = shown.get(uid);
    if (!shownRow) continue; // a row the screen never had cannot be "changed" for it
    const edited = new Set(userEdited.get(uid) ?? []);
    for (const token of [...edited]) for (const d of DERIVED_BY[token] ?? []) edited.add(d);
    const tokens = new Set([...draftTokensOf(shownRow), ...draftTokensOf(latestRow)]);
    for (const token of tokens) {
      if (edited.has(token)) continue;
      const before = draftFieldValue(shownRow, token);
      const after = draftFieldValue(latestRow, token);
      if (!same(before, after)) out.push({ employeeUserId: uid, field: token, before, after });
    }
  }
  return out;
}

export type GenerateSource<T> =
  | { proceed: true; latest: T; changes: ExternalDraftChange[] }
  | { proceed: false; message: string; changes: ExternalDraftChange[] };

/**
 * After the pre-Generate save: re-fetch the latest draft, and if another session
 * changed values the user did not edit, list them and ask. Cancel blocks Generate.
 * With nothing changed there is no extra prompt.
 */
export async function chooseLatestDraftForGenerate<T extends { rows: Map<string, Rec> }>(opts: {
  shown: Map<string, Rec>;
  userEdited: Map<string, Set<string>>;
  fetchLatest: () => Promise<T>;
  confirmChanges: (changes: ExternalDraftChange[]) => boolean;
}): Promise<GenerateSource<T>> {
  const latest = await opts.fetchLatest();
  const changes = externalDraftChanges(opts.shown, latest.rows, opts.userEdited);
  if (changes.length > 0 && !opts.confirmChanges(changes)) {
    return { proceed: false, changes, message: "Generate cancelled because another session changed saved values. Nothing was generated; review the screen and try again." };
  }
  return { proceed: true, latest, changes };
}

/** "Name: Water 314 → 350" lines for the confirmation, capped. */
export function describeExternalChanges(
  changes: ExternalDraftChange[],
  nameOf: (uid: string) => string,
  max = 8,
): string {
  const label = (t: string) =>
    t
      .replace(/^gov(Deduction|Earning|CustomDeduction|Custom)_/, "")
      .replace(/Paid$/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  const lines = changes
    .slice(0, max)
    .map((c) => `• ${nameOf(c.employeeUserId)}: ${label(c.field)} ${JSON.stringify(c.before ?? "—")} → ${JSON.stringify(c.after ?? "—")}`);
  if (changes.length > max) lines.push(`…and ${changes.length - max} more`);
  return lines.join("\n");
}
