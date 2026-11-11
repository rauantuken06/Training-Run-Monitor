/**
 * Core domain types for the Training Run Monitor.
 *
 * Design notes:
 * - Raw metric values are kept exactly as received. A JS `number` can hold
 *   `NaN`, `Infinity` and `-Infinity`; these are meaningful signals (e.g. a
 *   diverged run) and must never be silently coerced to `0`.
 * - `null` means "no value was recorded for this metric at this step", which
 *   is distinct from a recorded-but-invalid value such as `NaN`.
 * - Raw point arrays carry no ordering or uniqueness guarantee: steps may be
 *   unsorted, duplicated or have gaps. Detecting that is the job of the data
 *   integrity layer, which reports findings via `DataQualityDiagnostics`.
 */

/** The metrics recorded at each training step. */
export type MetricKey = 'loss' | 'lr' | 'grad_norm';

/**
 * A metric value as recorded.
 * - finite `number`: a normal reading
 * - `NaN` / `±Infinity`: recorded but invalid (preserved, never zeroed)
 * - `null`: not recorded at this step
 */
export type MetricValue = number | null;

/** One raw training-log record. */
export interface TrainingPoint {
  /** Optimizer step. Expected to be a non-negative integer, but not guaranteed in raw data. */
  step: number;
  loss: MetricValue;
  lr: MetricValue;
  grad_norm: MetricValue;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

/** A configuration value attached to a run (hyperparameters, tags, etc.). */
export type RunConfigValue = string | number | boolean;

/**
 * The behaviour a run was designed to exhibit. Describes intent (ground truth for
 * the synthetic dataset). It is not the output of any detection logic.
 */
export type RunScenario =
  | 'healthy'
  | 'noisy'
  | 'plateau'
  | 'diverging'
  | 'nan_loss'
  | 'infinite_loss'
  | 'duplicate_steps'
  | 'unsorted_steps'
  | 'missing_steps'
  | 'missing_values'
  | 'large_dataset'
  | 'loss_spike';

/** Everything about a run except its points. Cheap to list and never requires generating data. */
export interface TrainingRunMetadata {
  /** Stable, URL-safe identifier used in `/runs/:runId`. */
  id: string;
  name: string;
  description: string;
  status: RunStatus;
  /** ISO 8601 timestamp. */
  createdAt: string;
  config: Readonly<Record<string, RunConfigValue>>;
  scenarios: readonly RunScenario[];
  /** Exact number of raw points the run contains (including duplicates). */
  pointCount: number;
}

/** A training run together with its raw, unprocessed points. */
export interface TrainingRun extends TrainingRunMetadata {
  /** Points in the order they were received. May be unsorted / duplicated / gappy. */
  points: readonly TrainingPoint[];
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export type DataQualitySeverity = 'info' | 'warning' | 'error';

interface DataQualityIssueBase {
  severity: DataQualitySeverity;
}

/** A metric value that is `NaN`, `Infinity` or `-Infinity`. */
export interface NonFiniteValueIssue extends DataQualityIssueBase {
  kind: 'nan' | 'positive_infinity' | 'negative_infinity';
  metric: MetricKey;
  step: number;
  /** Index of the offending point in the raw `points` array. */
  index: number;
}

/** A metric with no recorded value (`null`) at a step. */
export interface MissingValueIssue extends DataQualityIssueBase {
  kind: 'missing_value';
  metric: MetricKey;
  step: number;
  index: number;
}

/** The same step appears more than once. */
export interface DuplicateStepIssue extends DataQualityIssueBase {
  kind: 'duplicate_step';
  step: number;
  /** Raw indices of every point sharing this step (length >= 2). */
  indices: readonly number[];
}

/** A point whose step is lower than the step of the point before it. */
export interface UnsortedStepIssue extends DataQualityIssueBase {
  kind: 'unsorted_step';
  index: number;
  step: number;
  previousStep: number;
}

/** A gap in the step sequence: no points strictly between `afterStep` and `beforeStep`. */
export interface MissingStepsIssue extends DataQualityIssueBase {
  kind: 'missing_steps';
  /** Last step present before the gap. */
  afterStep: number;
  /** First step present after the gap. */
  beforeStep: number;
  missingCount: number;
}

/** A step value that is not a finite, non-negative integer. */
export interface InvalidStepIssue extends DataQualityIssueBase {
  kind: 'invalid_step';
  index: number;
  rawStep: number;
}

export type DataQualityIssue =
  | NonFiniteValueIssue
  | MissingValueIssue
  | DuplicateStepIssue
  | UnsortedStepIssue
  | MissingStepsIssue
  | InvalidStepIssue;

export type DataQualityIssueKind = DataQualityIssue['kind'];

/** Per-metric tally of valid, invalid and missing values. */
export interface MetricValueCounts {
  finite: number;
  nan: number;
  positiveInfinity: number;
  negativeInfinity: number;
  missing: number;
}

/** Result of running integrity checks over one run's raw points. */
export interface DataQualityDiagnostics {
  runId: string;
  totalPoints: number;
  uniqueSteps: number;
  isSorted: boolean;
  hasDuplicateSteps: boolean;
  hasMissingSteps: boolean;
  metricCounts: Readonly<Record<MetricKey, MetricValueCounts>>;
  issueCounts: Readonly<Record<DataQualityIssueKind, number>>;
  issues: readonly DataQualityIssue[];
}

// ---------------------------------------------------------------------------
// Summaries (used by the runs list)
// ---------------------------------------------------------------------------

/**
 * Aggregates over a metric's *finite* values only.
 * `min`/`max` are `null` when the metric has no finite values at all.
 */
export interface MetricSummary {
  min: number | null;
  max: number | null;
  /** Value at the highest step, as recorded — may be `NaN`, `±Infinity` or `null`. */
  last: MetricValue;
}

export interface RunSummary {
  runId: string;
  name: string;
  status: RunStatus;
  createdAt: string;
  pointCount: number;
  firstStep: number | null;
  lastStep: number | null;
  metrics: Readonly<Record<MetricKey, MetricSummary>>;
  /** Total number of data quality issues detected. */
  issueCount: number;
  /** Highest severity among detected issues, or `null` if there are none. */
  worstSeverity: DataQualitySeverity | null;
}
