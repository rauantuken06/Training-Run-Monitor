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

export type ParsedStep = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string };

/**
 * Parse a step typed by a user. Steps are whole, non-negative numbers. Digit
 * groups may be separated by commas or spaces ("5,000", "5 000"), as the UI
 * displays them. A "." is rejected instead of guessed: "5.000" means 5 in
 * en-US but 5000 in de-DE. Regression: it was silently read as step 5.
 */
export function parseStepInput(text: string): ParsedStep {
  const t = text.trim();
  if (t === '') return { ok: false, reason: 'Enter a step number.' };
  if (t.includes('.')) return { ok: false, reason: `"${t}": steps are whole numbers; write 5000 or 5,000 (not 5.000).` };
  if (/^\d+$/.test(t) || /^\d{1,3}(,\d{3})+$/.test(t) || /^\d{1,3}([ \u00a0\u202f]\d{3})+$/.test(t)) {
    const value = Number(t.replace(/[, \u00a0\u202f]/g, ''));
    if (Number.isSafeInteger(value)) return { ok: true, value };
  }
  return { ok: false, reason: `"${t}" is not a whole step number (examples: 5000, 5,000).` };
}

export type RangeRequest =
  | { readonly ok: true; readonly viewport: Viewport; readonly adjusted: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a typed step range against the data. A range partly outside the
 * data is cut down to the part that has data, never shifted.
 * Regression: 19,000–25,000 used to show 13,990–19,990, steps nobody asked for.
 */
export function requestRange(fromText: string, toText: string, extent: StepExtent): RangeRequest {
  const a = parseStepInput(fromText);
  if (!a.ok) return { ok: false, error: `From: ${a.reason}` };
  const b = parseStepInput(toText);
  if (!b.ok) return { ok: false, error: `To: ${b.reason}` };
  if (a.value >= b.value) return { ok: false, error: '"From" must be smaller than "To".' };
  if (b.value < extent.min || a.value > extent.max) {
    return {
      ok: false,
      error: `No data in steps ${a.value.toLocaleString('en-US')}–${b.value.toLocaleString('en-US')}; this run has steps ${extent.min.toLocaleString('en-US')}–${extent.max.toLocaleString('en-US')}.`,
    };
  }
  const minStep = Math.max(a.value, extent.min);
  const maxStep = Math.min(b.value, extent.max);
  return { ok: true, viewport: { minStep, maxStep }, adjusted: minStep !== a.value || maxStep !== b.value };
}

/** Map a horizontal pixel inside the plot area to a step (linear axis from minStep to maxStep). */
export function pixelToStep(x: number, plotLeft: number, plotWidth: number, vp: Viewport): number {
  const t = Math.min(1, Math.max(0, (x - plotLeft) / plotWidth));
  return vp.minStep + t * (vp.maxStep - vp.minStep);
}
