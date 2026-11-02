"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  /** Preferred panel height used to decide whether to open upwards. */
  estimatedHeight?: number;
  children: ReactNode;
};

const PANEL_WIDTH = 288;

/** useLayoutEffect warns during server rendering; the popup only ever opens in the browser. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Shared popup for DateInput / MonthInput. Rendered in a portal so it is never clipped by overflow containers,
 * positioned under the field (or above when there is no room, clamped to the viewport so it works on phones),
 * and closed by outside click/touch or Escape.
 */
export function PickerPopover({ open, anchorRef, onClose, label, estimatedHeight = 360, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, PANEL_WIDTH), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    const below = r.bottom + 6;
    const top = below + estimatedHeight > window.innerHeight - 8 && r.top - estimatedHeight - 6 > 8 ? r.top - estimatedHeight - 6 : below;
    setPos({ top, left, width });
  }, [anchorRef, estimatedHeight]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      data-picker-popover=""
      role="dialog"
      aria-label={label}
      className="fixed z-[9999] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/40 ring-1 ring-slate-900/5"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {children}
    </div>,
    document.body,
  );
}
