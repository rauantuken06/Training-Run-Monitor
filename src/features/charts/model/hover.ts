import type { DuplicateStepIssue, MissingStepsIssue } from '../../../types/training';
import type { InvalidRun, PlotPoint } from '../../data/downsampling/downsample';
import { stepAt, type ChartView } from '../../data/integrity/analyzeRun';
import { describeValue, formatCount } from '../../runs/format';
import { METRIC_LABEL } from '../../runs/labels';
import type { ChartModel } from './chartModel';

export interface HoverInfo {
  /** The step under the cursor (fractional: the cursor is between steps). */
  readonly cursorStep: number;
  /** Steps covered by the cursor's pixel column: [cursorStep − half, cursorStep + half]. */
  readonly window: { readonly from: number; readonly to: number };
  /** Displayed records (finite or not) whose step lies in `window`. */
  readonly observationsInWindow: number;
  /** The plotted observation nearest to the cursor (an existing record), if any. */
  readonly nearest: PlotPoint | null;
  /**
   * True only when the cursor's pixel holds exactly one observation and it is
   * `nearest`. Only then is the tooltip "the value under the cursor"; otherwise
   * it is labelled as the nearest plotted observation.
   */
  readonly exact: boolean;
  /** Set when the nearest point's step was logged several times with differing values. */
  readonly conflict: DuplicateStepIssue | null;
  /** Invalid stretches (NaN / ±Infinity / null) within a few pixels of the cursor. */
  readonly invalid: readonly InvalidRun[];
  /** A missing-step range containing the cursor. */
  readonly gap: MissingStepsIssue | null;
}

/** Number of display positions whose step is < `step` (binary search; steps ascend). */
function positionsBefore(view: ChartView, step: number): number {
  let lo = 0;
  let hi = view.displayIndex.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (stepAt(view, mid) < step) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * What lies under the cursor at (fractional) `cursorStep`, given how many steps
 * one pixel spans. Reads the model and the view only: no re-analysis, no
 * downsampling, no interpolation; O(log n).
 */
export function describeHover(model: ChartModel, view: ChartView, cursorStep: number, stepsPerPixel: number): HoverInfo {
  const { points, invalidRuns, gaps, conflicts } = model.result;
  const half = Math.max(0.5, stepsPerPixel / 2);
  const window = { from: cursorStep - half, to: cursorStep + half };
  const observationsInWindow = positionsBefore(view, window.to + Number.EPSILON * Math.abs(window.to)) - positionsBefore(view, window.from);

  let nearest: PlotPoint | null = null;
  if (points.length > 0) {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((points[mid] as PlotPoint).step < cursorStep) lo = mid + 1;
      else hi = mid;
    }
    const after = points[lo] as PlotPoint;
    const before = points[lo - 1];
    nearest = before && Math.abs(before.step - cursorStep) <= Math.abs(after.step - cursorStep) ? before : after;
  }
  const exact = nearest !== null && observationsInWindow === 1 && nearest.step >= window.from && nearest.step <= window.to;
  const tolerance = Math.max(0.5, stepsPerPixel * 4);
  return {
    cursorStep,
    window,
    observationsInWindow,
    nearest,
    exact,
    conflict: nearest ? (conflicts.find((c) => c.step === nearest.step) ?? null) : null,
    invalid: invalidRuns.filter((r) => r.endStep >= cursorStep - tolerance && r.startStep <= cursorStep + tolerance),
    gap: gaps.find((g) => g.afterStep < cursorStep && g.beforeStep > cursorStep) ?? null,
  };
}

const KIND_TEXT = { nan: 'NaN', positive_infinity: '+Infinity', negative_infinity: '-Infinity', missing: 'not recorded (null)' } as const;

function valueText(value: number): string {
  const d = describeValue(value);
  return d.text === d.exact ? d.text : `${d.text} (exact ${d.exact})`;
}

/**
 * Plain-text lines for a hover (used for the tooltip and tests). The first line
 * says what the cursor is on, and never presents a neighbouring observation's
 * step as the hovered step.
 */
export function hoverLines(model: ChartModel, info: HoverInfo): string[] {
  const lines: string[] = [];
  const label = METRIC_LABEL[model.metric];
  const { nearest } = info;

  if (info.exact && nearest) {
    lines.push(`Step ${formatCount(nearest.step)}`);
    lines.push(`${label}: ${valueText(nearest.value)}`);
  } else {
    const from = Math.ceil(info.window.from);
    const to = Math.floor(info.window.to);
    const n = info.observationsInWindow;
    if (to > from) {
      lines.push(`Cursor: steps ${formatCount(from)}–${formatCount(to)} (${formatCount(n)} observation${n === 1 ? '' : 's'} in this pixel)`);
    } else {
      const s = Math.round(info.cursorStep);
      lines.push(`Cursor: step ${formatCount(s)}${n === 0 ? ' (no observation at this step)' : ''}`);
    }
    if (nearest) {
      const distance = Math.abs(nearest.step - info.cursorStep);
      const where = distance <= Math.max(0.5, (info.window.to - info.window.from) / 2) ? 'in this pixel' : `${formatCount(Math.round(distance))} steps away`;
      lines.push(`Nearest plotted observation: step ${formatCount(nearest.step)} (${where})`);
      lines.push(`${label}: ${valueText(nearest.value)}`);
    }
  }

  if (info.conflict) {
    const texts = info.conflict.records.map((r) => describeValue(r[model.metric]));
    // If rounding would make different values look identical, show them exactly.
    const shown = new Set(texts.map((t) => t.text)).size < texts.length ? texts.map((t) => t.exact) : texts.map((t) => t.text);
    lines.push(`⚠ Step logged ${info.conflict.records.length}× with different values (${shown.join(', ')}); the last recorded is plotted.`);
  }
  for (const run of info.invalid) {
    const kinds = (Object.keys(run.kinds) as (keyof typeof KIND_TEXT)[])
      .filter((k) => run.kinds[k] > 0)
      .map((k) => `${formatCount(run.kinds[k])} ${KIND_TEXT[k]}`)
      .join(', ');
    const range = run.startStep === run.endStep ? `Step ${formatCount(run.startStep)}` : `Steps ${formatCount(run.startStep)}–${formatCount(run.endStep)}`;
    lines.push(`⚠ ${range}: ${kinds}. Not plotted (no numeric value).`);
  }
  if (info.gap) {
    lines.push(
      `⚠ Missing steps ${formatCount(info.gap.firstMissingStep)}–${formatCount(info.gap.lastMissingStep)} (${formatCount(info.gap.missingCount)} not recorded). The line is broken here.`,
    );
  }
  if (model.result.reduced && nearest) {
    lines.push(
      `Downsampled: ${formatCount(model.result.outputCount)} of ${formatCount(model.result.inputCount)} observations plotted (extrema kept); zoom in to see every one.`,
    );
  }
  return lines;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Tooltip HTML. Every piece of text is escaped. */
export function hoverHtml(lines: readonly string[]): string {
  return lines
    .map((line, i) => {
      const text = escapeHtml(line);
      if (i === 0) return `<strong>${text}</strong>`;
      return line.startsWith('⚠') ? `<span style="color:#b91c1c">${text}</span>` : text;
    })
    .join('<br/>');
}
