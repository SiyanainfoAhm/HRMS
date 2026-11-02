"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, Landmark, Loader2, ClipboardList, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { MonthInput } from "@/components/ui/MonthInput";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/dateInputs";
import {
  PHONE_MAX_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_OPEN_DELAY_MS,
  bankFormatOf,
  buildDownloadsMenu,
  computePanelPosition,
  menuKeyAction,
  monthKey,
  reportTypeOf,
  tdsRangeError,
  type BankLetterFormatId,
  type MenuItem,
  type MenuItemId,
  type MenuLayout,
  type MenuSubmenuId,
  type PanelPlacement,
} from "@/lib/downloadsMenuModel";
import { downloadPostPayrollReport } from "@/lib/postPayrollDownload";

type Props = {
  /** The page's own month/year selectors; the only month input. */
  runMonth: string;
  runYear: string;
  canManage: boolean;
  running: boolean;
  /** Nothing to export yet (same flag the old Preview Excel / Extract / Bank Letter buttons used). */
  exportDisabled: boolean;
  bankLetterLoading: boolean;
  /** Selected month is generated (and the loaded preview is for that month). */
  generated: boolean;
  /** Existing page functions. They toast their own result and resolve true when a file was saved. */
  onPreviewExcel: () => Promise<boolean>;
  onExtract: () => Promise<boolean>;
  onBankLetter: (format: BankLetterFormatId) => Promise<boolean>;
  onExportEmployeePayroll: () => void;
  /** Test/preview hooks: render open, force a layout, pre-open a submenu. */
  defaultOpen?: boolean;
  forceLayout?: MenuLayout;
  defaultSubmenu?: MenuSubmenuId | null;
  /** Render panels in place instead of a portal (server-render tests). */
  renderInline?: boolean;
};

const ROW_ICON: Record<string, typeof FileText> = {
  "preview-excel": FileSpreadsheet,
  extract: ClipboardList,
  "export-employee-payroll": FileSpreadsheet,
};

function iconFor(item: MenuItem): typeof FileText {
  if (ROW_ICON[item.id]) return ROW_ICON[item.id];
  return item.tag === "Letter" ? FileText : FileSpreadsheet;
}

/** matchMedia as an external store: no setState-in-effect, SSR-safe (renders the desktop layout on the server). */
function usePhoneLayout(): boolean {
  const query = `(max-width: ${PHONE_MAX_WIDTH}px)`;
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Position a portal panel next to an anchor, re-measured on scroll/resize and after it renders (so flipping uses real size). */
function useAnchoredPosition(getAnchor: () => HTMLElement | null, panelRef: RefObject<HTMLElement | null>, active: boolean, placement: PanelPlacement) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = useCallback(() => {
    const anchor = getAnchor();
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const size = { width: panelRef.current?.offsetWidth ?? 280, height: panelRef.current?.offsetHeight ?? 260 };
    const next = computePanelPosition(
      { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      size,
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : { top: next.top, left: next.left }));
  }, [getAnchor, panelRef, placement]);
  useIsoLayoutEffect(() => {
    if (!active) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [active, place]);
  // Measure again once the panel has its real size.
  useIsoLayoutEffect(() => {
    if (active) place();
  });
  return pos;
}

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />;
}

type RowProps = {
  id: string;
  item?: MenuItem;
  label: string;
  description?: string;
  tag?: string;
  icon: typeof FileText;
  disabledReason?: string | null;
  busy?: boolean;
  focusId: string | null;
  isSubmenu?: boolean;
  expanded?: boolean;
  /** Phone sheet shows the reason inline instead of as a hover tooltip. */
  inlineReason?: boolean;
  registerRef: (id: string, el: HTMLButtonElement | null) => void;
  onActivate: () => void;
  onFocusRow: (id: string) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
};

