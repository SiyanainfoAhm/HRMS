"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PayrollScrollerHandle = {
  scrollLeft: () => void;
  scrollRight: () => void;
  startScroll: (direction: "left" | "right") => void;
  stopScroll: () => void;
};

type Props = {
  children: ReactNode;
  className?: string;
};

/** Horizontal payroll field scroller: visible rail on top only; content area scrolls with hidden native bar. */
export const PayrollComponentScroller = forwardRef<PayrollScrollerHandle, Props>(function PayrollComponentScroller(
  { children, className = "" },
  ref,
) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const contentInnerRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const syncing = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const directionRef = useRef<-1 | 1>(1);

  useEffect(() => {
    const el = contentInnerRef.current;
    if (!el) return;
    const update = () => setContentWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const syncScroll = useCallback((source: "content" | "top") => {
    if (syncing.current) return;
    syncing.current = true;
    const content = contentScrollRef.current;
    const top = topScrollRef.current;
    if (content && top) {
      if (source === "content") top.scrollLeft = content.scrollLeft;
      else content.scrollLeft = top.scrollLeft;
    }
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const scrollLeft = useCallback(
    () => contentScrollRef.current?.scrollBy({ left: -400, behavior: "smooth" }),
    [],
  );
  const scrollRight = useCallback(
    () => contentScrollRef.current?.scrollBy({ left: 400, behavior: "smooth" }),
    [],
  );
  const stopScroll = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);
  const startScroll = useCallback((direction: "left" | "right") => {
    stopScroll();
    directionRef.current = direction === "left" ? -1 : 1;
    const step = () => {
      const content = contentScrollRef.current;
      if (!content) return;
      const before = content.scrollLeft;
      content.scrollLeft += directionRef.current * 12;
      if (content.scrollLeft === before) {
        stopScroll();
        return;
      }
      animationFrameRef.current = requestAnimationFrame(step);
    };
    animationFrameRef.current = requestAnimationFrame(step);
  }, [stopScroll]);

  useEffect(() => {
    const stop = () => stopScroll();
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      stopScroll();
    };
  }, [stopScroll]);

  useImperativeHandle(ref, () => ({ scrollLeft, scrollRight, startScroll, stopScroll }), [scrollLeft, scrollRight, startScroll, stopScroll]);

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <div
        ref={topScrollRef}
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label="Scroll payroll fields horizontally"
        className="h-3.5 shrink-0 overflow-x-auto overflow-y-hidden rounded-t-lg border border-b-0 border-slate-200 bg-slate-100/90"
        onScroll={() => syncScroll("top")}
      >
        <div style={{ width: Math.max(contentWidth, 1), height: 1 }} aria-hidden />
      </div>
      <div
        ref={contentScrollRef}
        className="payroll-content-scroll overflow-x-auto overflow-y-visible overscroll-x-contain rounded-b-lg border border-slate-200 bg-slate-50/50 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        onScroll={() => syncScroll("content")}
      >
        <div ref={contentInnerRef} className="w-max min-w-full p-3">
          {children}
        </div>
      </div>
    </div>
  );
});
