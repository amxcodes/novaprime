import { useCallback, useEffect, useLayoutEffect, useState, type RefCallback } from "react";

export const WORK_COMPACT_CONTAINER_MAX_PX = 640;
const useResponsiveLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function isCompactWorkContainer(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= WORK_COMPACT_CONTAINER_MAX_PX;
}

/** Tracks the actual collection width so embedded and split-view screens adapt too. */
export function useCompactWorkContainer<T extends HTMLElement = HTMLElement>(): [RefCallback<T>, boolean] {
  const [container, setContainer] = useState<T | null>(null);
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && isCompactWorkContainer(window.innerWidth),
  );
  const ref = useCallback((element: T | null) => setContainer(element), []);

  useResponsiveLayoutEffect(() => {
    const element = container;
    if (!element) return;

    const update = () => {
      const next = isCompactWorkContainer(element.getBoundingClientRect().width);
      setCompact((current) => current === next ? current : next);
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  return [ref, compact];
}
