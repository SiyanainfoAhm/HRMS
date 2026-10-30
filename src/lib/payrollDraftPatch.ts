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
