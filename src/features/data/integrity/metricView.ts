import type { MetricKey, TrainingPoint, ValueKind } from '../../../types/training';
import { classifyValue } from './values';

/** Inclusive range of display positions. */
export interface DisplayRange {
  readonly start: number;
  readonly end: number;
}

export interface NonFiniteSample {
  readonly position: number;
  readonly kind: Exclude<ValueKind, 'finite'>;
}

/**
 * Per-metric continuity information over the display view.
 *
 * A line may be drawn only within a segment. A segment is a maximal range of
 * display positions whose displayed values are all finite, with no missing
 * steps between consecutive positions. A non-finite or missing value, or a
 * gap, always ends the segment, so nothing is interpolated across them.
 */
export interface MetricView {
  readonly metric: MetricKey;
  readonly segments: readonly DisplayRange[];
  /** Every display position whose displayed value is not finite, ascending. */
  readonly nonFinite: readonly NonFiniteSample[];
}

export function buildMetricView(
  points: readonly TrainingPoint[],
  displayIndex: Uint32Array,
  gapAfterPositions: ReadonlySet<number>,
  metric: MetricKey,
): MetricView {
  const segments: DisplayRange[] = [];
  const nonFinite: NonFiniteSample[] = [];
  let segmentStart = -1;

  for (let p = 0; p < displayIndex.length; p++) {
    const kind = classifyValue((points[displayIndex[p] as number] as TrainingPoint)[metric]);
    if (kind === 'finite') {
      if (segmentStart === -1) {
        segmentStart = p;
      } else if (gapAfterPositions.has(p - 1)) {
        segments.push({ start: segmentStart, end: p - 1 });
        segmentStart = p;
      }
    } else {
      nonFinite.push({ position: p, kind });
      if (segmentStart !== -1) {
        segments.push({ start: segmentStart, end: p - 1 });
        segmentStart = -1;
      }
    }
  }
  if (segmentStart !== -1) segments.push({ start: segmentStart, end: displayIndex.length - 1 });

  return { metric, segments, nonFinite };
}
