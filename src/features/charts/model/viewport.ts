import type { Viewport } from '../../data/downsampling/downsample';
import type { ChartView } from '../../data/integrity/analyzeRun';
import { stepAt } from '../../data/integrity/analyzeRun';

/** Inclusive step range that holds data. */
export interface StepExtent {
  readonly min: number;
  readonly max: number;
}

/** Smallest and largest displayed step, or `null` when the run has no placeable records. */
export function dataExtent(view: ChartView): StepExtent | null {
  const n = view.displayIndex.length;
  if (n === 0) return null;
  return { min: stepAt(view, 0), max: stepAt(view, n - 1) };
}

/**
 * Keep a viewport inside the data extent, with integer bounds and a span of at
 * least `minSpan` steps (when the data allows). Integer bounds keep axis labels
 * and the "visible steps" text exact.
 */
export function clampViewport(vp: Viewport, extent: StepExtent, minSpan = 1): Viewport {
  const fullSpan = extent.max - extent.min;
  const span = Math.min(fullSpan, Math.max(minSpan, Math.round(vp.maxStep - vp.minStep)));
  let min = Math.round(vp.minStep);
  min = Math.max(extent.min, Math.min(min, extent.max - span));
  return { minStep: min, maxStep: min + span };
}

/** Scale the span by `factor` (< 1 zooms in) around `center` (default: the middle). */
export function zoomViewport(vp: Viewport, factor: number, extent: StepExtent, center?: number): Viewport {
  const mid = center ?? (vp.minStep + vp.maxStep) / 2;
  const span = (vp.maxStep - vp.minStep) * factor;
  const ratio = vp.maxStep === vp.minStep ? 0.5 : (mid - vp.minStep) / (vp.maxStep - vp.minStep);
  return clampViewport({ minStep: mid - span * ratio, maxStep: mid - span * ratio + span }, extent);
}

/** Shift by `fraction` of the current span (negative = left). */
export function panViewport(vp: Viewport, fraction: number, extent: StepExtent): Viewport {
  const delta = (vp.maxStep - vp.minStep) * fraction;
  return clampViewport({ minStep: vp.minStep + delta, maxStep: vp.maxStep + delta }, extent);
}

export function fullViewport(extent: StepExtent): Viewport {
  return { minStep: extent.min, maxStep: extent.max };
}

export function isFullViewport(vp: Viewport, extent: StepExtent): boolean {
  return vp.minStep <= extent.min && vp.maxStep >= extent.max;
}

/** Map a horizontal pixel inside the plot area to a step (linear axis from minStep to maxStep). */
export function pixelToStep(x: number, plotLeft: number, plotWidth: number, vp: Viewport): number {
  const t = Math.min(1, Math.max(0, (x - plotLeft) / plotWidth));
  return vp.minStep + t * (vp.maxStep - vp.minStep);
}
