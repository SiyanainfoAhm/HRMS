"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ClipboardList, Download, FileSpreadsheet, FileText, Landmark, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { PeriodMultiSelect } from "@/components/payroll/PeriodMultiSelect";
import { PeriodReportPreview } from "@/components/payroll/PeriodReportPreview";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/dateInputs";
import {
  bankFormatOf,
  buildPostPayrollMenu,
  menuKeyAction,
  monthKey,
  reportTypeOf,
  singleMonthChoice,
  type BankLetterFormatId,
  type MenuItem,
  type MenuItemId,
  type MenuLayout,
  type PostPayrollMenuItem,
} from "@/lib/downloadsMenuModel";
import { defaultSelection, type ReportPeriod } from "@/lib/periodReport";
import { downloadPostPayrollReport, downloadPostPayrollMonths, type PostPayrollReportType } from "@/lib/postPayrollDownload";
import {
  MenuRow,
  PANEL_BASE,
  SectionHeader,
  Spinner,
  TOOLBAR_MENU_EVENT,
  useAnchoredPosition,
  usePhoneLayout,
} from "./downloadsMenuParts";

const MENU_ID = "post-payroll-reports";

type Props = {
  /** The page's own month/year selectors. */
  runMonth: string;
  runYear: string;
  canManage: boolean;
  running: boolean;
  /** Nothing to export yet for the page month (the Bank Letter is built from the page month's payroll). */
  exportDisabled?: boolean;
  bankLetterLoading?: boolean;
  /** Existing page function. It toasts its own result and resolves true when a file was saved. */
  onBankLetter?: (format: BankLetterFormatId) => Promise<boolean>;
  /** Test hooks: render open, force a layout, supply the generated months, pre-open one report's form or the bank formats. */
  defaultOpen?: boolean;
  forceLayout?: MenuLayout;
  initialPeriods?: ReportPeriod[];
  defaultReport?: PostPayrollReportType | null;
  defaultBankFormats?: boolean;
  /** Render panels in place instead of a portal (server-render tests). */
  renderInline?: boolean;
};

/**
 * Run Payroll "Post-payroll reports" button + dropdown (next to Downloads): TDS Data, CPF / VPF Statement,
 * Division-Wise Salary, Paybill and Bank Letter, listed directly. TDS Data opens the multi-month picker (with
 * preview); the single-month reports offer a month selector limited to generated months; Bank Letter offers its
 * three formats for the page month. The reports are usable whenever ANY month has a generated run.
 */
