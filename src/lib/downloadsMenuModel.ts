import { formatMonthLabel, isValidYm } from "@/lib/dateInputs";
import { POST_PAYROLL_REPORTS, type PostPayrollReportType } from "@/lib/postPayrollDownload";

/**
 * Pure model of the Run Payroll "Downloads" menu: which items exist, whether each is enabled (and why not),
 * keyboard navigation, the TDS range rule and the phone layout switch. The React component only renders this.
 */

export type BankLetterFormatId = "docx" | "xlsx" | "pdf";

export type MenuItemId =
  | "preview-excel"
  | "extract"
  | "export-employee-payroll"
  | `bank-${BankLetterFormatId}`
  | `report-${PostPayrollReportType}`;

export type MenuSubmenuId = "bank" | "reports";

export type MenuContext = {
  /** Admin-only features (Export Employee Payroll, post-payroll reports), exactly as the old buttons/page. */
  canManage: boolean;
  /** Something is saving / generating / loading. */
  running: boolean;
  /** Same condition the old Preview Excel / Extract / Bank Letter buttons used: no preview or draft to export. */
  exportDisabled: boolean;
  /** Bank letter is being built (existing flag). */
  bankLetterLoading: boolean;
  /** The selected month's payroll is generated (and the loaded preview belongs to that month). */
  generated: boolean;
  /** Selected month, "YYYY-MM" (read from the page selectors). */
  ym: string;
};

export type MenuItem = {
  id: MenuItemId;
  label: string;
  description?: string;
  /** Tag shown on the right. */
  tag: "Excel" | "Letter";
  /** null = enabled; otherwise the tooltip explaining why not. */
  disabledReason: string | null;
};

export type DownloadsMenuModel = {
  payroll: MenuItem[];
  bank: MenuItem[];
  /** Only present for roles allowed to use the post-payroll reports. */
  reports: MenuItem[] | null;
  /** Shown above the reports when they are disabled. */
  reportsHint: string | null;
};

export const REASON_NOTHING_TO_EXPORT = "Nothing to export yet. Calculate the payroll or save a draft first.";
export const REASON_BUSY = "Please wait for the current action to finish.";
export const REASON_NOT_GENERATED = "Generate payroll for this month first.";
export const REASON_BANK_BUSY = "A bank letter is already being prepared.";

const BANK_FORMATS: ReadonlyArray<{ id: BankLetterFormatId; label: string; description: string; tag: "Excel" | "Letter" }> = [
  { id: "docx", label: "Word document", description: ".docx · HDFC letter template", tag: "Letter" },
  { id: "xlsx", label: "Excel workbook", description: ".xlsx · employee salary table", tag: "Excel" },
  { id: "pdf", label: "PDF letter", description: ".pdf · printable advice", tag: "Letter" },
];

export function monthKey(runYear: string | number, runMonth: string | number): string {
  const y = String(runYear).padStart(4, "0");
  const m = String(Number(runMonth)).padStart(2, "0");
  return `${y}-${m}`;
}

export function buildDownloadsMenu(ctx: MenuContext): DownloadsMenuModel {
  const exportReason = ctx.running ? REASON_BUSY : ctx.exportDisabled ? REASON_NOTHING_TO_EXPORT : null;
  const bankReason = ctx.running ? REASON_BUSY : ctx.exportDisabled ? REASON_NOTHING_TO_EXPORT : ctx.bankLetterLoading ? REASON_BANK_BUSY : null;
  const reportReason = ctx.running ? REASON_BUSY : !ctx.generated ? REASON_NOT_GENERATED : null;

  const payroll: MenuItem[] = [
    { id: "preview-excel", label: "Preview Excel", description: "Current preview or saved draft", tag: "Excel", disabledReason: exportReason },
    { id: "extract", label: "Extract", description: "Monthly payroll summary", tag: "Excel", disabledReason: exportReason },
  ];
  if (ctx.canManage) {
    payroll.push({
      id: "export-employee-payroll",
      label: "Export Employee Payroll",
      description: "Saved payroll for chosen periods",
      tag: "Excel",
      disabledReason: null,
    });
  }

  const bank: MenuItem[] = BANK_FORMATS.map((f) => ({
    id: `bank-${f.id}` as MenuItemId,
    label: f.label,
    description: f.description,
    tag: f.tag,
    disabledReason: bankReason,
  }));

  const reports: MenuItem[] | null = ctx.canManage
    ? POST_PAYROLL_REPORTS.map((r) => ({
        id: `report-${r.type}` as MenuItemId,
        label: r.label,
        description: r.description,
        tag: "Excel" as const,
        disabledReason: reportReason,
      }))
    : null;

  return {
    payroll,
    bank,
    reports,
    reportsHint: ctx.canManage && reportReason ? `${formatMonthLabel(ctx.ym) || "This month"}: ${reportReason.toLowerCase()}` : null,
  };
}

export function bankFormatOf(id: MenuItemId): BankLetterFormatId | null {
  return id.startsWith("bank-") ? (id.slice(5) as BankLetterFormatId) : null;
}

