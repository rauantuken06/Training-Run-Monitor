import { useEffect, useState, type RefObject } from 'react';

/** Width used before (or without) a layout measurement, e.g. in test DOMs. */
export const FALLBACK_WIDTH = 640;

/**
 * Content width of an element in CSS px, updated on resize. Returns
 * `FALLBACK_WIDTH` until a positive width has been measured.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
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
