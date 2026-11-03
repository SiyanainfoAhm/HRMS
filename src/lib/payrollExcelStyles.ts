import { MONEY_EXCEL_FORMAT } from "./money";
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
export const INR_NUM_FMT = `"₹"${MONEY_EXCEL_FORMAT}`;
/** Counts / quantities that may be large: grouped, no decimals. */
export const INT_NUM_FMT = "#,##0";
/** Plain whole-number identifiers (Year, YYYYMM, codes, pay days, pay level): never a thousands separator. */
export const ID_NUM_FMT = "0";

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

/** Like applyIntegerCellStyle but for identifiers and day counts: format '0', so 2026 is never "2,026". */
export function applyIdentifierCellStyle(opts?: { bold?: boolean; fill?: string }): XlsxCellStyle {
  return { ...applyIntegerCellStyle(opts), numFmt: ID_NUM_FMT };
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

/** Decimals / prefix / grouping / percent implied by an Excel number format code. */
function numberFormatShape(z: string | undefined): { decimals: number; prefix: number; grouping: boolean; percent: boolean } {
  const code = (z ?? "").split(";")[0];
  const dec = /\.(0+)/.exec(code);
  return {
    decimals: dec ? dec[1].length : 0,
    prefix: /["₹$]/.test(code) ? 1 : 0,
    grouping: code.includes(","),
    percent: code.includes("%"),
  };
}

/** Characters Excel needs to render a cell, estimated from its value and number format. */
export function renderedCellLength(cell: { v?: unknown; z?: string } | undefined): number {
  if (!cell || cell.v == null || cell.v === "") return 0;
  if (typeof cell.v === "number") {
    const shape = numberFormatShape(cell.z);
    const v = shape.percent ? cell.v * 100 : cell.v;
    const text = Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: shape.decimals,
      maximumFractionDigits: shape.decimals,
      useGrouping: shape.grouping,
    });
    return text.length + (v < 0 ? 1 : 0) + shape.prefix + (shape.percent ? 1 : 0);
  }
  return String(cell.v)
    .split("\n")
    .reduce((m, line) => Math.max(m, line.length), 0);
}

/**
 * Shared sheet finisher: per-column width from the longest of header and values (plus padding),
 * clamped to [min, max]. Rows above `firstRow0` (merged titles) are ignored. A formula cell with no
 * cached value counts as the widest number in its column plus 3 (a total is larger than its parts).
 */
export function contentColumnWidths(
  ws: Record<string, unknown>,
  opts: { firstRow0: number; lastRow0: number; lastCol0: number; min?: number; max?: number; padding?: number },
): Array<{ wch: number }> {
  const min = opts.min ?? 8;
  const max = opts.max ?? 50;
  const padding = opts.padding ?? 2;
  const out: Array<{ wch: number }> = [];
  for (let c = 0; c <= opts.lastCol0; c++) {
    let widest = 0;
    let widestNumber = 0;
    let hasFormula = false;
    for (let r = opts.firstRow0; r <= opts.lastRow0; r++) {
      const cell = ws[`${colLetter(c)}${r + 1}`] as { v?: unknown; z?: string; f?: string } | undefined;
      if (!cell) continue;
      if (cell.f && (cell.v == null || cell.v === "")) {
        hasFormula = true;
        continue;
      }
      const len = renderedCellLength(cell) * (r === opts.firstRow0 ? 1.15 : 1);
      widest = Math.max(widest, len);
      if (typeof cell.v === "number") widestNumber = Math.max(widestNumber, len);
    }
    if (hasFormula) widest = Math.max(widest, widestNumber + 3);
    out.push({ wch: Math.min(max, Math.max(min, Math.ceil(widest + padding))) });
  }
  return out;
}

export function configurePayrollPrintSetup(
  ws: Record<string, unknown>,
  opts: {
    lastRow0: number;
    lastCol0: number;
    freezeCols?: number;
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
  const freezeCols = opts.freezeCols ?? 0;
  const frozen = freezeRows > 0 || freezeCols > 0;
  ws["!views"] = [
    {
      state: frozen ? "frozen" : "normal",
      ySplit: freezeRows,
      xSplit: freezeCols,
      topLeftCell: frozen ? `${colLetter(freezeCols)}${freezeRows + 1}` : "A1",
      activePane:
        freezeRows > 0 && freezeCols > 0 ? "bottomRight" : freezeCols > 0 ? "topRight" : freezeRows > 0 ? "bottomLeft" : "topLeft",
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