function MenuRow({
  id, label, description, tag, icon: Icon, disabledReason, busy, focusId, isSubmenu, expanded, inlineReason,
  registerRef, onActivate, onFocusRow, onPointerEnter, onPointerLeave,
}: RowProps) {
  const reasonId = useId();
  const disabled = Boolean(disabledReason) || Boolean(busy);
  return (
    <div className="group relative" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <button
        ref={(el) => registerRef(id, el)}
        type="button"
        role="menuitem"
        data-row-id={id}
        tabIndex={focusId === id ? 0 : -1}
        aria-disabled={disabled || undefined}
        aria-haspopup={isSubmenu ? "menu" : undefined}
        aria-expanded={isSubmenu ? Boolean(expanded) : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        aria-busy={busy || undefined}
        onFocus={() => onFocusRow(id)}
        onClick={() => {
          if (isSubmenu || !disabled) onActivate();
        }}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors sm:min-h-[40px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
          disabled && !isSubmenu ? "cursor-not-allowed text-slate-400" : "text-slate-800 hover:bg-slate-50",
          expanded && "bg-slate-50",
        )}
      >
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", disabled && !isSubmenu ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-600")}>
          {busy ? <Spinner /> : <Icon className="h-4 w-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{label}</span>
          {description ? <span className="block truncate text-[11px] font-normal text-slate-500">{description}</span> : null}
          {inlineReason && disabledReason ? <span className="block text-[11px] font-normal text-amber-700">{disabledReason}</span> : null}
        </span>
        {tag ? (
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", disabled && !isSubmenu ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-500")}>{tag}</span>
        ) : null}
        {isSubmenu ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : null}
      </button>
      {disabledReason ? (
        <>
          <span id={reasonId} className="sr-only">{disabledReason}</span>
          {!inlineReason ? (
            <span
              role="tooltip"
              aria-hidden
              className="pointer-events-none absolute left-9 top-full z-20 mt-0.5 hidden w-max max-w-[240px] rounded-md bg-slate-900 px-2 py-1 text-[11px] leading-snug text-white shadow-lg group-hover:block group-focus-within:block"
            >
              {disabledReason}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</p>;
}

export function DownloadsMenu({
  runMonth, runYear, canManage, running, exportDisabled, bankLetterLoading, generated,
  onPreviewExcel, onExtract, onBankLetter, onExportEmployeePayroll,
  defaultOpen = false, forceLayout, defaultSubmenu = null, renderInline = false,
}: Props) {
  const { showToast } = useToast();
  const ym = monthKey(runYear, runMonth);
  const model = useMemo(
    () => buildDownloadsMenu({ canManage, running, exportDisabled, bankLetterLoading, generated, ym }),
    [canManage, running, exportDisabled, bankLetterLoading, generated, ym],
  );
  const phone = usePhoneLayout();
  const layout: MenuLayout = forceLayout ?? (phone ? "sheet" : "popover");

  const [open, setOpen] = useState(defaultOpen);
  const [sub, setSub] = useState<MenuSubmenuId | null>(defaultSubmenu);
  const [tdsOpen, setTdsOpen] = useState(false);
  const [tdsTo, setTdsTo] = useState("");
  const [available, setAvailable] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<MenuItemId | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootPanelRef = useRef<HTMLDivElement>(null);
  const subPanelRef = useRef<HTMLDivElement>(null);
  const tdsPanelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const timer = useRef<number | undefined>(undefined);
  const requestN = useRef(0);

  const registerRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const requestFocus = useCallback((id: string) => {
    requestN.current += 1;
    setFocusId(id);
    setFocusRequest({ id, n: requestN.current });
  }, []);

  // Moves real DOM focus after the target row has rendered.
  useEffect(() => {
    if (focusRequest) rowRefs.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  const closeAll = useCallback((returnFocus: boolean) => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setSub(null);
    setTdsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Outside click / touch closes everything, except clicks inside our own panels or a month-picker popup.
  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      for (const ref of [rootPanelRef, subPanelRef, tdsPanelRef, sheetRef]) if (ref.current?.contains(t)) return;
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

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rootRows = useMemo(() => {
    const rows: { id: string; kind: "item" | "submenu" }[] = model.payroll.map((i) => ({ id: i.id, kind: "item" as const }));
    rows.push({ id: "sub:bank", kind: "submenu" });
    if (model.reports) rows.push({ id: "sub:reports", kind: "submenu" });
    return rows;
  }, [model]);
  const subItems = sub === "bank" ? model.bank : sub === "reports" ? model.reports ?? [] : [];
  const sheetRows = useMemo(
    () => [...model.payroll, ...model.bank, ...(model.reports ?? [])].map((i) => ({ id: i.id as string, kind: "item" as const })),
    [model],
  );

  const openMenu = useCallback(() => {
    setOpen(true);
    const first = model.payroll[0]?.id ?? "sub:bank";
    requestFocus(first);
  }, [model, requestFocus]);

  const openSub = useCallback(
    (which: MenuSubmenuId, focusFirst: boolean) => {
      window.clearTimeout(timer.current);
      setSub(which);
      setTdsOpen(false);
      if (focusFirst) {
        const first = which === "bank" ? model.bank[0]?.id : model.reports?.[0]?.id;
        if (first) requestFocus(first);
      }
    },
    [model, requestFocus],
  );

  const scheduleSub = useCallback(
    (which: MenuSubmenuId | null) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (which) setSub(which);
        else {
          setSub(null);
          setTdsOpen(false);
        }
      }, which ? SUBMENU_OPEN_DELAY_MS : SUBMENU_CLOSE_DELAY_MS);
    },
    [],
  );
  const cancelTimer = useCallback(() => window.clearTimeout(timer.current), []);

  const openTds = useCallback(() => {
    setSub("reports");
    setTdsOpen(true);
    setTdsTo("");
    if (available === null) {
      void (async () => {
        try {
          const res = await fetch("/api/payroll/post-downloads-months", { cache: "no-store" });
          const data = await res.json();
          if (res.ok && Array.isArray(data.months)) setAvailable(data.months);
        } catch {
          /* leave every month selectable; the download itself reports a missing month */
        }
      })();
    }
  }, [available]);

  async function runItem(item: MenuItem) {
    if (item.disabledReason || busyId === item.id) return;
    const id = item.id;
    if (id === "export-employee-payroll") {
      closeAll(false);
      onExportEmployeePayroll();
      return;
    }
    if (id === "report-tds") {
      openTds();
      return;
    }
    setBusyId(id);
    try {
      let ok = true;
      const bank = bankFormatOf(id);
      const report = reportTypeOf(id);
      if (id === "preview-excel") ok = await onPreviewExcel();
      else if (id === "extract") ok = await onExtract();
      else if (bank) ok = await onBankLetter(bank);
      else if (report) {
        const name = await downloadPostPayrollReport(report, ym);
        showToast("success", `${name} downloaded.`);
      }
      if (ok) closeAll(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function runTds() {
    const rangeError = tdsRangeError(ym, tdsTo);
    if (rangeError) {
      showToast("error", rangeError);
      return;
    }
    setBusyId("report-tds");
    try {
      const name = await downloadPostPayrollReport("tds", ym, tdsTo || null);
      showToast("success", `${name} downloaded.`);
      closeAll(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  const focusedIndex = (rows: { id: string }[]) => rows.findIndex((r) => r.id === document.activeElement?.getAttribute("data-row-id"));

  function onRootKey(e: ReactKeyboardEvent) {
    const idx = focusedIndex(rootRows);
    const row = rootRows[idx];
    const result = menuKeyAction("root", row?.kind ?? "item", rootRows.length, idx, e.key);
    if (result.type === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (result.type === "focus") requestFocus(rootRows[result.index].id);
    else if (result.type === "close-menu") closeAll(true);
    else if (result.type === "open-submenu" && row) openSub(row.id === "sub:bank" ? "bank" : "reports", true);
    else if (result.type === "activate" && row && row.kind === "item") {
      const item = model.payroll.find((i) => i.id === row.id);
      if (item) void runItem(item);
    }
  }

  function onSubKey(e: ReactKeyboardEvent) {
    const idx = focusedIndex(subItems);
    const result = menuKeyAction("submenu", "item", subItems.length, idx, e.key);
    if (result.type === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (result.type === "focus") requestFocus(subItems[result.index].id);
    else if (result.type === "close-submenu") {
      const back = sub === "bank" ? "sub:bank" : "sub:reports";
      setSub(null);
      setTdsOpen(false);
      requestFocus(back);
    } else if (result.type === "close-menu") closeAll(true);
    else if (result.type === "activate" && idx >= 0) void runItem(subItems[idx]);
  }

  function onSheetKey(e: ReactKeyboardEvent) {
    const idx = focusedIndex(sheetRows);
    const result = menuKeyAction("root", "item", sheetRows.length, idx, e.key);
    if (result.type === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (result.type === "focus") requestFocus(sheetRows[result.index].id);
    else if (result.type === "close-menu") closeAll(true);
    else if (result.type === "activate" && idx >= 0) {
      const item = [...model.payroll, ...model.bank, ...(model.reports ?? [])].find((i) => i.id === sheetRows[idx].id);
      if (item) void runItem(item);
    }
  }

  function onTdsKey(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setTdsOpen(false);
      requestFocus("report-tds");
    }
  }

  // ---- positions
  const triggerAnchor = useCallback(() => triggerRef.current, []);
  const subAnchor = useCallback(() => rowRefs.current.get(sub === "bank" ? "sub:bank" : "sub:reports") ?? null, [sub]);
  const tdsAnchor = useCallback(() => rowRefs.current.get("report-tds") ?? null, []);
  const rootPos = useAnchoredPosition(triggerAnchor, rootPanelRef, open && layout === "popover", "bottom-start");
  const subPos = useAnchoredPosition(subAnchor, subPanelRef, open && layout === "popover" && sub !== null, "right-start");
  const tdsPos = useAnchoredPosition(tdsAnchor, tdsPanelRef, open && layout === "popover" && tdsOpen, "right-start");

  /** Roving tabindex: the focused row, or the first row until something is focused. */
  const tabFocus = focusId ?? model.payroll[0]?.id ?? "sub:bank";

  const commonRow = (item: MenuItem, inline: boolean, rootLevel = false) => (
    <MenuRow
      key={item.id}
      id={item.id}
      item={item}
      label={item.label}
      description={item.description}
      tag={item.tag}
      icon={iconFor(item)}
      disabledReason={item.disabledReason}
      busy={busyId === item.id}
      focusId={tabFocus}
      inlineReason={inline}
      registerRef={registerRef}
      onFocusRow={setFocusId}
      onActivate={() => void runItem(item)}
      onPointerEnter={rootLevel && sub ? () => scheduleSub(null) : undefined}
    />
  );

  const tdsForm = (compact: boolean) => (
    <div className={cn("space-y-3", compact ? "px-1 pb-2 pt-1" : "")}>
      <div>
        <span className="label-field">From</span>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700" aria-label="From month">
          {formatMonthLabel(ym) || ym}
        </p>
      </div>
      <div>
        <span className="label-field">To month (optional)</span>
        <MonthInput aria-label="To month" optional value={tdsTo} min={ym} available={available} unavailableReason="No payroll generated" onChange={setTdsTo} />
        {tdsRangeError(ym, tdsTo) ? <p role="alert" className="mt-1 text-[11px] text-red-600">{tdsRangeError(ym, tdsTo)}</p> : null}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setTdsOpen(false); requestFocus("report-tds"); }}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
          disabled={busyId === "report-tds" || Boolean(tdsRangeError(ym, tdsTo))}
          onClick={() => void runTds()}
        >
          {busyId === "report-tds" ? <Spinner /> : <Download className="h-3.5 w-3.5" aria-hidden />}
          Download
        </button>
      </div>
    </div>
  );

  const panelBase =
    "rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-[0_12px_28px_-8px_rgba(15,23,42,0.18)] ring-1 ring-black/5";

  const portal = (node: ReactNode) => (renderInline ? node : typeof document === "undefined" ? null : createPortal(node, document.body));

  const reportsHint = model.reportsHint;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Downloads for ${formatMonthLabel(ym) || ym}`}
        title={`Downloads for ${formatMonthLabel(ym) || ym}`}
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
        <Download className="h-3.5 w-3.5" aria-hidden />
        Downloads
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>

      {open && layout === "popover"
        ? portal(
            <>
              <div
                ref={rootPanelRef}
                role="menu"
                aria-label="Downloads"
                onKeyDown={onRootKey}
                className={cn(panelBase, "fixed z-[9990] w-[288px]")}
                style={{ top: rootPos?.top ?? -9999, left: rootPos?.left ?? -9999 }}
              >
                <SectionHeader>Payroll</SectionHeader>
                {model.payroll.map((item) => commonRow(item, false, true))}
                <div className="my-1.5 border-t border-slate-100" role="separator" />
                <MenuRow
                  id="sub:bank"
                  label="Bank Letter"
                  description="Salary advice for the bank"
                  icon={Landmark}
                  isSubmenu
                  expanded={sub === "bank"}
                  focusId={tabFocus}
                  registerRef={registerRef}
                  onFocusRow={setFocusId}
                  onActivate={() => openSub("bank", true)}
                  onPointerEnter={() => scheduleSub("bank")}
                  onPointerLeave={() => scheduleSub(null)}
                />
                {model.reports ? (
                  <MenuRow
                    id="sub:reports"
                    label="Post-payroll reports"
                    description="TDS, CPF / VPF, Division-wise, Paybill"
                    icon={ClipboardList}
                    isSubmenu
                    expanded={sub === "reports"}
                    focusId={tabFocus}
                    registerRef={registerRef}
                    onFocusRow={setFocusId}
                    onActivate={() => openSub("reports", true)}
                    onPointerEnter={() => scheduleSub("reports")}
                    onPointerLeave={() => scheduleSub(null)}
                  />
                ) : null}
              </div>

              {sub ? (
                <div
                  ref={subPanelRef}
                  role="menu"
                  aria-label={sub === "bank" ? "Bank letter format" : "Post-payroll reports"}
                  onKeyDown={onSubKey}
                  onPointerEnter={cancelTimer}
                  onPointerLeave={() => scheduleSub(null)}
                  className={cn(panelBase, "fixed z-[9991] w-[272px]")}
                  style={{ top: subPos?.top ?? -9999, left: subPos?.left ?? -9999 }}
                >
                  <SectionHeader>{sub === "bank" ? "Choose format" : `Reports for ${formatMonthLabel(ym) || ym}`}</SectionHeader>
                  {sub === "reports" && reportsHint ? (
                    <p className="mx-2.5 mb-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{reportsHint}</p>
                  ) : null}
                  {subItems.map((item) => commonRow(item, false))}
                </div>
              ) : null}

              {sub === "reports" && tdsOpen ? (
                <div
                  ref={tdsPanelRef}
                  role="dialog"
                  aria-label="TDS Data range"
                  onKeyDown={onTdsKey}
                  onPointerEnter={cancelTimer}
                  className={cn(panelBase, "fixed z-[9992] w-[264px] p-3")}
                  style={{ top: tdsPos?.top ?? -9999, left: tdsPos?.left ?? -9999 }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-slate-800">TDS Data</p>
                    <button type="button" aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => { setTdsOpen(false); requestFocus("report-tds"); }}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  {tdsForm(false)}
                </div>
              ) : null}
            </>,
          )
        : null}

      {open && layout === "sheet"
        ? portal(
            <div className="fixed inset-0 z-[9990]">
              <div className="absolute inset-0 bg-slate-900/40" aria-hidden onClick={() => closeAll(true)} />
              <div
                ref={sheetRef}
                role="menu"
                aria-label="Downloads"
                onKeyDown={onSheetKey}
                className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6 shadow-2xl"
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <p className="text-[15px] font-semibold text-slate-900">Downloads · {formatMonthLabel(ym) || ym}</p>
                  <button type="button" aria-label="Close downloads" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => closeAll(true)}>
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <div role="group" aria-label="Payroll">
                  <SectionHeader>Payroll</SectionHeader>
                  {model.payroll.map((item) => commonRow(item, true))}
                </div>
                <div role="group" aria-label="Bank Letter" className="mt-1 border-t border-slate-100">
                  <SectionHeader>Bank Letter</SectionHeader>
                  {model.bank.map((item) => commonRow(item, true))}
                </div>
                {model.reports ? (
                  <div role="group" aria-label="Post-payroll reports" className="mt-1 border-t border-slate-100">
                    <SectionHeader>Post-payroll reports</SectionHeader>
                    {model.reports.map((item) => commonRow(item, true))}
                    {sub === "reports" && tdsOpen ? (
                      <div ref={tdsPanelRef} role="dialog" aria-label="TDS Data range" onKeyDown={onTdsKey} className="mx-1 mt-1 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        {tdsForm(true)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>,
          )
        : null}
    </>
  );
}
