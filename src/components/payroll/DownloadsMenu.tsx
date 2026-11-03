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
import { ChevronDown, Download, FileSpreadsheet, FileText, Landmark, ClipboardList, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/dateInputs";
import {
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_OPEN_DELAY_MS,
  bankFormatOf,
  buildDownloadsMenu,
  menuKeyAction,
  monthKey,
  type BankLetterFormatId,
  type MenuItem,
  type MenuItemId,
  type MenuLayout,
  type MenuSubmenuId,
} from "@/lib/downloadsMenuModel";
import {
  MenuRow,
  PANEL_BASE,
  SectionHeader,
  TOOLBAR_MENU_EVENT,
  useAnchoredPosition,
  usePhoneLayout,
} from "./downloadsMenuParts";

type Props = {
  /** The page's own month/year selectors; the only month input. */
  runMonth: string;
  runYear: string;
  canManage: boolean;
  running: boolean;
  /** Nothing to export yet (same flag the old Preview Excel / Extract / Bank Letter buttons used). */
  exportDisabled: boolean;
  bankLetterLoading: boolean;
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

const MENU_ID = "downloads";

export function DownloadsMenu({
  runMonth, runYear, canManage, running, exportDisabled, bankLetterLoading,
  onPreviewExcel, onExtract, onBankLetter, onExportEmployeePayroll,
  defaultOpen = false, forceLayout, defaultSubmenu = null, renderInline = false,
}: Props) {
  const { showToast } = useToast();
  const ym = monthKey(runYear, runMonth);
  const model = useMemo(
    () => buildDownloadsMenu({ canManage, running, exportDisabled, bankLetterLoading, ym }),
    [canManage, running, exportDisabled, bankLetterLoading, ym],
  );
  const phone = usePhoneLayout();
  const layout: MenuLayout = forceLayout ?? (phone ? "sheet" : "popover");

  const [open, setOpen] = useState(defaultOpen);
  const [sub, setSub] = useState<MenuSubmenuId | null>(defaultSubmenu);
  const [busyId, setBusyId] = useState<MenuItemId | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootPanelRef = useRef<HTMLDivElement>(null);
  const subPanelRef = useRef<HTMLDivElement>(null);
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
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Opening the other toolbar menu closes this one (they never overlap).
  useEffect(() => {
    function onOther(e: Event) {
      if ((e as CustomEvent<string>).detail !== MENU_ID) closeAll(false);
    }
    window.addEventListener(TOOLBAR_MENU_EVENT, onOther);
    return () => window.removeEventListener(TOOLBAR_MENU_EVENT, onOther);
  }, [closeAll]);

  // Outside click / touch closes everything, except clicks inside our own panels.
  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      for (const ref of [rootPanelRef, subPanelRef, sheetRef]) if (ref.current?.contains(t)) return;
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
    return rows;
  }, [model]);
  const subItems = sub === "bank" ? model.bank : [];
  const sheetRows = useMemo(() => [...model.payroll, ...model.bank].map((i) => ({ id: i.id as string, kind: "item" as const })), [model]);

  const openMenu = useCallback(() => {
    window.dispatchEvent(new CustomEvent(TOOLBAR_MENU_EVENT, { detail: MENU_ID }));
    setOpen(true);
    const first = model.payroll[0]?.id ?? "sub:bank";
    requestFocus(first);
  }, [model, requestFocus]);

  const openSub = useCallback(
    (which: MenuSubmenuId, focusFirst: boolean) => {
      window.clearTimeout(timer.current);
      setSub(which);
      if (focusFirst) {
        const first = model.bank[0]?.id;
        if (first) requestFocus(first);
      }
    },
    [model, requestFocus],
  );

  const scheduleSub = useCallback(
    (which: MenuSubmenuId | null) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSub(which), which ? SUBMENU_OPEN_DELAY_MS : SUBMENU_CLOSE_DELAY_MS);
    },
    [],
  );
  const cancelTimer = useCallback(() => window.clearTimeout(timer.current), []);

  async function runItem(item: MenuItem) {
    if (item.disabledReason || busyId === item.id) return;
    const id = item.id;
    if (id === "export-employee-payroll") {
      closeAll(false);
      onExportEmployeePayroll();
      return;
    }
    setBusyId(id);
    try {
      let ok = true;
      const bank = bankFormatOf(id);
      if (id === "preview-excel") ok = await onPreviewExcel();
      else if (id === "extract") ok = await onExtract();
      else if (bank) ok = await onBankLetter(bank);
      if (ok) closeAll(true);
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
    else if (result.type === "open-submenu" && row) openSub("bank", true);
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
      setSub(null);
      requestFocus("sub:bank");
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
      const item = [...model.payroll, ...model.bank].find((i) => i.id === sheetRows[idx].id);
      if (item) void runItem(item);
    }
  }

  // ---- positions
  const triggerAnchor = useCallback(() => triggerRef.current, []);
  const subAnchor = useCallback(() => rowRefs.current.get("sub:bank") ?? null, []);
  const rootPos = useAnchoredPosition(triggerAnchor, rootPanelRef, open && layout === "popover", "bottom-start");
  const subPos = useAnchoredPosition(subAnchor, subPanelRef, open && layout === "popover" && sub !== null, "right-start");

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

  const portal = (node: ReactNode) => (renderInline ? node : typeof document === "undefined" ? null : createPortal(node, document.body));

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
                className={cn(PANEL_BASE, "fixed z-[9990] max-h-[calc(100dvh-16px)] w-[288px] max-w-[calc(100vw-16px)] overflow-y-auto")}
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
              </div>

              {sub ? (
                <div
                  ref={subPanelRef}
                  role="menu"
                  aria-label="Bank letter format"
                  onKeyDown={onSubKey}
                  onPointerEnter={cancelTimer}
                  onPointerLeave={() => scheduleSub(null)}
                  className={cn(PANEL_BASE, "fixed z-[9991] max-h-[calc(100dvh-16px)] w-[272px] max-w-[calc(100vw-16px)] overflow-y-auto")}
                  style={{ top: subPos?.top ?? -9999, left: subPos?.left ?? -9999 }}
                >
                  <SectionHeader>Choose format</SectionHeader>
                  {subItems.map((item) => commonRow(item, false))}
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
              </div>
            </div>,
          )
        : null}
    </>
  );
}
