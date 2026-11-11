import type {
  DuplicateStepIssue,
  MetricKey,
  MissingStepsIssue,
  TrainingPoint,
  ValueKind,
} from '../../../types/training';
import type { ChartView } from '../integrity/analyzeRun';
import type { DisplayRange } from '../integrity/metricView';

/**
 * Viewport-aware, extrema-preserving downsampling over a Task 03 `ChartView`.
 *
 * Algorithm: segment-aware M4. The viewport's step range is split into `B`
 * equal-width buckets (think: pixel columns). Each integrity segment is cut
 * into pieces at bucket boundaries, and each piece keeps its first, last,
 * minimum and maximum points (deduplicated, in step order). Pieces never cross
 * a segment boundary, so no line can bridge an invalid value or a gap.
 *
 * Every returned point is an existing displayed record, carrying its exact raw
 * step and value and its source index. Nothing is averaged, interpolated,
 * rounded or clamped.
 */

/** Inclusive step range to show. */
export interface Viewport {
  readonly minStep: number;
  readonly maxStep: number;
}

/** One plotted observation: an existing displayed record, values exactly as recorded. */
export interface PlotPoint {
  /** Display position in the Task 03 view. */
  readonly position: number;
  /** Index of the record in the run's raw points. */
  readonly sourceIndex: number;
  readonly step: number;
  /** Raw metric value (always finite, because only segment points are plotted). */
  readonly value: number;
}

/** A line may be drawn only between consecutive points of one segment. Inclusive indices into `points`. */
export interface PlotSegment {
  readonly start: number;
  readonly end: number;
}

type NonFiniteKind = Exclude<ValueKind, 'finite'>;

/** A maximal stretch of consecutive non-finite displayed values (never spanning a gap). */
export interface InvalidRun {
  readonly startPosition: number;
  readonly endPosition: number;
  readonly startStep: number;
  readonly endStep: number;
  readonly startSourceIndex: number;
  readonly endSourceIndex: number;
  readonly count: number;
  readonly kinds: Readonly<Record<NonFiniteKind, number>>;
}

export type DownsampleWarning =
  | {
      /** Even one point per visible segment, plus the extrema, does not fit the budget. */
      readonly kind: 'budget_exceeded';
      readonly budget: number;
      readonly required: number;
      readonly segmentCount: number;
    }
  | { readonly kind: 'invalid_values'; readonly count: number; readonly runCount: number }
  | { readonly kind: 'missing_steps'; readonly gapCount: number; readonly missingStepCount: number }
  | { readonly kind: 'conflicting_duplicates'; readonly count: number }
  | {
      /** A hidden duplicate copy has a value outside the plotted extrema (or nothing is plotted). */
      readonly kind: 'hidden_duplicate_outside_extrema';
      readonly step: number;
      readonly sourceIndex: number;
      readonly value: number;
      readonly issue: DuplicateStepIssue;
    };

export type DownsampleMethod = 'all' | 'm4' | 'endpoints_and_extrema';

export interface DownsampleResult {
  readonly metric: MetricKey;
  readonly viewport: Viewport;
  readonly budget: number;
  /** First and last displayed steps inside the viewport, or `null` if none. */
  readonly visibleStepRange: { readonly first: number; readonly last: number } | null;
  /** Display positions inside the viewport, including non-finite ones. */
  readonly visibleCount: number;
  /** Plottable (finite, in-segment) displayed points inside the viewport. */
  readonly inputCount: number;
  readonly outputCount: number;
  /** `outputCount < inputCount`. */
  readonly reduced: boolean;
  readonly method: DownsampleMethod;
  /** Number of step buckets used by `m4`; 0 otherwise. */
  readonly bucketCount: number;
  /** Ascending, strictly increasing steps. */
  readonly points: readonly PlotPoint[];
  /** One entry per visible integrity segment (clipped to the viewport), never merged. */
  readonly segments: readonly PlotSegment[];
  /** Exact min and max of the displayed finite values in the viewport. Both are in `points`. */
  readonly extrema: { readonly min: PlotPoint | null; readonly max: PlotPoint | null };
  readonly invalidRuns: readonly InvalidRun[];
  /** Missing-step ranges that overlap the viewport. */
  readonly gaps: readonly MissingStepsIssue[];
  /** Duplicates in the viewport whose records disagree on this metric. */
  readonly conflicts: readonly DuplicateStepIssue[];
  readonly warnings: readonly DownsampleWarning[];
}

