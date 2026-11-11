import { useLayoutEffect, useState, type RefObject } from 'react';

/** Width used when layout reports no width (e.g. test DOMs without layout). */
export const FALLBACK_WIDTH = 640;

/**
 * Content width of an element in CSS px, updated on resize. Returns `null` until
 * the first measurement, which happens in a layout effect (before paint), so a
 * chart can wait for the real width instead of downsampling once for a guessed
 * width and again for the real one (measured in Task 08: every chart did this on
 * load). If layout reports 0, `FALLBACK_WIDTH` is used.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      setWidth((prev) => (w > 0 ? w : (prev ?? FALLBACK_WIDTH)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
