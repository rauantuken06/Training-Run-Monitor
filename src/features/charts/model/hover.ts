import type { DuplicateStepIssue, MissingStepsIssue } from '../../../types/training';
import type { InvalidRun, PlotPoint } from '../../data/downsampling/downsample';
import { describeValue, formatCount } from '../../runs/format';
import { METRIC_LABEL } from '../../runs/labels';
import type { ChartModel } from './chartModel';

export interface HoverInfo {
  /** The plotted observation nearest to the cursor's step (an existing record), if any. */
  readonly nearest: PlotPoint | null;
  /** Set when the nearest point's step was logged several times with differing values. */
  readonly conflict: DuplicateStepIssue | null;
  /** Invalid stretches (NaN / ±Infinity / null) within `tolerance` steps of the cursor. */
  readonly invalid: readonly InvalidRun[];
  /** A missing-step range containing the cursor. */
  readonly gap: MissingStepsIssue | null;
}

/**
 * What lies under the cursor at (fractional) `step`. Uses only the model: no
 * re-analysis, no interpolation. `tolerance` (in steps) is typically a few
 * pixels' worth, so single-step invalid values can be hovered.
 */
export function describeHover(model: ChartModel, step: number, tolerance: number): HoverInfo {
  const { points, invalidRuns, gaps, conflicts } = model.result;
  let nearest: PlotPoint | null = null;
  if (points.length > 0) {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((points[mid] as PlotPoint).step < step) lo = mid + 1;
      else hi = mid;
    }
    const after = points[lo] as PlotPoint;
    const before = points[lo - 1];
    nearest = before && Math.abs(before.step - step) <= Math.abs(after.step - step) ? before : after;
  }
  return {
    nearest,
    conflict: nearest ? (conflicts.find((c) => c.step === nearest.step) ?? null) : null,
    invalid: invalidRuns.filter((r) => r.endStep >= step - tolerance && r.startStep <= step + tolerance),
    gap: gaps.find((g) => g.afterStep < step && g.beforeStep > step) ?? null,
  };
}

const KIND_TEXT = { nan: 'NaN', positive_infinity: '+Infinity', negative_infinity: '-Infinity', missing: 'not recorded (null)' } as const;

/** Plain-text lines for a hover (used for the tooltip and tests). */
export function hoverLines(model: ChartModel, info: HoverInfo): string[] {
  const lines: string[] = [];
  const label = METRIC_LABEL[model.metric];
  if (info.nearest) {
    const d = describeValue(info.nearest.value);
    lines.push(`Step ${formatCount(info.nearest.step)}`);
    lines.push(`${label}: ${d.text}${d.text === d.exact ? '' : ` (exact ${d.exact})`}`);
  }
  if (info.conflict) {
    const values = info.conflict.records.map((r) => describeValue(r[model.metric]).text).join(', ');
    lines.push(`⚠ Step logged ${info.conflict.records.length}× with different values (${values}); the last recorded is plotted.`);
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
  if (model.result.reduced && info.nearest) {
    lines.push(
      `Nearest plotted observation. ${formatCount(model.result.outputCount)} of ${formatCount(model.result.inputCount)} observations are plotted (extrema kept); zoom in to see every one.`,
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
