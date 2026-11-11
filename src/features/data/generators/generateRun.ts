import type { TrainingPoint } from '../../../types/training';
import { samplePoint } from './curves';
import { createGaussian, deriveSeed, mulberry32 } from './random';
import type { RunDefinition, StepRange } from './runDefinition';

/**
 * Generate a run's raw points from its definition.
 *
 * Pipeline (each stage only runs when the definition asks for it):
 *  1. sample clean points on the base grid `0, stepInterval, 2*stepInterval, ...`
 *  2. apply value overrides and tails (NaN / ±Infinity / null are written as-is)
 *  3. remove gap ranges
 *  4. duplicate the points in duplicate ranges (each copy follows its original)
 *  5. move delayed blocks out of order
 *
 * Deterministic: the same definition and seed always produce identical output.
 * Value noise and anomaly noise use separate PRNG streams, so adding an anomaly
 * never shifts the clean values of other points.
 *
 * The definition is never mutated. The returned array is a fresh copy, owned by the caller.
 */
export function generateRun(def: RunDefinition, seed: number = def.seed): TrainingPoint[] {
  const { curve, length, stepInterval, anomalies } = def;
  const totalSteps = (length - 1) * stepInterval;
  const valueNoise = createGaussian(mulberry32(seed));
  const anomalyNoise = createGaussian(mulberry32(deriveSeed(seed, 'anomalies')));

  let points: TrainingPoint[] = [];
  for (let i = 0; i < length; i++) {
    points.push(samplePoint(curve, i * stepInterval, totalSteps, valueNoise));
  }

  const gridIndex = (step: number): number => {
    const index = step / stepInterval;
    if (!Number.isInteger(index) || index < 0 || index >= length) {
      throw new Error(`Run ${def.metadata.id}: step ${step} is not on the base grid`);
    }
    return index;
  };
  const pointAtGrid = (step: number): TrainingPoint => {
    const point = points[gridIndex(step)];
    if (!point) throw new Error(`Run ${def.metadata.id}: no point at step ${step}`);
    return point;
  };

  // 2. Value anomalies. Points are still exactly the base grid here, so index = step / interval.
  for (const { step, metric, value } of anomalies.valueOverrides ?? []) {
    pointAtGrid(step)[metric] = value;
  }
  for (const { fromStep, metric, value } of anomalies.valueTails ?? []) {
    for (let i = gridIndex(fromStep); i < length; i++) {
      const point = points[i];
      if (point) point[metric] = value;
    }
  }

  // 3. Gaps.
  const gaps = anomalies.gaps ?? [];
  if (gaps.length > 0) {
    points = points.filter((p) => !gaps.some((g) => inRange(p.step, g)));
  }

  // 4. Duplicates: each copy directly follows its original, so step order never decreases.
  //    That keeps duplicate steps identifiable independently of unsorted steps.
  const duplicates = anomalies.duplicates ?? [];
  if (duplicates.length > 0) {
    const withCopies: TrainingPoint[] = [];
    for (const p of points) {
      withCopies.push(p);
      const range = duplicates.find((r) => inRange(p.step, r));
      if (range) {
        withCopies.push(
          range.mode === 'identical' ? { ...p } : samplePoint(curve, p.step, totalSteps, anomalyNoise),
        );
      }
    }
    points = withCopies;
  }

  // 5. Delayed blocks: remove a contiguous block and re-insert it after `afterStep`.
  for (const block of anomalies.delayedBlocks ?? []) {
    const start = points.findIndex((p) => inRange(p.step, block));
    if (start === -1) throw new Error(`Run ${def.metadata.id}: delayed block not found`);
    let end = start;
    while (end < points.length && inRange(points[end]?.step ?? Number.NaN, block)) end++;
    const moved = points.splice(start, end - start);
    const insertAt = lastIndexOfStep(points, block.afterStep, def) + 1;
    points.splice(insertAt, 0, ...moved);
  }

  return points;
}

function inRange(step: number, range: StepRange): boolean {
  return step >= range.fromStep && step <= range.toStep;
}

function lastIndexOfStep(points: readonly TrainingPoint[], step: number, def: RunDefinition) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]?.step === step) return i;
  }
  throw new Error(`Run ${def.metadata.id}: step ${step} not present`);
}
