import { RUN_DEFINITIONS } from '../features/data/catalog/runCatalog';
import type { RunDefinition } from '../features/data/generators/runDefinition';
import type { MetricKey, RunScenario, TrainingPoint } from '../types/training';

export const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];

export function getDefinition(id: string): RunDefinition {
  const def = RUN_DEFINITIONS.find((d) => d.metadata.id === id);
  if (!def) throw new Error(`No run definition with id ${id}`);
  return def;
}

/** Field-by-field identity using Object.is (NaN equals NaN; NaN never equals 0 or null). */
export function samePoints(a: readonly TrainingPoint[], b: readonly TrainingPoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (!Object.is(p.step, q.step)) return false;
    for (const m of METRICS) if (!Object.is(p[m], q[m])) return false;
  }
  return true;
}

export function stepsWhere(
  points: readonly TrainingPoint[],
  predicate: (p: TrainingPoint) => boolean,
): number[] {
  return points.filter(predicate).map((p) => p.step);
}

/** Inclusive grid steps `from, from + interval, ..., to`. */
export function gridSteps(from: number, to: number, interval: number): number[] {
  const steps: number[] = [];
  for (let s = from; s <= to; s += interval) steps.push(s);
  return steps;
}

/**
 * Test-only anomaly detection, written independently of the generator, so tests can
 * prove each run contains its intended anomaly types and nothing else.
 */
export function detectScenarioFeatures(
  points: readonly TrainingPoint[],
  stepInterval: number,
): Set<RunScenario> {
  const found = new Set<RunScenario>();
  const seen = new Set<number>();
  let previous: number | null = null;

  for (const p of points) {
    if (Number.isNaN(p.loss)) found.add('nan_loss');
    if (p.loss === Number.POSITIVE_INFINITY || p.loss === Number.NEGATIVE_INFINITY) {
      found.add('infinite_loss');
    }
    if (METRICS.some((m) => p[m] === null)) found.add('missing_values');
    if (seen.has(p.step)) found.add('duplicate_steps');
    seen.add(p.step);
    if (previous !== null && p.step < previous) found.add('unsorted_steps');
    previous = p.step;
  }

  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0);
    if (gap > stepInterval) found.add('missing_steps');
  }
  return found;
}

/** Anomaly scenarios: the subset of scenario tags that `detectScenarioFeatures` can observe. */
export const DETECTABLE_SCENARIOS: readonly RunScenario[] = [
  'nan_loss',
  'infinite_loss',
  'missing_values',
  'duplicate_steps',
  'unsorted_steps',
  'missing_steps',
];
