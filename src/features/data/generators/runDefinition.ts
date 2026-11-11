import type { MetricKey, MetricValue, TrainingRunMetadata } from '../../../types/training';
import type { CurveParams } from './curves';

/**
 * Declarative description of a synthetic run. Every anomaly is listed explicitly,
 * so a definition doubles as the ground truth for later integrity checks.
 *
 * All step values must lie on the run's base grid (`i * stepInterval`).
 * Anomaly ranges must not overlap each other. Generation throws on steps
 * that are not on the grid rather than silently ignoring them.
 */

/** Inclusive range of steps. */
export interface StepRange {
  fromStep: number;
  toStep: number;
}

/** Replace one metric at one step with an explicit value (`NaN`, `±Infinity`, `null`, or a number). */
export interface ValueOverride {
  step: number;
  metric: MetricKey;
  value: MetricValue;
}

/** Replace one metric at `fromStep` and every later base step. */
export interface ValueTail {
  fromStep: number;
  metric: MetricKey;
  value: MetricValue;
}

/**
 * Steps logged twice. Each copy directly follows its original point.
 * - `relogged`: logged independently (e.g. by two ranks), so the values conflict
 * - `identical`: an exact double-write of the same record
 */
export interface DuplicateRange extends StepRange {
  mode: 'relogged' | 'identical';
}

/** Points in `fromStep..toStep` that arrive late, moved to directly after the point at `afterStep`. */
export interface DelayedBlock extends StepRange {
  afterStep: number;
}

export interface RunAnomalies {
  valueOverrides?: readonly ValueOverride[];
  valueTails?: readonly ValueTail[];
  gaps?: readonly StepRange[];
  duplicates?: readonly DuplicateRange[];
  delayedBlocks?: readonly DelayedBlock[];
}

export interface RunDefinition {
  metadata: Omit<TrainingRunMetadata, 'pointCount'>;
  seed: number;
  /** Number of points on the base grid, before gaps or duplicates are applied. */
  length: number;
  stepInterval: number;
  curve: CurveParams;
  anomalies: RunAnomalies;
}

/** Number of base-grid steps that fall inside an inclusive range. */
export function gridStepsInRange(def: RunDefinition, range: StepRange): number {
  const first = Math.max(0, Math.ceil(range.fromStep / def.stepInterval));
  const last = Math.min(def.length - 1, Math.floor(range.toStep / def.stepInterval));
  return Math.max(0, last - first + 1);
}

/** Exact raw point count, computed from the definition without generating any points. */
export function countPoints(def: RunDefinition): number {
  const removed = (def.anomalies.gaps ?? []).reduce((n, r) => n + gridStepsInRange(def, r), 0);
  const added = (def.anomalies.duplicates ?? []).reduce((n, r) => n + gridStepsInRange(def, r), 0);
  return def.length - removed + added;
}
