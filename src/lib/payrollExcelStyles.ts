/**
 * Shared Excel styling for CIRT Payroll workbooks (xlsx-js-style).
 * Presentation only — does not affect payroll totals.
 */

export type XlsxBorderStyle =
  | "thin"
  | "medium"
  | "thick"
  | "dotted"
  | "hair"
  | "double"
  | "dashed";

export type XlsxColor = { rgb: string };

export type XlsxBorderEdge = { style: XlsxBorderStyle; color: XlsxColor };

export type XlsxCellStyle = {
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    italic?: boolean;
    color?: XlsxColor;
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
    vertical?: "top" | "center" | "bottom";
    wrapText?: boolean;
  };
  border?: {
    top?: XlsxBorderEdge;
    bottom?: XlsxBorderEdge;
    left?: XlsxBorderEdge;
    right?: XlsxBorderEdge;
  };
  fill?: {
    patternType: "solid";
    fgColor: XlsxColor;
  };
  numFmt?: string;
};

export const PAYROLL_EXCEL_FONT = "Calibri";

/** Numeric rupee format. Excel applies locale grouping; Indian grouping is not portable. */
export const INR_NUM_FMT = '"₹"#,##0.00';
export const INT_NUM_FMT = "#,##0";

export const COLORS = {
  black: "000000",
  titleFill: "1F4E79",
  titleFont: "FFFFFF",
  sectionFill: "D6DCE4",
  headerFill: "E7E6E6",
  totalFill: "FFF2CC",
  grossFill: "DDEBF7",
  netFill: "C6EFCE",
  altRow: "F8F9FA",
  statusPreview: "FFF2CC",
  statusDraft: "DDEBF7",
  statusFinal: "C6EFCE",
} as const;

function edge(style: XlsxBorderStyle, rgb = COLORS.black): XlsxBorderEdge {
  return { style, color: { rgb } };
}

export function applyBorders(
  style: XlsxBorderStyle = "thin",
  sides: Array<"top" | "bottom" | "left" | "right"> = ["top", "bottom", "left", "right"],
): NonNullable<XlsxCellStyle["border"]> {
  const border: NonNullable<XlsxCellStyle["border"]> = {};
  for (const side of sides) {
    border[side] = edge(style);
  }
  return border;
}

export function applyReportTitleStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 15, bold: true, color: { rgb: COLORS.titleFont } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.titleFill } },
    border: applyBorders("medium"),
  };
}

export function applyMetaStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, italic: true },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
  };
}

export function applySectionHeaderStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 11, bold: true },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.sectionFill } },
    border: applyBorders("medium"),
  };
}

export function applyColumnHeaderStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, bold: true },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.headerFill } },
    border: applyBorders("thin"),
  };
}

export function applyBodyCellStyle(opts?: {
  align?: "left" | "right" | "center";
  alt?: boolean;
}): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10 },
    alignment: {
      horizontal: opts?.align ?? "left",
      vertical: "center",
      wrapText: true,
    },
    border: applyBorders("thin"),
    ...(opts?.alt
      ? { fill: { patternType: "solid" as const, fgColor: { rgb: COLORS.altRow } } }
      : {}),
  };
}

export function applyCurrencyCellStyle(opts?: { alt?: boolean; bold?: boolean }): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, bold: opts?.bold },
    alignment: { horizontal: "right", vertical: "center" },
    border: applyBorders("thin"),
    numFmt: INR_NUM_FMT,
    ...(opts?.alt
      ? { fill: { patternType: "solid" as const, fgColor: { rgb: COLORS.altRow } } }
      : {}),
  };
}

export function applyTotalRowStyle(variant: "total" | "gross" = "total"): XlsxCellStyle {
  const fill = variant === "gross" ? COLORS.grossFill : COLORS.totalFill;
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, bold: true },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    border: {
      top: edge("medium"),
      bottom: edge("medium"),
      left: edge("thin"),
      right: edge("thin"),
    },
  };
}

export function applyTotalCurrencyStyle(variant: "total" | "gross" = "total"): XlsxCellStyle {
  const fill = variant === "gross" ? COLORS.grossFill : COLORS.totalFill;
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, bold: true },
    alignment: { horizontal: "right", vertical: "center" },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    border: {
      top: edge("medium"),
      bottom: edge("medium"),
      left: edge("thin"),
      right: edge("thin"),
    },
    numFmt: INR_NUM_FMT,
  };
}

export function applyFinalNetRowStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 12, bold: true },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.netFill } },
    border: {
      top: edge("double"),
      bottom: edge("medium"),
      left: edge("medium"),
      right: edge("medium"),
    },
  };
}

