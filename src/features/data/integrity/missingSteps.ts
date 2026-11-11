import type {
  MissingStepsIssue,
  OffGridStepIssue,
  StepSampling,
  TrainingPoint,
} from '../../../types/training';

/** A gap together with the display position it follows. */
export interface StepGap {
  /** The gap lies between display positions `afterPosition` and `afterPosition + 1`. */
  readonly afterPosition: number;
  readonly issue: MissingStepsIssue;
}

export interface MissingStepsResult {
  readonly gaps: readonly StepGap[];
  readonly offGrid: readonly OffGridStepIssue[];
}

/**
 * Detect missing steps between consecutive distinct steps of the display view.
 *
 * - `irregular` sampling: nothing is reported. Without an expected spacing, a
 *   large step difference cannot be told apart from intentional sparse logging.
 * - `fixed` sampling: the expected grid is `origin + k * interval`, anchored at
 *   the smallest valid step. Every grid step strictly between two present steps
 *   is missing. Valid steps that are not on the grid are reported as off-grid.
 *   They never create false gaps, because gaps count only grid steps.
 * - Nothing before the first or after the last present step is reported: the
 *   expected start and end of a run are not declared.
 */
export function findMissingSteps(
  points: readonly TrainingPoint[],
  displayIndex: Uint32Array,
  sampling: StepSampling,
): MissingStepsResult {
  if (sampling.kind === 'irregular' || displayIndex.length === 0) {
    return { gaps: [], offGrid: [] };
  }
  const { interval } = sampling;
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error(`Fixed sampling needs a positive integer interval, got ${interval}`);
  }

  const stepAt = (position: number) => (points[displayIndex[position] as number] as TrainingPoint).step;
  const origin = stepAt(0);
  const gaps: StepGap[] = [];
  const offGrid: OffGridStepIssue[] = [];

  for (let p = 0; p < displayIndex.length; p++) {
    const step = stepAt(p);
    if ((step - origin) % interval !== 0) {
      offGrid.push({
        kind: 'off_grid_step',
        severity: 'warning',
        sourceIndex: displayIndex[p] as number,
        step,
        interval,
        gridOrigin: origin,
      });
    }
    if (p === 0) continue;

    const previous = stepAt(p - 1);
    // Grid indices strictly between `previous` and `step`.
    const firstK = Math.floor((previous - origin) / interval) + 1;
    const lastK = Math.ceil((step - origin) / interval) - 1;
    if (lastK >= firstK) {
      gaps.push({
        afterPosition: p - 1,
        issue: {
          kind: 'missing_steps',
          severity: 'warning',
          afterStep: previous,
          beforeStep: step,
          firstMissingStep: origin + firstK * interval,
          lastMissingStep: origin + lastK * interval,
          missingCount: lastK - firstK + 1,
        },
      });
    }
  }
  return { gaps, offGrid };
}
