/**
 * Run: npx --yes tsx src/lib/downloadsMenu.test.ts
 *
 * Run Payroll "Downloads" menu: only Preview Excel and Extract (Export Employee Payroll and the Bank Letter are
 * gone from it; the post-payroll reports and the Bank Letter live in their own menu, see
 * postPayrollReportsMenu.test.ts). Item states for no draft / draft, keyboard navigation, the phone layout switch,
 * edge flipping, and the rendered markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/ToastProvider";
import { DownloadsMenu } from "../components/payroll/DownloadsMenu";
import {
  PHONE_MAX_WIDTH,
  REASON_BUSY,
  REASON_NOTHING_TO_EXPORT,
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

const base: MenuContext = { running: false, exportDisabled: false, ym: "2026-09" };
const reasons = (ctx: Partial<MenuContext>) => {
  const m = buildDownloadsMenu({ ...base, ...ctx });
  return Object.fromEntries(m.payroll.map((i) => [i.id, i.disabledReason]));
};

// ---- the selected month feeds the menu
assertEq(monthKey("2026", "09"), "2026-09", "month key from the page selectors (string)");
assertEq(monthKey(2026, 9), "2026-09", "month key from numbers");

// ---- what remains in Downloads: Preview Excel and Extract, nothing else
{
  const m = buildDownloadsMenu({ ...base });
  assertEq(Object.keys(m), ["payroll"], "the model has only the payroll group");
  assertEq(m.payroll.map((i) => i.id), ["preview-excel", "extract"], "Downloads items");
  assertEq(m.payroll.map((i) => i.label), ["Preview Excel", "Extract"], "Downloads labels");
  assertEq(m.payroll.map((i) => i.tag), ["Excel", "Excel"], "tags on the right");
  assertEq(m.payroll.some((i) => i.id === ("export-employee-payroll" as string)), false, "Export Employee Payroll is not a Downloads item");
  assertEq(m.payroll.some((i) => i.id.startsWith("bank-")), false, "Bank Letter is not in Downloads");
  assertEq(m.payroll.some((i) => i.id.startsWith("report-")), false, "no report item in Downloads");
  assertEq(m.payroll.filter((i) => i.disabledReason).length, 0, "nothing disabled when there is something to export");
}
// ---- no draft and nothing calculated: exports are disabled with the reason
{
  const r = reasons({ exportDisabled: true });
  assertEq(r["preview-excel"], REASON_NOTHING_TO_EXPORT, "preview excel, no draft");
  assertEq(r["extract"], REASON_NOTHING_TO_EXPORT, "extract, no draft");
}
// ---- draft saved / preview calculated: on
assertEq(Object.values(reasons({ exportDisabled: false })), [null, null], "draft: both enabled");
// ---- busy
assertEq(Object.values(reasons({ running: true })), [REASON_BUSY, REASON_BUSY], "saving or generating disables exports");
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
        runMonth: "09", runYear: "2026", running: false, exportDisabled: false,
        onPreviewExcel: async () => true, onExtract: async () => true,
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
  assertEq((desktop.match(/role="menuitem"/g) ?? []).length, 2, "exactly Preview Excel and Extract");
  assertEq((desktop.match(/aria-haspopup="menu"/g) ?? []).length, 1, "only the trigger opens a menu (no submenus)");
  assertEq(desktop.includes("Preview Excel") && desktop.includes("Extract"), true, "payroll items");
  for (const gone of ["Export Employee Payroll", "Bank Letter", "Word document", "Post-payroll reports", "TDS Data", "Paybill"]) {
    assertEq(desktop.includes(gone), false, gone + " is not in the Downloads menu");
  }
  assertEq(desktop.includes("role=\"dialog\""), false, "desktop has no sheet");
  assertEq(/tabindex="0"/.test(desktop), true, "one row is in the tab order (roving focus)");

  const noExport = render({ defaultOpen: true, forceLayout: "popover", exportDisabled: true });
  assertEq(noExport.includes(REASON_NOTHING_TO_EXPORT), true, "disabled rows carry their reason");
  assertEq(noExport.includes('aria-disabled="true"'), true, "disabled rows are marked aria-disabled");
  assertEq(noExport.includes('role="tooltip"'), true, "tooltip element is present for disabled rows");

  const sheet = render({ defaultOpen: true, forceLayout: "sheet" });
  assertEq(sheet.includes("Downloads · Sep 2026"), true, "sheet title shows the month");
  assertEq(sheet.includes("min-h-[44px]"), true, "44px rows on phones");
  assertEq((sheet.match(/role="menuitem"/g) ?? []).length, 2, "sheet lists both items");
  assertEq(sheet.includes('aria-label="Close downloads"'), true, "sheet has a close button");
  const sheetNoExport = render({ defaultOpen: true, forceLayout: "sheet", exportDisabled: true });
  assertEq(sheetNoExport.includes(REASON_NOTHING_TO_EXPORT), true, "phone shows the reason inline (no hover)");
  assertEq(sheetNoExport.includes('role="tooltip"'), false, "no hover tooltips on the sheet");
}

console.log("downloadsMenu.test.ts passed");