export function downsampleMetric(
  view: ChartView,
  metric: MetricKey,
  viewport: Viewport,
  budget: number,
): DownsampleResult {
  validate(viewport, budget);
  const { minStep, maxStep } = viewport;
  const { displayIndex, points } = view;

  const recordAt = (position: number) => points[displayIndex[position] as number] as TrainingPoint;
  const stepAt = (position: number) => recordAt(position).step;
  const valueAt = (position: number) => recordAt(position)[metric] as number;
  const plotPoint = (position: number): PlotPoint => ({
    position,
    sourceIndex: displayIndex[position] as number,
    step: stepAt(position),
    value: valueAt(position),
  });

  // Visible display positions [pLo, pHi] (steps are strictly ascending).
  const pLo = lowerBound(displayIndex.length, (p) => stepAt(p) >= minStep);
  const pHi = lowerBound(displayIndex.length, (p) => stepAt(p) > maxStep) - 1;
  const visibleCount = Math.max(0, pHi - pLo + 1);

  const clipped = clipSegments(view.metrics[metric].segments, pLo, pHi);
  const inputCount = clipped.reduce((n, s) => n + s.end - s.start + 1, 0);
  const segmentCount = clipped.length;

  const out: PlotPoint[] = [];
  const outSegments: PlotSegment[] = [];
  let min: PlotPoint | null = null;
  let max: PlotPoint | null = null;
  const track = (point: PlotPoint) => {
    if (!min || point.value < min.value) min = point;
    if (!max || point.value > max.value) max = point;
  };

  let method: DownsampleMethod;
  let bucketCount = 0;
  let required = 0;

  if (inputCount <= budget) {
    method = 'all';
    for (const seg of clipped) {
      const start = out.length;
      for (let p = seg.start; p <= seg.end; p++) {
        const point = plotPoint(p);
        out.push(point);
        track(point);
      }
      outSegments.push({ start, end: out.length - 1 });
    }
  } else if (Math.floor(budget / 4) - segmentCount >= 1) {
    // Pieces <= buckets + segments, and each piece emits <= 4 points, so output <= budget.
    method = 'm4';
    bucketCount = Math.floor(budget / 4) - segmentCount;
    const span = maxStep - minStep;
    const bucketOf = (step: number) =>
      span === 0 ? 0 : Math.min(bucketCount - 1, Math.floor(((step - minStep) / span) * bucketCount));

    for (const seg of clipped) {
      const start = out.length;
      let p = seg.start;
      while (p <= seg.end) {
        const bucket = bucketOf(stepAt(p));
        const first = p;
        let minPos = p;
        let maxPos = p;
        let minVal = valueAt(p);
        let maxVal = minVal;
        p++;
        while (p <= seg.end && bucketOf(stepAt(p)) === bucket) {
          const v = valueAt(p);
          if (v < minVal) {
            minVal = v;
            minPos = p;
          }
          if (v > maxVal) {
            maxVal = v;
            maxPos = p;
          }
          p++;
        }
        for (const position of uniqueSorted([first, minPos, maxPos, p - 1])) {
          const point = plotPoint(position);
          out.push(point);
          track(point);
        }
      }
      outSegments.push({ start, end: out.length - 1 });
    }
  } else {
    // Budget too small for even one bucket per segment: keep every segment's
    // endpoints plus the viewport extrema. Segments are never merged.
    method = 'endpoints_and_extrema';
    let minPos = -1;
    let maxPos = -1;
    for (const seg of clipped) {
      for (let p = seg.start; p <= seg.end; p++) {
        const v = valueAt(p);
        if (minPos === -1 || v < valueAt(minPos)) minPos = p;
        if (maxPos === -1 || v > valueAt(maxPos)) maxPos = p;
      }
    }
    for (const seg of clipped) {
      const start = out.length;
      const keep = [seg.start, seg.end];
      if (minPos >= seg.start && minPos <= seg.end) keep.push(minPos);
      if (maxPos >= seg.start && maxPos <= seg.end) keep.push(maxPos);
      for (const position of uniqueSorted(keep)) {
        const point = plotPoint(position);
        out.push(point);
        track(point);
      }
      outSegments.push({ start, end: out.length - 1 });
    }
    required = out.length;
  }

  const gapAfter = new Set(view.gaps.map((g) => g.afterPosition));
  const invalidRuns = collectInvalidRuns(view, metric, pLo, pHi, gapAfter, stepAt);
  const gaps = view.gaps
    .map((g) => g.issue)
    .filter((issue) => issue.afterStep < maxStep && issue.beforeStep > minStep);
  const conflicts = view.duplicates
    .filter((d) => d.position >= pLo && d.position <= pHi)
    .map((d) => d.issue)
    .filter((issue) => issue.conflictingMetrics.includes(metric));

  const finalMin = min as PlotPoint | null;
  const finalMax = max as PlotPoint | null;
  const warnings: DownsampleWarning[] = [];
  if (method === 'endpoints_and_extrema' && required > budget) {
    warnings.push({ kind: 'budget_exceeded', budget, required, segmentCount });
  }
  if (invalidRuns.length > 0) {
    warnings.push({
      kind: 'invalid_values',
      count: invalidRuns.reduce((n, r) => n + r.count, 0),
      runCount: invalidRuns.length,
    });
  }
  if (gaps.length > 0) {
    warnings.push({
      kind: 'missing_steps',
      gapCount: gaps.length,
      missingStepCount: gaps.reduce((n, g) => n + g.missingCount, 0),
    });
  }
  if (conflicts.length > 0) warnings.push({ kind: 'conflicting_duplicates', count: conflicts.length });
  for (const issue of conflicts) {
    issue.records.forEach((record, k) => {
      const sourceIndex = issue.sourceIndices[k] as number;
      const value = record[metric];
      if (sourceIndex === issue.displayedSourceIndex || value === null || !Number.isFinite(value)) return;
      if (!finalMin || !finalMax || value < finalMin.value || value > finalMax.value) {
        warnings.push({ kind: 'hidden_duplicate_outside_extrema', step: issue.step, sourceIndex, value, issue });
      }
    });
  }

  return {
    metric,
    viewport: { minStep, maxStep },
    budget,
    visibleStepRange: visibleCount > 0 ? { first: stepAt(pLo), last: stepAt(pHi) } : null,
    visibleCount,
    inputCount,
    outputCount: out.length,
    reduced: out.length < inputCount,
    method,
    bucketCount,
    points: out,
    segments: outSegments,
    extrema: { min: finalMin, max: finalMax },
    invalidRuns,
    gaps,
    conflicts,
    warnings,
  };
}

