import type {
  MetricKey,
  MetricSummary,
  MetricValueCounts,
  ObservedValue,
  TrainingPoint,
} from '../../../types/training';
import { classifyValue, isValidStep } from './values';

/**
 * Safe summary of one metric. Scopes (see `MetricSummary`):
 * - `counts`: every raw record
 * - `min` / `max`: every finite value on a record with a valid step, including
 *   duplicate copies the display view hides. Ties keep the first record in source order.
 * - `firstFinite` / `lastFinite` / `last`: the display view
 *
 * Non-finite values never take part in `min`/`max`, and never turn into 0.
 */
export function summarizeMetric(
  points: readonly TrainingPoint[],
  displayIndex: Uint32Array,
  metric: MetricKey,
): MetricSummary {
  let finite = 0;
  let nan = 0;
  let positiveInfinity = 0;
  let negativeInfinity = 0;
  let missing = 0;
  let min: ObservedValue | null = null;
  let max: ObservedValue | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as TrainingPoint;
    const value = point[metric];
    switch (classifyValue(value)) {
      case 'finite': {
        finite++;
        if (value === null || !isValidStep(point.step)) break;
        if (!min || value < min.value) min = { value, step: point.step, sourceIndex: i };
        if (!max || value > max.value) max = { value, step: point.step, sourceIndex: i };
        break;
      }
      case 'nan':
        nan++;
        break;
      case 'positive_infinity':
        positiveInfinity++;
        break;
      case 'negative_infinity':
        negativeInfinity++;
        break;
      case 'missing':
        missing++;
        break;
    }
  }
  const counts: MetricValueCounts = { finite, nan, positiveInfinity, negativeInfinity, missing };

  const observedAt = (position: number): ObservedValue | null => {
    const sourceIndex = displayIndex[position] as number;
    const point = points[sourceIndex] as TrainingPoint;
    const value = point[metric];
    return value !== null && classifyValue(value) === 'finite'
      ? { value, step: point.step, sourceIndex }
      : null;
  };

  let firstFinite: ObservedValue | null = null;
  for (let p = 0; p < displayIndex.length && !firstFinite; p++) firstFinite = observedAt(p);
  let lastFinite: ObservedValue | null = null;
  for (let p = displayIndex.length - 1; p >= 0 && !lastFinite; p--) lastFinite = observedAt(p);

  let last: MetricSummary['last'] = null;
  if (displayIndex.length > 0) {
    const sourceIndex = displayIndex[displayIndex.length - 1] as number;
    const point = points[sourceIndex] as TrainingPoint;
    last = { value: point[metric], kind: classifyValue(point[metric]), step: point.step, sourceIndex };
  }

  return {
    metric,
    counts,
    invalidCount: nan + positiveInfinity + negativeInfinity,
    min,
    max,
    firstFinite,
    lastFinite,
    last,
    endsNonFinite: last !== null && last.kind !== 'finite',
  };
}
