/**
 * Run: npx --yes tsx src/lib/downloadsMenu.test.ts
 *
 * Run Payroll "Downloads" menu: item states for no draft / draft / generated month, the TDS range rule, keyboard
 * navigation of the menu and submenus, the phone layout switch, edge flipping, and the rendered markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/ToastProvider";
import { DownloadsMenu } from "../components/payroll/DownloadsMenu";
import {
  PHONE_MAX_WIDTH,
  REASON_BANK_BUSY,
  REASON_BUSY,
  REASON_NOTHING_TO_EXPORT,
  REASON_NOT_GENERATED,
  bankFormatOf,
  buildDownloadsMenu,
  computePanelPosition,
  menuKeyAction,
  menuLayoutForWidth,
  monthKey,
  nextFocusIndex,
  reportTypeOf,
  tdsRangeError,
  type MenuContext,
} from "./downloadsMenuModel";
import { fileNameFromDisposition, postPayrollReportUrl } from "./postPayrollDownload";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const base: MenuContext = { canManage: true, running: false, exportDisabled: false, bankLetterLoading: false, generated: false, ym: "2026-09" };
const reasons = (ctx: Partial<MenuContext>) => {
  const m = buildDownloadsMenu({ ...base, ...ctx });
  return Object.fromEntries([...m.payroll, ...m.bank, ...(m.reports ?? [])].map((i) => [i.id, i.disabledReason]));
};

// ---- the selected month feeds the menu
assertEq(monthKey("2026", "09"), "2026-09", "month key from the page selectors (string)");
assertEq(monthKey(2026, 9), "2026-09", "month key from numbers");

// ---- no draft and nothing calculated: exports are disabled with the reason, Employee Payroll export stays available
{
  const r = reasons({ exportDisabled: true, generated: false });
  assertEq(r["preview-excel"], REASON_NOTHING_TO_EXPORT, "preview excel, no draft");
  assertEq(r["extract"], REASON_NOTHING_TO_EXPORT, "extract, no draft");
  assertEq(r["bank-docx"], REASON_NOTHING_TO_EXPORT, "bank letter word, no draft");
  assertEq(r["bank-xlsx"], REASON_NOTHING_TO_EXPORT, "bank letter excel, no draft");
  assertEq(r["bank-pdf"], REASON_NOTHING_TO_EXPORT, "bank letter pdf, no draft");
  assertEq(r["export-employee-payroll"], null, "export employee payroll does not depend on the draft (as before)");
  for (const t of ["tds", "cpf", "division-wise", "paybill"]) assertEq(r[`report-${t}`], REASON_NOT_GENERATED, `report ${t} needs a generated month`);
}
// ---- draft saved / preview calculated, month still open: payroll + bank letter on, reports explained
{
  const m = buildDownloadsMenu({ ...base, exportDisabled: false, generated: false });
  const r = reasons({ exportDisabled: false, generated: false });
  assertEq([r["preview-excel"], r["extract"], r["bank-docx"], r["bank-xlsx"], r["bank-pdf"]], [null, null, null, null, null], "draft: payroll and bank letter enabled");
  assertEq(r["report-paybill"], "Generate payroll for this month first.", "open month: reports disabled with the tooltip text");
  assertEq(m.reportsHint, "Sep 2026: generate payroll for this month first.", "hint above the disabled reports");
}
// ---- generated month: everything on
{
  const m = buildDownloadsMenu({ ...base, generated: true });
  const all = [...m.payroll, ...m.bank, ...(m.reports ?? [])];
  assertEq(all.filter((i) => i.disabledReason).length, 0, "generated month: nothing disabled");
  assertEq(m.reportsHint, null, "no hint when reports are available");
  assertEq(m.payroll.map((i) => i.label), ["Preview Excel", "Extract", "Export Employee Payroll"], "payroll group");
  assertEq(m.bank.map((i) => i.label), ["Word document", "Excel workbook", "PDF letter"], "bank letter formats, same as before");
  assertEq(m.reports!.map((i) => i.label), ["TDS Data", "CPF / VPF Statement", "Division-Wise Salary", "Paybill"], "reports");
  assertEq(m.bank.map((i) => i.tag), ["Letter", "Excel", "Letter"], "tags on the right");
  assertEq(m.reports!.every((i) => i.tag === "Excel"), true, "reports are Excel");
}
// ---- busy / role
{
  const r = reasons({ running: true, generated: true });
  assertEq(r["preview-excel"], REASON_BUSY, "saving or generating disables exports");
  assertEq(r["report-cpf"], REASON_BUSY, "and reports");
  assertEq(reasons({ bankLetterLoading: true })["bank-pdf"], REASON_BANK_BUSY, "a bank letter in progress disables the bank formats only");
  assertEq(reasons({ bankLetterLoading: true })["extract"], null, "other items stay enabled while the bank letter builds");
  const staff = buildDownloadsMenu({ ...base, canManage: false, generated: true });
  assertEq(staff.reports, null, "no post-payroll reports without admin rights");
  assertEq(staff.payroll.map((i) => i.id), ["preview-excel", "extract"], "no Export Employee Payroll without admin rights");
  assertEq(staff.bank.length, 3, "bank letter stays (as before)");
}
assertEq(bankFormatOf("bank-xlsx"), "xlsx", "bank id -> format");
assertEq(bankFormatOf("extract"), null, "non-bank id");
assertEq(reportTypeOf("report-division-wise"), "division-wise", "report id -> type");

// ---- TDS range: To is optional and can never be before From
assertEq(tdsRangeError("2026-09", ""), null, "To is optional");
assertEq(tdsRangeError("2026-09", "2026-09"), null, "same month");
assertEq(tdsRangeError("2026-09", "2026-11"), null, "later month");
assertEq(tdsRangeError("2026-09", "2026-08"), "The To month cannot be before the From month.", "earlier month is rejected");
assertEq(tdsRangeError("2026-09", "garbage"), "Choose a valid To month.", "invalid month");
// changing the page month re-evaluates the same To: Oct..Nov fine, then Dec..Nov is not
assertEq([tdsRangeError("2026-10", "2026-11"), tdsRangeError("2026-12", "2026-11")], [null, "The To month cannot be before the From month."], "range follows the page month");

// ---- the request is exactly what the old page sent
assertEq(postPayrollReportUrl("cpf", "2026-09"), "/api/payroll/post-downloads/cpf?year=2026&month=9", "single month query");
assertEq(postPayrollReportUrl("tds", "2026-09", "2026-11"), "/api/payroll/post-downloads/tds?year=2026&month=9&to_year=2026&to_month=11", "tds range query");
assertEq(postPayrollReportUrl("paybill", "2026-09", "2026-11"), "/api/payroll/post-downloads/paybill?year=2026&month=9", "To only applies to TDS");
let threw = "";
try { postPayrollReportUrl("tds", "2026-09", "2026-08"); } catch (e) { threw = (e as Error).message; }
assertEq(threw, "The To month cannot be before the From month.", "download refuses a backwards range");
assertEq(fileNameFromDisposition('attachment; filename="TDS_DATA_202609.xlsx"', "x.xlsx"), "TDS_DATA_202609.xlsx", "file name comes from the server");
assertEq(fileNameFromDisposition(null, "fallback.xlsx"), "fallback.xlsx", "fallback name");

// ---- keyboard: roving focus wraps, skips nothing (disabled items stay focusable for their tooltip)
assertEq(nextFocusIndex(5, 0, "ArrowDown"), 1, "down");
assertEq(nextFocusIndex(5, 4, "ArrowDown"), 0, "down wraps");
assertEq(nextFocusIndex(5, 0, "ArrowUp"), 4, "up wraps");
assertEq(nextFocusIndex(5, 2, "Home"), 0, "home");
assertEq(nextFocusIndex(5, 2, "End"), 4, "end");
assertEq(nextFocusIndex(5, -1, "ArrowDown"), 0, "first down from nothing");
assertEq(nextFocusIndex(0, -1, "ArrowDown"), -1, "empty list");
// root level
assertEq(menuKeyAction("root", "item", 5, 1, "ArrowDown"), { type: "focus", index: 2 }, "root down");
assertEq(menuKeyAction("root", "submenu", 5, 3, "ArrowRight"), { type: "open-submenu" }, "ArrowRight opens a submenu");
assertEq(menuKeyAction("root", "submenu", 5, 3, "Enter"), { type: "open-submenu" }, "Enter opens a submenu");
assertEq(menuKeyAction("root", "submenu", 5, 3, " "), { type: "open-submenu" }, "Space opens a submenu");
assertEq(menuKeyAction("root", "item", 5, 1, "ArrowRight"), { type: "none" }, "ArrowRight on a plain item does nothing");
assertEq(menuKeyAction("root", "item", 5, 1, "Enter"), { type: "activate" }, "Enter activates an item");
assertEq(menuKeyAction("root", "item", 5, 1, " "), { type: "activate" }, "Space activates an item");
assertEq(menuKeyAction("root", "item", 5, 1, "Escape"), { type: "close-menu" }, "Esc closes the menu");
assertEq(menuKeyAction("root", "item", 5, 1, "Tab"), { type: "close-menu" }, "Tab leaves the menu");
assertEq(menuKeyAction("root", "item", 5, 1, "x"), { type: "none" }, "other keys ignored");
// submenu level
assertEq(menuKeyAction("submenu", "item", 3, 0, "ArrowLeft"), { type: "close-submenu" }, "ArrowLeft closes the submenu");
assertEq(menuKeyAction("submenu", "item", 3, 0, "Escape"), { type: "close-submenu" }, "Esc closes only the submenu first");
assertEq(menuKeyAction("submenu", "item", 3, 2, "ArrowDown"), { type: "focus", index: 0 }, "submenu down wraps");
assertEq(menuKeyAction("submenu", "item", 3, 1, "Enter"), { type: "activate" }, "Enter activates in a submenu");
// a full walk: open menu -> down to Bank Letter -> right -> down -> left -> Esc
{
  const rows = ["preview-excel", "extract", "export-employee-payroll", "sub:bank", "sub:reports"];
  let i = 0;
  const log: string[] = [];
  for (const key of ["ArrowDown", "ArrowDown", "ArrowDown"]) {
    const r = menuKeyAction("root", rows[i].startsWith("sub:") ? "submenu" : "item", rows.length, i, key);
    if (r.type === "focus") i = r.index;
  }
  log.push(rows[i]);
  const open = menuKeyAction("root", "submenu", rows.length, i, "ArrowRight");
  log.push(open.type);
  const inSub = menuKeyAction("submenu", "item", 3, 0, "ArrowDown");
  log.push(inSub.type === "focus" ? `sub:${inSub.index}` : inSub.type);
  log.push(menuKeyAction("submenu", "item", 3, 1, "ArrowLeft").type);
  log.push(menuKeyAction("root", "submenu", rows.length, i, "Escape").type);
  assertEq(log, ["sub:bank", "open-submenu", "sub:1", "close-submenu", "close-menu"], "keyboard walk through menu and submenu");
}

// ---- phone layout switch
assertEq(PHONE_MAX_WIDTH, 639, "breakpoint is below Tailwind sm");
assertEq(menuLayoutForWidth(390), "sheet", "390px phone");
assertEq(menuLayoutForWidth(639), "sheet", "639px is still a phone");
assertEq(menuLayoutForWidth(640), "popover", "640px tablet");
assertEq(menuLayoutForWidth(1440), "popover", "desktop");

// ---- edge flipping
const vp = { width: 1440, height: 900 };
const rect = (left: number, top: number, w = 110, h = 32) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
{
  const normal = computePanelPosition(rect(400, 100), { width: 288, height: 300 }, vp, "bottom-start");
  assertEq([normal.left, normal.top, normal.flippedX, normal.flippedY], [400, 138, false, false], "opens under the button");
  const right = computePanelPosition(rect(1380, 100, 50), { width: 288, height: 300 }, vp, "bottom-start");
  assertEq([right.flippedX, right.left + 288 <= 1440 - 8], [true, true], "flips to right-aligned near the right edge");
  const low = computePanelPosition(rect(400, 800), { width: 288, height: 300 }, vp, "bottom-start");
  assertEq([low.flippedY, low.top], [true, 800 - 6 - 300], "opens upwards when there is no room below");
  const sub = computePanelPosition(rect(300, 200, 288, 40), { width: 272, height: 200 }, vp, "right-start");
  assertEq([sub.left, sub.flippedX], [592, false], "submenu opens to the right");
  const subEdge = computePanelPosition(rect(1100, 200, 288, 40), { width: 272, height: 200 }, vp, "right-start");
  assertEq([subEdge.flippedX, subEdge.left], [true, 1100 - 4 - 272], "submenu flips to the left near the right edge");
  const subLow = computePanelPosition(rect(300, 850, 288, 40), { width: 272, height: 240 }, vp, "right-start");
  assertEq([subLow.flippedY, subLow.top + 240 <= 900 - 8], [true, true], "submenu is lifted when it would leave the bottom");
}

// ---- rendered markup (desktop popover and phone sheet), roles and labels
const render = (props: Partial<Parameters<typeof DownloadsMenu>[0]>) =>
  renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(DownloadsMenu, {
        runMonth: "09", runYear: "2026", canManage: true, running: false, exportDisabled: false, bankLetterLoading: false, generated: true,
        onPreviewExcel: async () => true, onExtract: async () => true, onBankLetter: async () => true, onExportEmployeePayroll: () => {},
        renderInline: true, ...props,
      }),
    ),
  );
{
  const closed = render({});
  assertEq(closed.includes('aria-haspopup="menu"') && closed.includes('aria-expanded="false"'), true, "trigger is a menu button");
  assertEq(closed.includes("Downloads"), true, "trigger label");
  assertEq(closed.includes('role="menu"'), false, "closed menu renders no panel");

  const desktop = render({ defaultOpen: true, forceLayout: "popover" });
  assertEq(desktop.includes('role="menu"'), true, "open menu has role=menu");
  assertEq((desktop.match(/role="menuitem"/g) ?? []).length, 5, "3 payroll rows + 2 submenu triggers");
  assertEq((desktop.match(/aria-haspopup="menu"/g) ?? []).length, 3, "trigger + Bank Letter + Post-payroll reports");
  assertEq(desktop.includes("Payroll") && desktop.includes("Bank Letter") && desktop.includes("Post-payroll reports"), true, "sections");
  assertEq(desktop.includes("Preview Excel") && desktop.includes("Extract") && desktop.includes("Export Employee Payroll"), true, "payroll items");
  assertEq(desktop.includes("role=\"dialog\""), false, "desktop has no sheet");
  assertEq(/tabindex="0"/.test(desktop), true, "one row is in the tab order (roving focus)");

  const bank = render({ defaultOpen: true, defaultSubmenu: "bank", forceLayout: "popover" });
  assertEq(bank.includes("Word document") && bank.includes("Excel workbook") && bank.includes("PDF letter"), true, "bank letter submenu lists the same formats");
  const reports = render({ defaultOpen: true, defaultSubmenu: "reports", forceLayout: "popover" });
  assertEq(["TDS Data", "CPF / VPF Statement", "Division-Wise Salary", "Paybill"].every((l) => reports.includes(l)), true, "reports submenu");
  assertEq(reports.includes("Reports for Sep 2026"), true, "submenu header names the selected month");

  const openMonth = render({ defaultOpen: true, defaultSubmenu: "reports", forceLayout: "popover", generated: false });
  assertEq(openMonth.includes("Generate payroll for this month first."), true, "disabled reports carry their reason");
  assertEq(openMonth.includes('aria-disabled="true"'), true, "disabled rows are marked aria-disabled");
  assertEq(openMonth.includes('role="tooltip"'), true, "tooltip element is present for disabled rows");
  assertEq(openMonth.includes("Sep 2026: generate payroll for this month first."), true, "hint above the reports");

  const staff = render({ defaultOpen: true, forceLayout: "popover", canManage: false });
  assertEq(staff.includes("Post-payroll reports") || staff.includes("Export Employee Payroll"), false, "admin-only items hidden for other roles");

  const sheet = render({ defaultOpen: true, forceLayout: "sheet" });
  assertEq(sheet.includes("Downloads · Sep 2026"), true, "sheet title shows the month");
  assertEq((sheet.match(/role="group"/g) ?? []).length, 3, "sheet has Payroll, Bank Letter and Post-payroll reports sections");
  assertEq(sheet.includes("min-h-[44px]"), true, "44px rows on phones");
  assertEq((sheet.match(/role="menuitem"/g) ?? []).length, 3 + 3 + 4, "sheet lists every item flat (no hover submenus)");
  assertEq(sheet.includes('aria-label="Close downloads"'), true, "sheet has a close button");
  const sheetOpenMonth = render({ defaultOpen: true, forceLayout: "sheet", generated: false });
  assertEq(sheetOpenMonth.includes("Generate payroll for this month first."), true, "phone shows the reason inline (no hover)");
  assertEq(sheetOpenMonth.includes('role="tooltip"'), false, "no hover tooltips on the sheet");
}

console.log("downloadsMenu.test.ts passed");
