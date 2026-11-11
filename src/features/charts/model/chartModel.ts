import type { MetricKey } from '../../../types/training';
import { downsampleMetric, type DownsampleResult, type PlotPoint, type Viewport } from '../../data/downsampling/downsample';
import type { ChartView } from '../../data/integrity/analyzeRun';

/** Plot-area margins in CSS px. Fixed so pixel ↔ step mapping (drag zoom, tests) is exact. */
export const GRID = { left: 76, right: 36, top: 28, bottom: 36 } as const;

export const MIN_BUDGET = 16;
export const MAX_BUDGET = 20_000;

/**
 * Point budget for a chart of `width` CSS px: 4 points (M4: first/last/min/max)
 * per pixel column of the plot area, clamped to [MIN_BUDGET, MAX_BUDGET].
 */
export function budgetForWidth(width: number): number {
  const plotWidth = Math.max(1, Math.floor(width - GRID.left - GRID.right));
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, 4 * plotWidth));
}

export interface YBounds {
  readonly min: number;
  readonly max: number;
}

export interface ChartModel {
  readonly metric: MetricKey;
  readonly viewport: Viewport;
  readonly budget: number;
  readonly result: DownsampleResult;
  /** One `[step, value]` list per plotted segment: lines are drawn only within a list. */
  readonly seriesData: readonly (readonly (readonly [number, number])[])[];
  /** Y-axis range: the exact viewport extrema plus 5% padding; `null` with no finite values. */
  readonly yBounds: YBounds | null;
}

/**
 * Y range that contains the exact min and max (so nothing is clipped), padded
 * for readability. Each side is padded independently: a side whose padding
 * would overflow to ±Infinity (values near ±Number.MAX_VALUE) stays unpadded,
 * so the range never collapses to zero height.
 */
export function yBoundsFor(min: number, max: number): YBounds {
  const span = max - min;
  let pad = span > 0 ? span * 0.05 : Math.abs(max) * 0.05 || 1;
  if (!Number.isFinite(pad)) pad = Number.MAX_VALUE * 0.05;
  const low = Number.isFinite(min - pad) ? min - pad : min;
  const high = Number.isFinite(max + pad) ? max + pad : max;
  // Floating-point safety: the bounds must never cut off an extremum.
  return { min: Math.min(low, min), max: Math.max(high, max) };
}

/**
 * Everything a metric chart draws, derived only from Task 04's
 * `downsampleMetric`. No values are computed here, only arranged.
 */
export function buildChartModel(view: ChartView, metric: MetricKey, viewport: Viewport, budget: number): ChartModel {
  const result = downsampleMetric(view, metric, viewport, budget);
  const seriesData = result.segments.map((seg) =>
    result.points.slice(seg.start, seg.end + 1).map((p: PlotPoint) => [p.step, p.value] as const),
  );
  const { min, max } = result.extrema;
  return {
    metric,
    viewport,
    budget,
    result,
    seriesData,
    yBounds: min && max ? yBoundsFor(min.value, max.value) : null,
  };
}