export function PostPayrollReportsMenu({
  runMonth, runYear, canManage, running, exportDisabled = false, bankLetterLoading = false, onBankLetter,
  defaultOpen = false, forceLayout, initialPeriods, defaultReport = null, defaultBankFormats = false, renderInline = false,
}: Props) {
  const { showToast } = useToast();
  const ym = monthKey(runYear, runMonth);
  const phone = usePhoneLayout();
  const layout: MenuLayout = forceLayout ?? (phone ? "sheet" : "popover");

  const [open, setOpen] = useState(defaultOpen);
  const [periods, setPeriods] = useState<ReportPeriod[] | null>(initialPeriods ?? null);
  const [report, setReport] = useState<PostPayrollReportType | null>(defaultReport);
  const [bankView, setBankView] = useState(defaultBankFormats);
  const [bankBusy, setBankBusy] = useState<MenuItemId | null>(null);
  const [singleYm, setSingleYm] = useState("");
  const [tdsMonths, setTdsMonths] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const backRef = useRef<HTMLButtonElement>(null);

  const generatedMonths = useMemo(() => (periods ? periods.map((p) => p.ym) : null), [periods]);
  const model = useMemo(
    () => buildPostPayrollMenu({ canManage, running, exportDisabled, bankLetterLoading, generatedMonths, ym }),
    [canManage, running, exportDisabled, bankLetterLoading, generatedMonths, ym],
  );

  const loadPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll/export-periods", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.periods)) setPeriods(data.periods as ReportPeriod[]);
    } catch {
      /* leave the list as it was; the server rejects months without a generated run */
    }
  }, []);

  // Know on first paint whether any month is generated; refresh whenever the menu opens or the page month changes.
  useEffect(() => {
    if (canManage && !initialPeriods) void loadPeriods();
  }, [canManage, initialPeriods, loadPeriods, ym]);

  const registerRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const closeAll = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setReport(null);
    setBankView(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    window.dispatchEvent(new CustomEvent(TOOLBAR_MENU_EVENT, { detail: MENU_ID }));
    setOpen(true);
    setReport(null);
    setBankView(false);
    if (!initialPeriods) void loadPeriods();
  }, [initialPeriods, loadPeriods]);

  // Opening the Downloads menu closes this one (they never overlap).
  useEffect(() => {
    function onOther(e: Event) {
      if ((e as CustomEvent<string>).detail !== MENU_ID) closeAll(false);
    }
    window.addEventListener(TOOLBAR_MENU_EVENT, onOther);
    return () => window.removeEventListener(TOOLBAR_MENU_EVENT, onOther);
  }, [closeAll]);

  // Outside click / touch closes the menu (clicks inside the panel or a month-picker popup do not).
  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      if (t.closest?.("[data-picker-popover]")) return;
      closeAll(false);
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
    };
  }, [open, closeAll]);

  // Focus: the first report when the list opens, the Back button when a form opens.
  useEffect(() => {
    if (!open) return;
    if (report || bankView) backRef.current?.focus();
    else if (model) rowRefs.current.get(focusId ?? model.items[0].id)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report, bankView]);

  const choice = useMemo(() => singleMonthChoice(ym, generatedMonths ?? []), [ym, generatedMonths]);

  function chooseReport(item: PostPayrollMenuItem) {
    if (item.disabledReason) return;
    if (item.flow === "bank-letter") {
      setBankView(true);
      return;
    }
    const type = reportTypeOf(item.id);
    if (!type) return;
    if (item.flow === "multi-month") setTdsMonths(periods ? defaultSelection(periods, ym) : []);
    else setSingleYm(choice.selected);
    setReport(type);
  }

  async function runBank(item: MenuItem) {
    const format = bankFormatOf(item.id);
    if (!format || item.disabledReason || bankBusy || !onBankLetter) return;
    setBankBusy(item.id);
    try {
      if (await onBankLetter(format)) closeAll(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBankBusy(null);
    }
  }

  async function download() {
    if (!report) return;
    setBusy(true);
    try {
      let name: string;
      if (report === "tds" || report === "division-wise") {
        if (tdsMonths.length === 0) throw new Error("Select at least one month.");
        name = await downloadPostPayrollMonths(report, tdsMonths);
        setPreviewOpen(false);
      } else {
        if (!singleYm) throw new Error("No generated month to download.");
        name = await downloadPostPayrollReport(report, singleYm);
      }
      showToast("success", `${name} downloaded.`);
      closeAll(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  const rows = model?.items ?? [];

  function onPanelKey(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeAll(true);
      return;
    }
    if (report || bankView) return; // the form and the bank formats use normal tab order
    const idx = rows.findIndex((r) => r.id === document.activeElement?.getAttribute("data-row-id"));
    const result = menuKeyAction("root", "item", rows.length, idx, e.key);
    if (result.type === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (result.type === "focus") rowRefs.current.get(rows[result.index].id)?.focus();
    else if (result.type === "close-menu") closeAll(true);
    else if (result.type === "activate" && idx >= 0) chooseReport(rows[idx]);
  }

  const triggerAnchor = useCallback(() => triggerRef.current, []);
  const pos = useAnchoredPosition(triggerAnchor, panelRef, open && layout === "popover", "bottom-start");
  const portal = (node: ReactNode) => (renderInline ? node : typeof document === "undefined" ? null : createPortal(node, document.body));

  if (!model) return null;

  const title = report
    ? rows.find((r) => r.id === `report-${report}`)?.label ?? "Report"
    : bankView
      ? "Bank Letter"
      : "Post-payroll reports";
  const inline = layout === "sheet";

  const list = (
    <>
      <SectionHeader>Reports</SectionHeader>
      {model.hint ? <p className="mx-2.5 mb-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{model.hint}</p> : null}
      {rows.map((item, i) => (
        <MenuRow
          key={item.id}
          id={item.id}
          label={item.label}
          description={item.description}
          tag={item.tag}
          icon={item.flow === "bank-letter" ? Landmark : FileSpreadsheet}
          disabledReason={item.disabledReason}
          focusId={focusId ?? rows[0].id}
          inlineReason={inline}
          registerRef={registerRef}
          onFocusRow={setFocusId}
          onActivate={() => chooseReport(rows[i])}
        />
      ))}
    </>
  );

  const bankForm = bankView ? (
    <div className="space-y-1 px-1 pb-2 pt-1">
      <div className="flex items-center gap-2">
        <button
          ref={backRef}
          type="button"
          aria-label="Back to reports"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          onClick={() => setBankView(false)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="text-[13px] font-semibold text-slate-800">Bank Letter · choose format</p>
      </div>
      {model?.bankFormats.map((item) => (
        <MenuRow
          key={item.id}
          id={item.id}
          label={item.label}
          description={item.description}
          tag={item.tag}
          icon={item.tag === "Letter" ? FileText : FileSpreadsheet}
          disabledReason={item.disabledReason}
          busy={bankBusy === item.id}
          focusId={null}
          inlineReason={inline}
          registerRef={registerRef}
          onFocusRow={setFocusId}
          onActivate={() => void runBank(item)}
        />
      ))}
    </div>
  ) : null;

  const form = report ? (
    <div className="space-y-3 px-1 pb-2 pt-1">
      <div className="flex items-center gap-2">
        <button
          ref={backRef}
          type="button"
          aria-label="Back to reports"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          onClick={() => setReport(null)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="text-[13px] font-semibold text-slate-800">{title}</p>
      </div>
      {report === "tds" || report === "division-wise" ? (
        <div>
          <span className="label-field">Months</span>
          <PeriodMultiSelect periods={periods ?? []} selected={tdsMonths} onChange={setTdsMonths} />
        </div>
      ) : (
        <div>
          <label className="label-field" htmlFor="post-payroll-month">Month</label>
          <select
            id="post-payroll-month"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={singleYm}
            disabled={choice.options.length === 0}
            onChange={(e) => setSingleYm(e.target.value)}
          >
            {choice.options.length === 0 ? <option value="">No generated month</option> : null}
            {[...choice.options].reverse().map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m) || m}</option>
            ))}
          </select>
          {choice.notice ? <p role="status" className="mt-1 text-[11px] text-amber-800">{choice.notice}</p> : null}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {report === "tds" || report === "division-wise" ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy || tdsMonths.length === 0}
            onClick={() => {
              setPreviewOpen(true);
              setOpen(false);
            }}
          >
            Preview
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
          disabled={busy || (report === "tds" || report === "division-wise" ? tdsMonths.length === 0 : !singleYm)}
          onClick={() => void download()}
        >
          {busy ? <Spinner /> : <Download className="h-3.5 w-3.5" aria-hidden />}
          Download
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Post-payroll reports"
        title="Post-payroll reports"
        onClick={() => (open ? closeAll(false) : openMenu())}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
            e.preventDefault();
            openMenu();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            closeAll(false);
          }
        }}
        className={cn("btn btn-outline btn-sm !rounded-lg inline-flex items-center gap-1.5", open && "bg-slate-50")}
      >
        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
        Post-payroll reports
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>

      {open && layout === "popover"
        ? portal(
            <div
              ref={panelRef}
              role={report ? "dialog" : "menu"}
              aria-label={title}
              onKeyDown={onPanelKey}
              className={cn(PANEL_BASE, "fixed z-[9990] max-h-[calc(100dvh-16px)] w-[320px] max-w-[calc(100vw-16px)] overflow-y-auto")}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              {report ? form : bankView ? bankForm : list}
            </div>,
          )
        : null}

      {open && layout === "sheet"
        ? portal(
            <div className="fixed inset-0 z-[9990]">
              <div className="absolute inset-0 bg-slate-900/40" aria-hidden onClick={() => closeAll(true)} />
              <div
                ref={panelRef}
                role={report ? "dialog" : "menu"}
                aria-label={title}
                onKeyDown={onPanelKey}
                className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6 shadow-2xl"
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <p className="text-[15px] font-semibold text-slate-900">Post-payroll reports</p>
                  <button type="button" aria-label="Close post-payroll reports" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => closeAll(true)}>
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                {report ? form : bankView ? bankForm : list}
              </div>
            </div>,
          )
        : null}

      <PeriodReportPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type={report === "division-wise" ? "division-wise" : "tds"}
        months={tdsMonths}
        downloading={busy}
        onDownload={() => void download()}
      />
    </>
  );
}
