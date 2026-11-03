/**
 * Run: npx --yes tsx src/lib/postPayrollReportsMenu.test.ts
 *
 * The Run Payroll "Post-payroll reports" button + dropdown (separate from Downloads): TDS Data, CPF / VPF
 * Statement, Division-Wise Salary, Paybill and Bank Letter, the enabled/disabled rules (the reports are usable
 * whenever ANY month has a generated run), the single-month month selector, and the rendered markup.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/ToastProvider";
import { PostPayrollReportsMenu } from "../components/payroll/PostPayrollReportsMenu";
import {
  REASON_BANK_BUSY,
  REASON_BUSY,
  REASON_NOTHING_TO_EXPORT,
  REASON_NO_MONTH_GENERATED,
  buildDownloadsMenu,
  buildPostPayrollMenu,
  singleMonthChoice,
  type PostPayrollMenuContext,
} from "./downloadsMenuModel";
import type { ReportPeriod } from "./periodReport";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const base: PostPayrollMenuContext = { canManage: true, running: false, generatedMonths: ["2026-09"], ym: "2026-11" };
const reasons = (ctx: Partial<PostPayrollMenuContext>) =>
  Object.fromEntries((buildPostPayrollMenu({ ...base, ...ctx })?.items ?? []).map((i) => [i.id, i.disabledReason]));

// ---- contents: the four reports and the Bank Letter, directly, in this order
{
  const m = buildPostPayrollMenu(base)!;
  assertEq(m.items.map((i) => i.label), ["TDS Data", "CPF / VPF Statement", "Division-Wise Salary", "Paybill", "Bank Letter"], "the reports and Bank Letter");
  assertEq(m.items.map((i) => i.id), ["report-tds", "report-cpf", "report-division-wise", "report-paybill", "bank-letter"], "ids");
  assertEq(m.items.slice(0, 4).every((i) => i.tag === "Excel"), true, "EXCEL badge on every report");
  assertEq(m.items.every((i) => Boolean(i.description)), true, "every item keeps its description");
  assertEq(m.items.map((i) => i.flow), ["multi-month", "single-month", "single-month", "single-month", "bank-letter"], "TDS uses the multi-month picker, the others a single month, Bank Letter its formats");
  assertEq(m.bankFormats.map((i) => i.label), ["Word document", "Excel workbook", "PDF letter"], "bank letter formats, same as before");
  assertEq(m.bankFormats.map((i) => i.id), ["bank-docx", "bank-xlsx", "bank-pdf"], "format ids");
  assertEq(buildPostPayrollMenu({ ...base, canManage: false }), null, "no menu without admin rights");
}
// ---- Downloads keeps only Preview Excel and Extract: no report, no Bank Letter, no Export Employee Payroll
{
  const d = buildDownloadsMenu({ running: false, exportDisabled: false, ym: "2026-11" });
  assertEq(d.payroll.map((i) => i.label), ["Preview Excel", "Extract"], "Downloads has only Preview Excel and Extract");
  assertEq(d.payroll.some((i) => i.id.startsWith("report-") || i.id.startsWith("bank-")), false, "no report or bank item in Downloads");
}
// ---- enabled / disabled rules
{
  const reportIds = ["report-tds", "report-cpf", "report-division-wise", "report-paybill"];
  const reportReasons = (ctx: Partial<PostPayrollMenuContext>) => reportIds.map((id) => reasons(ctx)[id]);
  // The selected month (Nov 2026) is NOT generated, but Sep 2026 is: everything stays usable.
  assertEq(reportReasons({ ym: "2026-11", generatedMonths: ["2026-09"] }), [null, null, null, null], "usable when any month is generated, even if the page month is not");
  assertEq(buildPostPayrollMenu({ ...base, ym: "2026-11" })!.hint, null, "no 'generate payroll first' hint then");
  assertEq(reportReasons({ generatedMonths: null }), [null, null, null, null], "usable while the month list is still loading");
  assertEq(reportReasons({ generatedMonths: [] }), Array(4).fill(REASON_NO_MONTH_GENERATED), "reports disabled only when no month has been generated at all");
  assertEq(buildPostPayrollMenu({ ...base, generatedMonths: [] })!.hint, REASON_NO_MONTH_GENERATED, "with the hint above the list");
  assertEq(reportReasons({ running: true }), Array(4).fill(REASON_BUSY), "disabled while saving or generating");
  assertEq(buildPostPayrollMenu({ ...base, running: true })!.hint, null, "busy is not a 'generate first' problem");
  // Bank Letter follows the page month's payroll (preview or draft), exactly as it did in Downloads.
  assertEq(reasons({})["bank-letter"], null, "bank letter enabled with a calculated page month");
  assertEq(reasons({ exportDisabled: true })["bank-letter"], REASON_NOTHING_TO_EXPORT, "bank letter: nothing to export");
  assertEq(reasons({ bankLetterLoading: true })["bank-letter"], REASON_BANK_BUSY, "bank letter: one is already being prepared");
  assertEq(reasons({ running: true })["bank-letter"], REASON_BUSY, "bank letter: busy");
  assertEq(reasons({ generatedMonths: [] })["bank-letter"], null, "bank letter does not depend on the generated-month list");
  assertEq(buildPostPayrollMenu({ ...base, bankLetterLoading: true, exportDisabled: true })!.bankFormats.map((i) => i.disabledReason), Array(3).fill(REASON_NOTHING_TO_EXPORT), "formats carry the same reason");
}
// ---- single-month selector: only generated months
{
  assertEq(singleMonthChoice("2026-09", ["2026-08", "2026-09"]), { options: ["2026-08", "2026-09"], selected: "2026-09", notice: null }, "page month generated: preselected");
  assertEq(
    singleMonthChoice("2026-11", ["2026-09", "2026-08"]),
    { options: ["2026-08", "2026-09"], selected: "2026-09", notice: "Nov 2026: generate payroll for this month first." },
    "page month not generated: latest generated month, with an inline notice",
  );
  assertEq(singleMonthChoice("2026-11", []), { options: [], selected: "", notice: REASON_NO_MONTH_GENERATED }, "nothing to choose when no month is generated");
  assertEq(singleMonthChoice("2026-09", ["2026-09", "2026-09"]).options, ["2026-09"], "no duplicates");
}

// ---- rendered markup
const periods: ReportPeriod[] = ["2026-08", "2026-09"].map((ym) => ({
  ym, year: 2026, month: Number(ym.slice(5)), label: ym === "2026-08" ? "August 2026" : "September 2026", periodId: `p-${ym}`,
}));
const render = (props: Partial<Parameters<typeof PostPayrollReportsMenu>[0]>) =>
  renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(PostPayrollReportsMenu, { runMonth: "11", runYear: "2026", canManage: true, running: false, renderInline: true, initialPeriods: periods, ...props }),
    ),
  );
{
  const closed = render({});
  assertEq(closed.includes("Post-payroll reports"), true, "button label");
  assertEq(closed.includes('aria-haspopup="menu"') && closed.includes('aria-expanded="false"'), true, "menu button, closed");
  assertEq(closed.includes('role="menu"'), false, "closed renders no panel");

  const open = render({ defaultOpen: true, forceLayout: "popover" });
  assertEq(open.includes('aria-expanded="true"'), true, "expanded when open");
  assertEq((open.match(/role="menuitem"/g) ?? []).length, 5, "four reports and Bank Letter listed directly, no submenu");
  assertEq((open.match(/aria-haspopup="menu"/g) ?? []).length, 1, "only the trigger opens a menu");
  assertEq(["TDS Data", "CPF / VPF Statement", "Division-Wise Salary", "Paybill", "Bank Letter"].every((l) => open.includes(l)), true, "labels");
  assertEq(open.includes("Export Employee Payroll"), false, "Export Employee Payroll is not in this menu either");
  assertEq(open.includes("Word document"), false, "bank formats are one step in, not listed up front");
  assertEq(open.includes("Excel") || open.includes("EXCEL"), true, "Excel badge");
  assertEq(open.includes('aria-disabled="true"'), false, "enabled although Nov 2026 is not generated (Sep 2026 is)");
  assertEq(open.includes("generate payroll for this month first"), false, "no blocking message");
  assertEq(open.includes("max-w-[calc(100vw-16px)]") && open.includes("overflow-y-auto"), true, "never wider than the screen, scrolls when long");

  const none = render({ defaultOpen: true, forceLayout: "popover", initialPeriods: [] });
  assertEq(none.includes(REASON_NO_MONTH_GENERATED), true, "message when no month is generated at all");
  assertEq((none.match(/aria-disabled="true"/g) ?? []).length, 4, "the four reports are disabled then (Bank Letter is not)");

  const bank = render({ defaultOpen: true, forceLayout: "popover", defaultBankFormats: true });
  assertEq(bank.includes("Word document") && bank.includes("Excel workbook") && bank.includes("PDF letter"), true, "Bank Letter lists its three formats");
  assertEq(bank.includes('aria-label="Back to reports"'), true, "with a way back");
  assertEq(bank.includes("TDS Data"), false, "the report list is replaced while choosing a format");
  const bankBlocked = render({ defaultOpen: true, forceLayout: "popover", defaultBankFormats: true, exportDisabled: true });
  assertEq(bankBlocked.includes(REASON_NOTHING_TO_EXPORT), true, "formats show why they are disabled");

  const cpf = render({ defaultOpen: true, forceLayout: "popover", defaultReport: "cpf" });
  assertEq(cpf.includes('id="post-payroll-month"'), true, "single-month report shows a month selector");
  assertEq(cpf.includes(">Aug 2026<") && cpf.includes(">Sep 2026<"), true, "generated months are offered");
  assertEq(cpf.includes(">Nov 2026<"), false, "a month that was not generated is not offered");
  assertEq(cpf.includes("Nov 2026: generate payroll for this month first."), true, "inline message names the page month");

  const tds = render({ defaultOpen: true, forceLayout: "popover", defaultReport: "tds" });
  assertEq(tds.includes('aria-label="Search months"'), true, "TDS Data opens the searchable multi-month picker");
  assertEq(tds.includes("This FY") && tds.includes("Last 3 months"), true, "quick options");
  assertEq(tds.includes("Preview"), true, "TDS Data keeps its preview");

  const sheet = render({ defaultOpen: true, forceLayout: "sheet" });
  assertEq(sheet.includes('aria-label="Close post-payroll reports"'), true, "phone sheet has a close button");
  assertEq((sheet.match(/role="menuitem"/g) ?? []).length, 5, "phone sheet lists the four reports and Bank Letter");
  assertEq(sheet.includes("min-h-[44px]"), true, "44px rows on phones");

  assertEq(render({ canManage: false }).includes("Post-payroll reports"), false, "hidden for non-admin roles");
}

// ---- the two toolbar menus close each other (shared event, different ids) and share the panel behaviour
{
  const reports = readFileSync(new URL("../components/payroll/PostPayrollReportsMenu.tsx", import.meta.url), "utf8");
  const downloads = readFileSync(new URL("../components/payroll/DownloadsMenu.tsx", import.meta.url), "utf8");
  assertEq(reports.includes("TOOLBAR_MENU_EVENT") && downloads.includes("TOOLBAR_MENU_EVENT"), true, "both menus use the shared open event");
  assertEq(reports.includes('MENU_ID = "post-payroll-reports"') && downloads.includes('MENU_ID = "downloads"'), true, "with different ids, so opening one closes the other");
  for (const [name, src] of [["reports", reports], ["downloads", downloads]] as const) {
    assertEq(src.includes('addEventListener("mousedown"'), true, `${name}: outside click closes`);
    assertEq(src.includes('e.key === "Escape"'), true, `${name}: Escape closes`);
    assertEq(src.includes('document.addEventListener("touchstart"'), true, `${name}: outside tap closes`);
    assertEq(src.includes("max-w-[calc(100vw-16px)]"), true, `${name}: never wider than the screen`);
  }
}

console.log("postPayrollReportsMenu.test.ts passed");
