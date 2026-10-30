export type PayrollDraftRowForSave = Record<string, unknown> & { employeeUserId: string };

/** Track operator intent separately from row values so an intentional 0 is explicit. */
export function markPayrollDraftFieldEdited(
  changedByRow: Map<string, Set<string>>,
  rowKey: string,
  field: string,
): void {
  const changed = changedByRow.get(rowKey) ?? new Set<string>();
  changed.add(field);
  changedByRow.set(rowKey, changed);
  bumpEditSeq(changedByRow, rowKey, field);
}

// Every edit of a field bumps a counter, so a save can tell "saved as typed" from
// "typed again while the request was in flight".
const editSeq = new WeakMap<Map<string, Set<string>>, Map<string, number>>();

function seqKey(rowKey: string, field: string): string {
  return `${rowKey}\u0000${field}`;
}

function bumpEditSeq(changedByRow: Map<string, Set<string>>, rowKey: string, field: string): void {
  const seqs = editSeq.get(changedByRow) ?? new Map<string, number>();
  seqs.set(seqKey(rowKey, field), (seqs.get(seqKey(rowKey, field)) ?? 0) + 1);
  editSeq.set(changedByRow, seqs);
}

export type PayrollDraftMaskSnapshot = Map<string, number>;

/** Remember which edits (and how many times each was typed) this save is about to send. */
export function snapshotPayrollDraftMasks(changedByRow: Map<string, Set<string>>): PayrollDraftMaskSnapshot {
  const snap: PayrollDraftMaskSnapshot = new Map();
  const seqs = editSeq.get(changedByRow);
  for (const [rowKey, fields] of changedByRow) {
    for (const field of fields) snap.set(seqKey(rowKey, field), seqs?.get(seqKey(rowKey, field)) ?? 0);
  }
  return snap;
}

/**
 * After a successful save, forget only the edits that were saved exactly as sent.
 * A field typed again during the request stays marked as unsaved. Returns the row
 * keys that still have unsaved edits.
 */
export function clearSavedPayrollDraftMasks(
  changedByRow: Map<string, Set<string>>,
  saved: PayrollDraftMaskSnapshot,
): Set<string> {
  const seqs = editSeq.get(changedByRow);
  const stillDirty = new Set<string>();
  for (const [rowKey, fields] of [...changedByRow]) {
    for (const field of [...fields]) {
      const key = seqKey(rowKey, field);
      if (saved.has(key) && (seqs?.get(key) ?? 0) === saved.get(key)) {
        fields.delete(field);
        seqs?.delete(key);
      }
    }
    if (fields.size === 0) changedByRow.delete(rowKey);
    else stillDirty.add(rowKey);
  }
  return stillDirty;
}

/**
 * Initial draft creation takes a full snapshot. Existing drafts send only
 * employee rows and field tokens edited in this browser session; an empty mask
 * never means clear or replace.
 */
export function rowsForPayrollDraftSave<T extends PayrollDraftRowForSave>(
  rows: T[],
  existingDraft: boolean,
  changedByRow: Map<string, Set<string>>,
  rowKeyFor: (employeeUserId: string) => string,
): Array<T & { changedFields?: string[] }> {
  if (!existingDraft) return rows;
  return rows.flatMap((row) => {
    const changedFields = changedByRow.get(rowKeyFor(row.employeeUserId));
    return changedFields?.size ? [{ ...row, changedFields: [...changedFields] }] : [];
  });
}

/**
 * True when the screen holds edits that are not in the saved draft. Derived from the
 * edit masks themselves (what a save would send), not from a React flag that can drift.
 */
export function hasUnsavedDraftEdits(
  changedByRow: Map<string, Set<string>>,
  editedRowKeys: Set<string>,
  dirtyFlag: boolean,
): boolean {
  for (const fields of changedByRow.values()) if (fields.size > 0) return true;
  return dirtyFlag || editedRowKeys.size > 0;
}

export type GenerateGate = { proceed: true } | { proceed: false; message: string };

/**
 * Generate payroll must never run on, or throw away, edits that are only in the
 * browser. With unsaved edits it asks, saves the draft (merge-and-retry), and then
 * re-checks: anything typed while the save was running blocks Generate with a clear
 * message instead of slipping past the check.
 */
export async function ensureDraftSavedBeforeGenerate(opts: {
  hasUnsaved: () => boolean;
  confirmSave: () => boolean;
  save: () => Promise<boolean>;
}): Promise<GenerateGate> {
  if (!opts.hasUnsaved()) return { proceed: true };
  if (!opts.confirmSave()) {
    return { proceed: false, message: "Generate cancelled. Your edits are still on screen and unsaved; use Save Draft first." };
  }
  const saved = await opts.save();
  if (!saved) {
    return { proceed: false, message: "The draft could not be saved, so payroll was not generated. Your edits are still on screen; fix the problem shown and press Save Draft." };
  }
  if (opts.hasUnsaved()) {
    return { proceed: false, message: "You changed values while the draft was saving. Press Save Draft once more, then Generate." };
  }
  return { proceed: true };
}
