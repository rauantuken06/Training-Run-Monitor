import type {
  DuplicateStepIssue,
  InvalidStepIssue,
  MetricKey,
  TrainingPoint,
  UnsortedStepIssue,
} from '../../../types/training';
import { isValidStep, METRIC_KEYS } from './values';

/** A duplicate step together with its position in the display view. */
export interface DisplayDuplicate {
  readonly position: number;
  readonly issue: DuplicateStepIssue;
}

export interface StepOrder {
  /**
   * Display position → source index of the record shown at that position.
   * Ascending step, one entry per distinct valid step. Indexes into the raw
   * points; no point is copied.
   */
  readonly displayIndex: Uint32Array;
  /** True when valid steps never decrease in source order. */
  readonly isSorted: boolean;
  readonly unsorted: readonly UnsortedStepIssue[];
  readonly invalidSteps: readonly InvalidStepIssue[];
  readonly duplicates: readonly DisplayDuplicate[];
}

/**
 * Build the ascending-step display order for a run's raw points.
 *
 * - Records with an invalid step (not a finite, non-negative integer) cannot be
 *   placed on the axis. They are excluded from the order and reported.
 * - Out-of-order records are reported where they occur: each record whose step
 *   is lower than the previous valid-step record's.
 * - Sorting is numeric on `step`, with ties broken by source index, so the
 *   result is deterministic and independent of sort stability. Input that is
 *   already sorted skips the sort.
 * - Duplicate policy: when several records share a step, the **last recorded**
 *   (highest source index) is displayed. All records stay available in the
 *   `DuplicateStepIssue`, and values are never averaged or merged.
 *
 * The input is never mutated.
 */
export function buildStepOrder(points: readonly TrainingPoint[]): StepOrder {
  const unsorted: UnsortedStepIssue[] = [];
  const invalidSteps: InvalidStepIssue[] = [];
  const duplicates: DisplayDuplicate[] = [];

  const stepOf = (sourceIndex: number) => (points[sourceIndex] as TrainingPoint).step;

  // 1. Valid-step source indices in source order; detect invalid and descending steps.
  const order = new Uint32Array(points.length);
  let validCount = 0;
  let isSorted = true;
  let previousStep: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const step = stepOf(i);
    if (!isValidStep(step)) {
      invalidSteps.push({ kind: 'invalid_step', severity: 'error', sourceIndex: i, rawStep: step });
      continue;
    }
    if (previousStep !== null && step < previousStep) {
      isSorted = false;
      unsorted.push({ kind: 'unsorted_step', severity: 'warning', sourceIndex: i, step, previousStep });
    }
    previousStep = step;
    order[validCount++] = i;
  }

  // 2. Numeric sort by (step, sourceIndex) only when needed.
  const valid = order.subarray(0, validCount);
  if (!isSorted) valid.sort((a, b) => stepOf(a) - stepOf(b) || a - b);

  // 3. Collapse equal steps, in place: write position `d` only after reading group [i, j).
  //    `d <= i` always holds, so no unread entry is overwritten.
  let d = 0;
  for (let i = 0; i < validCount; ) {
    const step = stepOf(valid[i] as number);
    let j = i + 1;
    while (j < validCount && stepOf(valid[j] as number) === step) j++;

    const displayed = valid[j - 1] as number;
    if (j - i > 1) {
      const sourceIndices = Array.from(valid.subarray(i, j));
      const records = sourceIndices.map((k) => points[k] as TrainingPoint);
      const conflictingMetrics = conflictingMetricsOf(records);
      duplicates.push({
        position: d,
        issue: {
          kind: 'duplicate_step',
          severity: conflictingMetrics.length > 0 ? 'warning' : 'info',
          step,
          records,
          sourceIndices,
          displayedSourceIndex: displayed,
          conflictingMetrics,
        },
      });
    }
    valid[d++] = displayed;
    i = j;
  }

  const displayIndex = d === points.length ? order : order.slice(0, d);
  return { displayIndex, isSorted, unsorted, invalidSteps, duplicates };
}

function conflictingMetricsOf(records: readonly TrainingPoint[]): MetricKey[] {
  const first = records[0];
  if (!first) return [];
  return METRIC_KEYS.filter((m) => records.some((r) => !Object.is(r[m], first[m])));
}