function validate(viewport: Viewport, budget: number): void {
  const { minStep, maxStep } = viewport;
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep)) {
    throw new RangeError(`Viewport bounds must be finite numbers, got [${minStep}, ${maxStep}]`);
  }
  if (minStep > maxStep) {
    throw new RangeError(`Viewport minStep (${minStep}) must not exceed maxStep (${maxStep})`);
  }
  if (!Number.isInteger(budget) || budget < 1) {
    throw new RangeError(`Budget must be a positive integer, got ${budget}`);
  }
}

/** Smallest index in [0, n) for which `pred` is true (pred must be monotone false→true); `n` if none. */
function lowerBound(n: number, pred: (index: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Segments (sorted, disjoint) clipped to positions [pLo, pHi]. */
function clipSegments(segments: readonly DisplayRange[], pLo: number, pHi: number): DisplayRange[] {
  const clipped: DisplayRange[] = [];
  if (pHi < pLo) return clipped;
  const first = lowerBound(segments.length, (i) => (segments[i] as DisplayRange).end >= pLo);
  for (let i = first; i < segments.length; i++) {
    const seg = segments[i] as DisplayRange;
    if (seg.start > pHi) break;
    clipped.push({ start: Math.max(seg.start, pLo), end: Math.min(seg.end, pHi) });
  }
  return clipped;
}

function uniqueSorted(positions: number[]): number[] {
  positions.sort((a, b) => a - b);
  return positions.filter((p, i) => i === 0 || p !== positions[i - 1]);
}

function collectInvalidRuns(
  view: ChartView,
  metric: MetricKey,
  pLo: number,
  pHi: number,
  gapAfter: ReadonlySet<number>,
  stepAt: (position: number) => number,
): InvalidRun[] {
  const runs: InvalidRun[] = [];
  if (pHi < pLo) return runs;
  const { nonFinite } = view.metrics[metric];
  let i = lowerBound(nonFinite.length, (k) => (nonFinite[k]?.position ?? 0) >= pLo);

  while (i < nonFinite.length && (nonFinite[i]?.position ?? Infinity) <= pHi) {
    const kinds: Record<NonFiniteKind, number> = { nan: 0, positive_infinity: 0, negative_infinity: 0, missing: 0 };
    const startPosition = (nonFinite[i] as (typeof nonFinite)[number]).position;
    let endPosition = startPosition;
    while (i < nonFinite.length) {
      const sample = nonFinite[i] as (typeof nonFinite)[number];
      const continues = sample.position === startPosition || (sample.position === endPosition + 1 && !gapAfter.has(endPosition));
      if (sample.position > pHi || !continues) break;
      kinds[sample.kind]++;
      endPosition = sample.position;
      i++;
    }
    runs.push({
      startPosition,
      endPosition,
      startStep: stepAt(startPosition),
      endStep: stepAt(endPosition),
      startSourceIndex: view.displayIndex[startPosition] as number,
      endSourceIndex: view.displayIndex[endPosition] as number,
      count: endPosition - startPosition + 1,
      kinds,
    });
  }
  return runs;
}
