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
import { ChevronDown, ClipboardList, Download, FileSpreadsheet, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/dateInputs";
import {
  buildDownloadsMenu,
  menuKeyAction,
  monthKey,
  type MenuItem,
  type MenuItemId,
  type MenuLayout,
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
  running: boolean;
  /** Nothing to export yet (same flag the old Preview Excel / Extract buttons used). */
  exportDisabled: boolean;
  /** Existing page functions. They toast their own result and resolve true when a file was saved. */
  onPreviewExcel: () => Promise<boolean>;
  onExtract: () => Promise<boolean>;
  /** Test/preview hooks: render open, force a layout. */
  defaultOpen?: boolean;
  forceLayout?: MenuLayout;
  /** Render panels in place instead of a portal (server-render tests). */
  renderInline?: boolean;
};

const ROW_ICON: Record<string, typeof FileSpreadsheet> = {
  "preview-excel": FileSpreadsheet,
  extract: ClipboardList,
};

const MENU_ID = "downloads";

/**
 * Run Payroll "Downloads" button + dropdown: Preview Excel and Extract for the selected month. Post-payroll
 * reports and the Bank Letter live in their own "Post-payroll reports" menu next to it.
 */
export function DownloadsMenu({
  runMonth, runYear, running, exportDisabled, onPreviewExcel, onExtract,
  defaultOpen = false, forceLayout, renderInline = false,
}: Props) {
  const { showToast } = useToast();
  const ym = monthKey(runYear, runMonth);
  const model = useMemo(() => buildDownloadsMenu({ running, exportDisabled, ym }), [running, exportDisabled, ym]);
  const phone = usePhoneLayout();
  const layout: MenuLayout = forceLayout ?? (phone ? "sheet" : "popover");

  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<MenuItemId | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const registerRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const closeAll = useCallback((returnFocus: boolean) => {
    setOpen(false);
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

  // Outside click / touch closes the menu, except clicks inside our own panel.
  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closeAll(false);
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
    };
  }, [open, closeAll]);

  // Focus the first row when the menu opens.
  useEffect(() => {
    if (open) rowRefs.current.get(focusId ?? model.payroll[0].id)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openMenu = useCallback(() => {
    window.dispatchEvent(new CustomEvent(TOOLBAR_MENU_EVENT, { detail: MENU_ID }));
    setOpen(true);
  }, []);

  async function runItem(item: MenuItem) {
    if (item.disabledReason || busyId === item.id) return;
    setBusyId(item.id);
    try {
      let ok = true;
      if (item.id === "preview-excel") ok = await onPreviewExcel();
      else if (item.id === "extract") ok = await onExtract();
      if (ok) closeAll(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  const rows = model.payroll;

  function onPanelKey(e: ReactKeyboardEvent) {
    const idx = rows.findIndex((r) => r.id === document.activeElement?.getAttribute("data-row-id"));
    const result = menuKeyAction("root", "item", rows.length, idx, e.key);
    if (result.type === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (result.type === "focus") rowRefs.current.get(rows[result.index].id)?.focus();
    else if (result.type === "close-menu") closeAll(true);
    else if (result.type === "activate" && idx >= 0) void runItem(rows[idx]);
  }

  const triggerAnchor = useCallback(() => triggerRef.current, []);
  const pos = useAnchoredPosition(triggerAnchor, panelRef, open && layout === "popover", "bottom-start");
  const inline = layout === "sheet";
  const portal = (node: ReactNode) => (renderInline ? node : typeof document === "undefined" ? null : createPortal(node, document.body));

  const list = (
    <>
      <SectionHeader>Payroll</SectionHeader>
      {rows.map((item) => (
        <MenuRow
          key={item.id}
          id={item.id}
          item={item}
          label={item.label}
          description={item.description}
          tag={item.tag}
          icon={ROW_ICON[item.id] ?? FileSpreadsheet}
          disabledReason={item.disabledReason}
          busy={busyId === item.id}
          focusId={focusId ?? rows[0].id}
          inlineReason={inline}
          registerRef={registerRef}
          onFocusRow={setFocusId}
          onActivate={() => void runItem(item)}
        />
      ))}
    </>
  );

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
            <div
              ref={panelRef}
              role="menu"
              aria-label="Downloads"
              onKeyDown={onPanelKey}
              className={cn(PANEL_BASE, "fixed z-[9990] max-h-[calc(100dvh-16px)] w-[288px] max-w-[calc(100vw-16px)] overflow-y-auto")}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              {list}
            </div>,
          )
        : null}

      {open && layout === "sheet"
        ? portal(
            <div className="fixed inset-0 z-[9990]">
              <div className="absolute inset-0 bg-slate-900/40" aria-hidden onClick={() => closeAll(true)} />
              <div
                ref={panelRef}
                role="menu"
                aria-label="Downloads"
                onKeyDown={onPanelKey}
                className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6 shadow-2xl"
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <p className="text-[15px] font-semibold text-slate-900">Downloads · {formatMonthLabel(ym) || ym}</p>
                  <button type="button" aria-label="Close downloads" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => closeAll(true)}>
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                {list}
              </div>
            </div>,
          )
        : null}
    </>
  );
}
