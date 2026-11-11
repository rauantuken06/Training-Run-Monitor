import { generateRun } from '../features/data/generators/generateRun';
import { runMetadata } from '../features/data/generators/runDefinition';
import type { StepSampling, TrainingPoint, TrainingRun } from '../types/training';
import { getDefinition } from './dataTestUtils';

/**
 * Freeze the points array and every point. Modules are strict mode, so any
 * attempted write by code under test throws a TypeError instead of passing silently.
 */
export function freezePoints(points: TrainingPoint[]): readonly TrainingPoint[] {
  for (const p of points) Object.freeze(p);
  return Object.freeze(points);
}

/** A real catalog run (Task 02 data) with deeply frozen points. */
export function loadFrozenRun(id: string): TrainingRun {
  const def = getDefinition(id);
  return { ...runMetadata(def), points: freezePoints(generateRun(def)) };
}

/** A hand-made run for edge cases. */
export function fixtureRun(
  points: TrainingPoint[],
  sampling: StepSampling = { kind: 'fixed', interval: 10 },
): { id: string; sampling: StepSampling; points: readonly TrainingPoint[] } {
  return { id: 'fixture', sampling, points: freezePoints(points) };
}

/** Shorthand point builder: `pt(step, loss, lr?, grad_norm?)`. */
export function pt(
  step: number,
  loss: number | null,
  lr: number | null = 1e-4,
  grad_norm: number | null = 1,
): TrainingPoint {
  return { step, loss, lr, grad_norm };
}
