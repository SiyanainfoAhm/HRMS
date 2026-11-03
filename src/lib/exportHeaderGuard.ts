/**
 * Export-header guard (TS side). Every header of an Excel export must be a non-empty, non-numeric string:
 * a blank, null, 0 or numeric header is a column-definition bug (a leftover placeholder slot), so building
 * the export fails loudly instead of shipping a column nobody can name. The PHP twin is
 * SpreadsheetLayout::assertHeaders().
 */

/** Positions of the headers that are not a non-empty, non-numeric string. */
export function invalidHeaderPositions(headers: readonly unknown[]): number[] {
  const bad: number[] = [];
  headers.forEach((h, i) => {
    if (typeof h !== "string" || h.trim() === "" || Number.isFinite(Number(h.trim()))) bad.push(i);
  });
  return bad;
}

export function assertExportHeaders(headers: readonly unknown[], where: string): void {
  const bad = invalidHeaderPositions(headers);
  if (bad.length > 0) {
    throw new Error(`Export '${where}' has invalid header(s) at position(s) ${bad.join(", ")}: every header must be a non-empty, non-numeric string.`);
  }
}