export function applyFinalNetCurrencyStyle(): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 12, bold: true },
    alignment: { horizontal: "right", vertical: "center" },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.netFill } },
    border: {
      top: edge("double"),
      bottom: edge("medium"),
      left: edge("medium"),
      right: edge("medium"),
    },
    numFmt: INR_NUM_FMT,
  };
}

export function applyIntegerCellStyle(opts?: { bold?: boolean; fill?: string }): XlsxCellStyle {
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 10, bold: opts?.bold },
    alignment: { horizontal: "right", vertical: "center" },
    border: applyBorders("thin"),
    numFmt: INT_NUM_FMT,
    ...(opts?.fill
      ? { fill: { patternType: "solid" as const, fgColor: { rgb: opts.fill } } }
      : {}),
  };
}

export function applyStatusBannerStyle(kind: "preview" | "draft" | "final"): XlsxCellStyle {
  const fill =
    kind === "final" ? COLORS.statusFinal : kind === "draft" ? COLORS.statusDraft : COLORS.statusPreview;
  return {
    font: { name: PAYROLL_EXCEL_FONT, sz: 11, bold: true },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    border: applyBorders("medium"),
  };
}

export function writeStyledCell(
  encodeCell: (addr: { r: number; c: number }) => string,
  ws: Record<string, unknown>,
  row0: number,
  col0: number,
  value: string | number | null | undefined,
  style?: XlsxCellStyle,
): void {
  const ref = encodeCell({ r: row0, c: col0 });
  const cell: { t: string; v: string | number; s?: XlsxCellStyle; z?: string } =
    typeof value === "number"
      ? { t: "n", v: value }
      : { t: "s", v: value == null ? "" : String(value) };
  if (style) {
    cell.s = style;
    if (style.numFmt) cell.z = style.numFmt;
  }
  ws[ref] = cell;
}

export function mergeCells(
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): void {
  merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
}

export function autoFitColumnsWithLimits(
  widths: number[],
  opts?: { min?: number; max?: number },
): Array<{ wch: number }> {
  const min = opts?.min ?? 8;
  const max = opts?.max ?? 42;
  return widths.map((w) => ({ wch: Math.min(max, Math.max(min, Math.ceil(w))) }));
}

export function configurePayrollPrintSetup(
  ws: Record<string, unknown>,
  opts: {
    lastRow0: number;
    lastCol0: number;
    freezeRows?: number;
    landscape?: boolean;
    titleRows?: number;
    autoFilterRef?: string;
  },
): void {
  const lastColLetter = colLetter(opts.lastCol0);
  const printArea = `A1:${lastColLetter}${opts.lastRow0 + 1}`;

  ws["!margins"] = {
    left: 0.4,
    right: 0.4,
    top: 0.5,
    bottom: 0.5,
    header: 0.25,
    footer: 0.25,
  };

  ws["!pageSetup"] = {
    paperSize: 9, // A4
    orientation: opts.landscape === false ? "portrait" : "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    scale: 100,
  };

  (ws as { "!printHeader"?: string[] })["!printHeader"] = ["&C&B CIRT Payroll"];
  (ws as { "!printFooter"?: string[] })["!printFooter"] = ["&CPage &P of &N"];
  (ws as { "!printArea"?: string })["!printArea"] = printArea;

  if (opts.titleRows && opts.titleRows > 0) {
    (ws as { "!printTitlesRows"?: string })["!printTitlesRows"] = `1:${opts.titleRows}`;
  }

  if (opts.autoFilterRef) {
    (ws as { "!autofilter"?: { ref: string } })["!autofilter"] = { ref: opts.autoFilterRef };
  }

  const freezeRows = opts.freezeRows ?? 0;
  ws["!views"] = [
    {
      state: freezeRows > 0 ? "frozen" : "normal",
      ySplit: freezeRows,
      topLeftCell: freezeRows > 0 ? `A${freezeRows + 1}` : "A1",
      activePane: freezeRows > 0 ? "bottomLeft" : "topLeft",
      showGridLines: false,
      zoomScale: 95,
    },
  ];

  // Required: without !ref, SheetJS writeFile emits an empty sheet.
  ws["!ref"] = printArea;
}

export function colLetter(col0: number): string {
  let n = col0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function pairItems<T>(items: T[]): Array<[T | null, T | null]> {
  const pairs: Array<[T | null, T | null]> = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push([items[i] ?? null, items[i + 1] ?? null]);
  }
  return pairs;
}
