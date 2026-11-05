export type DraftAuditEmployee = {
  employeeCode?: string | null;
  employeeUserId?: string;
  reason?: string;
  changes?: Record<string, { previous: unknown; new: unknown }>;
};

export type DraftAuditDetailLine = { key: string; text: string };

/**
 * The detail lines shown under an audit entry's action. Entries with field changes list each change (with the reason, if any).
 * Entries without field changes (e.g. `draft_copied`, one entry per employee carrying the same note) show each distinct
 * reason once, so the note is visible without repeating it for every employee.
 */
export function draftAuditDetailLines(employees: DraftAuditEmployee[] | undefined): DraftAuditDetailLine[] {
  const lines: DraftAuditDetailLine[] = [];
  const notes = new Set<string>();
  (employees ?? []).forEach((employee, index) => {
    const changes = Object.entries(employee.changes ?? {});
    if (changes.length === 0) {
      const note = employee.reason?.trim();
      if (note && !notes.has(note)) {
        notes.add(note);
        lines.push({ key: `note-${notes.size}`, text: note });
      }
      return;
    }
    for (const [field, change] of changes) {
      lines.push({
        key: `${employee.employeeUserId ?? index}-${field}`,
        text: `${employee.employeeCode ?? employee.employeeUserId}: ${field} ${String(change.previous ?? "—")} → ${String(change.new ?? "—")}${employee.reason ? ` (${employee.reason})` : ""}`,
      });
    }
  });
  return lines;
}
