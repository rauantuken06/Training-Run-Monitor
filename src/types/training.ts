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

/** Classification of one recorded metric value. */
export type ValueKind = 'finite' | 'nan' | 'positive_infinity' | 'negative_infinity' | 'missing';

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

/**
 * How a run's steps are expected to be spaced. This is declared, not inferred.
 * - `fixed`: one record every `interval` steps, so absent grid steps are missing data
 * - `irregular`: no expected spacing, so the integrity layer never reports missing steps
 */
export type StepSampling =
  | { readonly kind: 'fixed'; readonly interval: number }
  | { readonly kind: 'irregular' };

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
  sampling: StepSampling;
}

/** A training run together with its raw, unprocessed points. */
export interface TrainingRun extends TrainingRunMetadata {
  /** Points in the order they were received. May be unsorted / duplicated / gappy. */
  points: readonly TrainingPoint[];
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------
// Every issue that concerns a specific record carries `sourceIndex`: the index
// of that record in the run's raw `points` array.

export type DataQualitySeverity = 'info' | 'warning' | 'error';

interface DataQualityIssueBase {
  readonly severity: DataQualitySeverity;
}

/** A metric value that is `NaN`, `Infinity` or `-Infinity`. */
export interface NonFiniteValueIssue extends DataQualityIssueBase {
  readonly kind: 'nan' | 'positive_infinity' | 'negative_infinity';
  readonly metric: MetricKey;
  /** Raw step of the record (may itself be invalid, see `InvalidStepIssue`). */
  readonly step: number;
  readonly sourceIndex: number;
}

/** A metric with no recorded value (`null`). */
export interface MissingValueIssue extends DataQualityIssueBase {
  readonly kind: 'missing_value';
  readonly metric: MetricKey;
  readonly step: number;
  readonly sourceIndex: number;
}

/** The same step appears in more than one record. */
export interface DuplicateStepIssue extends DataQualityIssueBase {
  readonly kind: 'duplicate_step';
  readonly step: number;
  /** Every record with this step, in source order (length >= 2). Original objects, not copies. */
  readonly records: readonly TrainingPoint[];
  /** Source indices of `records`, ascending. */
  readonly sourceIndices: readonly number[];
  /** The record shown in the display view (the last one recorded; see the duplicate policy). */
  readonly displayedSourceIndex: number;
  /** Metrics whose values differ between the records (`Object.is` comparison). Empty when identical. */
  readonly conflictingMetrics: readonly MetricKey[];
}

/** A record whose step is lower than the step of the previous valid-step record. */
export interface UnsortedStepIssue extends DataQualityIssueBase {
  readonly kind: 'unsorted_step';
  readonly sourceIndex: number;
  readonly step: number;
  readonly previousStep: number;
}

/** Grid steps that are expected under fixed sampling but have no record. */
export interface MissingStepsIssue extends DataQualityIssueBase {
  readonly kind: 'missing_steps';
  /** Last present step before the gap. */
  readonly afterStep: number;
  /** First present step after the gap. */
  readonly beforeStep: number;
  readonly firstMissingStep: number;
  readonly lastMissingStep: number;
  readonly missingCount: number;
}

/** A step value that is not a finite, non-negative integer. Such records cannot be placed on the axis. */
export interface InvalidStepIssue extends DataQualityIssueBase {
  readonly kind: 'invalid_step';
  readonly sourceIndex: number;
  readonly rawStep: number;
}

/** Under fixed sampling, a valid step that does not lie on the expected grid. */
export interface OffGridStepIssue extends DataQualityIssueBase {
  readonly kind: 'off_grid_step';
  readonly sourceIndex: number;
  readonly step: number;
  readonly interval: number;
  /** The grid is `gridOrigin + k * interval`, anchored at the smallest valid step. */
  readonly gridOrigin: number;
}

/** A metric whose displayed values are non-finite all the way to the run's last step. */
export interface NonFiniteTailIssue extends DataQualityIssueBase {
  readonly kind: 'non_finite_tail';
  readonly metric: MetricKey;
  /** Step of the first value in the trailing non-finite stretch. */
  readonly fromStep: number;
  /** Number of displayed steps in the stretch. */
  readonly count: number;
  /** Kind of the very last displayed value. */
  readonly lastValueKind: Exclude<ValueKind, 'finite'>;
}

export type DataQualityIssue =
  | NonFiniteValueIssue
  | MissingValueIssue
  | DuplicateStepIssue
  | UnsortedStepIssue
  | MissingStepsIssue
  | InvalidStepIssue
  | OffGridStepIssue
  | NonFiniteTailIssue;

export type DataQualityIssueKind = DataQualityIssue['kind'];

/** Per-metric tally over every raw record. The five fields always sum to the record count. */
export interface MetricValueCounts {
  readonly finite: number;
  readonly nan: number;
  readonly positiveInfinity: number;
  readonly negativeInfinity: number;
  readonly missing: number;
}

/** Result of running integrity checks over one run's raw points. */
export interface DataQualityDiagnostics {
  readonly runId: string;
  readonly sampling: StepSampling;
  /** Raw records received, including duplicates and invalid steps. */
  readonly totalRecords: number;
  /** Distinct valid steps, i.e. the length of the display view. */
  readonly distinctSteps: number;
  /** True when valid steps never decrease in source order. */
  readonly isSorted: boolean;
  readonly duplicateStepCount: number;
  readonly conflictingDuplicateCount: number;
  /** Total missing grid steps under fixed sampling; always 0 for irregular sampling. */
  readonly missingStepCount: number;
  readonly invalidStepCount: number;
  readonly metricCounts: Readonly<Record<MetricKey, MetricValueCounts>>;
  readonly issueCounts: Readonly<Record<DataQualityIssueKind, number>>;
  /** All issues, grouped by kind in a fixed order, then by step or source index. */
  readonly issues: readonly DataQualityIssue[];
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** A finite observation together with where it came from. */
export interface ObservedValue {
  readonly value: number;
  readonly step: number;
  readonly sourceIndex: number;
}

/**
 * Safe per-metric summary. Two scopes, deliberately:
 * - `counts`, `min`, `max`: every raw record with a valid step, including
 *   duplicate copies hidden from the display view, so no extreme is concealed
 *   (`counts` also includes invalid-step records)
 * - `firstFinite`, `lastFinite`, `last`: the display view (ascending step,
 *   duplicate policy applied), which is what a chart shows
 */
export interface MetricSummary {
  readonly metric: MetricKey;
  readonly counts: MetricValueCounts;
  /** `nan + positiveInfinity + negativeInfinity`. */
  readonly invalidCount: number;
  readonly min: ObservedValue | null;
  readonly max: ObservedValue | null;
  readonly firstFinite: ObservedValue | null;
  readonly lastFinite: ObservedValue | null;
  /** The value at the highest step, as recorded: may be `NaN`, `±Infinity` or `null`. */
  readonly last: {
    readonly value: MetricValue;
    readonly kind: ValueKind;
    readonly step: number;
    readonly sourceIndex: number;
  } | null;
  /** True when `last` exists and is not finite, so the run visibly ends invalid. */
  readonly endsNonFinite: boolean;
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