export function reportTypeOf(id: MenuItemId): PostPayrollReportType | null {
  return id.startsWith("report-") ? (id.slice(7) as PostPayrollReportType) : null;
}

// ---------------------------------------------------------------- TDS range

/** "To" can never be before "From". Returns the message to show, or null when the range is fine (To is optional). */
export function tdsRangeError(fromYm: string, toYm: string): string | null {
  if (!toYm) return null;
  if (!isValidYm(toYm)) return "Choose a valid To month.";
  if (isValidYm(fromYm) && toYm < fromYm) return "The To month cannot be before the From month.";
  return null;
}

// ---------------------------------------------------------------- keyboard

export type NavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * Roving focus inside one menu level. Disabled items stay focusable (so keyboard users can read their tooltip),
 * they just cannot be activated. Wraps around at both ends.
 */
export function nextFocusIndex(count: number, current: number, key: NavKey): number {
  if (count <= 0) return -1;
  switch (key) {
    case "Home": return 0;
    case "End": return count - 1;
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current < 0 ? count - 1 : (current - 1 + count) % count;
  }
}

export type MenuLevel = "root" | "submenu";
export type MenuRowKind = "item" | "submenu";

export type MenuKeyResult =
  | { type: "focus"; index: number }
  | { type: "activate" }
  | { type: "open-submenu" }
  | { type: "close-submenu" }
  | { type: "close-menu" }
  | { type: "none" };

/**
 * What a key does, given where focus is. `rowKind` is the kind of the focused row at this level.
 *  - root level:    ArrowRight/Enter/Space on a submenu row opens it (focus moves to its first item);
 *                   Enter/Space on an item activates it; Esc closes the menu.
 *  - submenu level: ArrowLeft/Esc closes the submenu (focus returns to its row); Enter/Space activates.
 */
export function menuKeyAction(level: MenuLevel, rowKind: MenuRowKind, count: number, current: number, key: string): MenuKeyResult {
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    return { type: "focus", index: nextFocusIndex(count, current, key) };
  }
  if (key === "Escape") return level === "submenu" ? { type: "close-submenu" } : { type: "close-menu" };
  if (level === "submenu" && key === "ArrowLeft") return { type: "close-submenu" };
  if (level === "root" && rowKind === "submenu" && (key === "ArrowRight" || key === "Enter" || key === " ")) return { type: "open-submenu" };
  if (key === "Enter" || key === " ") return { type: "activate" };
  if (key === "Tab") return { type: "close-menu" };
  return { type: "none" };
}

// ---------------------------------------------------------------- layout and timing

/** Below this width the menu is a bottom sheet with sections instead of hover submenus. */
export const PHONE_MAX_WIDTH = 639;
export type MenuLayout = "popover" | "sheet";

export function menuLayoutForWidth(width: number): MenuLayout {
  return width <= PHONE_MAX_WIDTH ? "sheet" : "popover";
}

/** Hover timing: a short delay before a submenu opens, and a grace period before it closes so diagonal moves survive. */
export const SUBMENU_OPEN_DELAY_MS = 120;
export const SUBMENU_CLOSE_DELAY_MS = 280;

// ---------------------------------------------------------------- positioning (pure, so edge flipping is testable)

export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type PanelPlacement = "bottom-start" | "right-start";

const EDGE = 8;

/**
 * Where a panel goes relative to its anchor, flipping near screen edges:
 *  - bottom-start: under the anchor, left edges aligned; flips to right-aligned when it would leave the right edge,
 *                  and opens upwards when there is no room below but more room above.
 *  - right-start:  beside the anchor (submenus); flips to the left side when it would leave the right edge, and is
 *                  shifted up when it would leave the bottom edge.
 */
export function computePanelPosition(
  anchor: Rect,
  panel: { width: number; height: number },
  viewport: Viewport,
  placement: PanelPlacement,
): { top: number; left: number; flippedX: boolean; flippedY: boolean } {
  let left: number;
  let top: number;
  let flippedX = false;
  let flippedY = false;
  if (placement === "bottom-start") {
    left = anchor.left;
    if (left + panel.width > viewport.width - EDGE) {
      left = anchor.right - panel.width;
      flippedX = true;
    }
    top = anchor.bottom + 6;
    if (top + panel.height > viewport.height - EDGE && anchor.top - 6 - panel.height >= EDGE) {
      top = anchor.top - 6 - panel.height;
      flippedY = true;
    }
  } else {
    left = anchor.right + 4;
    if (left + panel.width > viewport.width - EDGE) {
      left = anchor.left - 4 - panel.width;
      flippedX = true;
    }
    top = anchor.top - 6;
    if (top + panel.height > viewport.height - EDGE) {
      top = Math.max(EDGE, viewport.height - EDGE - panel.height);
      flippedY = true;
    }
  }
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewport.width - EDGE - panel.width));
  top = Math.max(EDGE, top);
  return { top, left, flippedX, flippedY };
}
