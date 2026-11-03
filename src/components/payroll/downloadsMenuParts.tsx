"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { PHONE_MAX_WIDTH, computePanelPosition, type MenuItem, type PanelPlacement } from "@/lib/downloadsMenuModel";

/** Shared pieces of the Downloads menu and the Post-payroll reports menu. */
export const PANEL_BASE =
  "rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-[0_12px_28px_-8px_rgba(15,23,42,0.18)] ring-1 ring-black/5";

/** One toolbar menu opens at a time: opening broadcasts its id and every other menu closes itself. */
export const TOOLBAR_MENU_EVENT = "payroll-toolbar-menu-open";

/** matchMedia as an external store: no setState-in-effect, SSR-safe (renders the desktop layout on the server). */
export function usePhoneLayout(): boolean {
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
export function useAnchoredPosition(getAnchor: () => HTMLElement | null, panelRef: RefObject<HTMLElement | null>, active: boolean, placement: PanelPlacement) {
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

export function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />;
}

type RowProps = {
  id: string;
  item?: MenuItem;
  label: string;
  description?: string;
  tag?: string;
  icon: LucideIcon;
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

export function MenuRow({
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

export function SectionHeader({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</p>;
}

