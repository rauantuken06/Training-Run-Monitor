import type {
  DataQualityDiagnostics,
  DataQualityIssue,
  DataQualityIssueKind,
  MetricKey,
  MetricSummary,
  MetricValue,
  MissingValueIssue,
  NonFiniteTailIssue,
  NonFiniteValueIssue,
  StepSampling,
  TrainingPoint,
  TrainingRun,
} from '../../../types/training';
import { buildMetricView, type MetricView } from './metricView';
import { findMissingSteps, type StepGap } from './missingSteps';
import { buildStepOrder, type DisplayDuplicate } from './stepOrder';
import { summarizeMetric } from './summary';
import { classifyValue, METRIC_KEYS } from './values';

/**
 * Chart-ready view of a run. It is an index layer over the raw points, not a copy.
 *
 * - `displayIndex[p]` is the source index of the record shown at display
 *   position `p`. Positions are in strictly ascending step order.
 * - Read values through `stepAt` / `valueAt`, which return raw values unchanged.
 * - `metrics[m].segments` says where a line may be drawn. `nonFinite`,
 *   `gaps` and `duplicates` say where it must not be, or must be flagged.
 * - No smoothing, interpolation or downsampling happens here. Downsampling
 *   (a later task) can work per segment and keep every `nonFinite`,
 *   `gaps` and `duplicates` entry as an explicit marker.
 */
export interface ChartView {
  readonly runId: string;
  readonly sampling: StepSampling;
  /** The run's raw points, by reference. */
  readonly points: readonly TrainingPoint[];
  readonly displayIndex: Uint32Array;
  readonly gaps: readonly StepGap[];
  readonly duplicates: readonly DisplayDuplicate[];
  readonly metrics: Readonly<Record<MetricKey, MetricView>>;
}

export interface RunIntegrity {
  readonly diagnostics: DataQualityDiagnostics;
  readonly view: ChartView;
  readonly summaries: Readonly<Record<MetricKey, MetricSummary>>;
}

export type IntegrityInput = Pick<TrainingRun, 'id' | 'sampling' | 'points'>;

/** Fixed order in which issue kinds appear in `diagnostics.issues`. */
export const ISSUE_KIND_ORDER: readonly DataQualityIssueKind[] = [
  'invalid_step',
  'unsorted_step',
  'duplicate_step',
  'missing_steps',
  'off_grid_step',
  'nan',
  'positive_infinity',
  'negative_infinity',
  'missing_value',
  'non_finite_tail',
];

export function stepAt(view: ChartView, position: number): number {
  return pointAt(view, position).step;
}

export function valueAt(view: ChartView, metric: MetricKey, position: number): MetricValue {
  return pointAt(view, position)[metric];
}

function pointAt(view: ChartView, position: number): TrainingPoint {
  const sourceIndex = view.displayIndex[position];
  const point = sourceIndex === undefined ? undefined : view.points[sourceIndex];
  if (!point) throw new RangeError(`Display position ${position} is out of range`);
  return point;
}

/**
 * Run every integrity check over one run and build its chart view and summaries.
 * Pure: it never mutates the input, keeps no cache, and returns the same result
 * for the same input.
 */
export function analyzeRun(run: IntegrityInput): RunIntegrity {
  const { points } = run;
  const order = buildStepOrder(points);
  const { displayIndex } = order;
  const missing = findMissingSteps(points, displayIndex, run.sampling);
  const gapAfter = new Set(missing.gaps.map((g) => g.afterPosition));

  const metricViews = {} as Record<MetricKey, MetricView>;
  const summaries = {} as Record<MetricKey, MetricSummary>;
  for (const metric of METRIC_KEYS) {
    metricViews[metric] = buildMetricView(points, displayIndex, gapAfter, metric);
    summaries[metric] = summarizeMetric(points, displayIndex, metric);
  }

  const view: ChartView = {
    runId: run.id,
    sampling: run.sampling,
    points,
    displayIndex,
    gaps: missing.gaps,
    duplicates: order.duplicates,
    metrics: metricViews,
  };

  const issuesByKind = new Map<DataQualityIssueKind, DataQualityIssue[]>(
    ISSUE_KIND_ORDER.map((kind) => [kind, []]),
  );
  const add = (issue: DataQualityIssue) => issuesByKind.get(issue.kind)?.push(issue);

  order.invalidSteps.forEach(add);
  order.unsorted.forEach(add);
  order.duplicates.forEach((d) => add(d.issue));
  missing.gaps.forEach((g) => add(g.issue));
  missing.offGrid.forEach(add);
  valueIssues(points).forEach(add);
  for (const metric of METRIC_KEYS) {
    const tail = nonFiniteTail(view, metricViews[metric]);
    if (tail) add(tail);
  }

  const issues = ISSUE_KIND_ORDER.flatMap((kind) => issuesByKind.get(kind) ?? []);
  const issueCounts = Object.fromEntries(
    ISSUE_KIND_ORDER.map((kind) => [kind, issuesByKind.get(kind)?.length ?? 0]),
  ) as Record<DataQualityIssueKind, number>;

  const diagnostics: DataQualityDiagnostics = {
    runId: run.id,
    sampling: run.sampling,
    totalRecords: points.length,
    distinctSteps: displayIndex.length,
    isSorted: order.isSorted,
    duplicateStepCount: order.duplicates.length,
    conflictingDuplicateCount: order.duplicates.filter((d) => d.issue.conflictingMetrics.length > 0)
      .length,
    missingStepCount: missing.gaps.reduce((n, g) => n + g.issue.missingCount, 0),
    invalidStepCount: order.invalidSteps.length,
    metricCounts: {
      loss: summaries.loss.counts,
      lr: summaries.lr.counts,
      grad_norm: summaries.grad_norm.counts,
    },
    issueCounts,
    issues,
  };

  return { diagnostics, view, summaries };
}

/** One issue per non-finite or missing value, over every raw record, in source order. */
function valueIssues(points: readonly TrainingPoint[]): (NonFiniteValueIssue | MissingValueIssue)[] {
  const issues: (NonFiniteValueIssue | MissingValueIssue)[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as TrainingPoint;
    for (const metric of METRIC_KEYS) {
      const kind = classifyValue(point[metric]);
      if (kind === 'finite') continue;
      issues.push(
        kind === 'missing'
          ? { kind: 'missing_value', severity: 'warning', metric, step: point.step, sourceIndex: i }
          : { kind, severity: 'error', metric, step: point.step, sourceIndex: i },
      );
    }
  }
  return issues;
}

/** The stretch of non-finite displayed values that runs up to the last position, if any. */
function nonFiniteTail(view: ChartView, metricView: MetricView): NonFiniteTailIssue | null {
  const { nonFinite } = metricView;
  const last = nonFinite[nonFinite.length - 1];
  if (!last || last.position !== view.displayIndex.length - 1) return null;

  let first = nonFinite.length - 1;
  while (first > 0 && (nonFinite[first - 1]?.position ?? -1) === (nonFinite[first]?.position ?? 0) - 1) {
    first--;
  }
  const start = nonFinite[first] as (typeof nonFinite)[number];
  return {
    kind: 'non_finite_tail',
    severity: 'error',
    metric: metricView.metric,
    fromStep: stepAt(view, start.position),
    count: nonFinite.length - first,
    lastValueKind: last.kind,
  };
}
