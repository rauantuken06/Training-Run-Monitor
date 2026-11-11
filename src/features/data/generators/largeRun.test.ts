import { beforeAll, describe, expect, it } from 'vitest';
import { getDefinition, METRICS, samePoints } from '../../../test/dataTestUtils';
import type { TrainingPoint } from '../../../types/training';
import { LARGE_RUN_ID, LARGE_RUN_SPIKE } from '../catalog/runCatalog';
import { baselineGradNormAt, baselineLossAt } from './curves';
import { generateRun } from './generateRun';
import { GAUSSIAN_CLIP } from './random';
import { countPoints } from './runDefinition';

const def = getDefinition(LARGE_RUN_ID);
let points: TrainingPoint[] = [];

beforeAll(() => {
  points = generateRun(def);
});

const lossAt = (i: number) => {
  const loss = points[i]?.loss;
  if (typeof loss !== 'number') throw new Error(`missing loss at index ${i}`);
  return loss;
};

describe(`million-point run (${LARGE_RUN_ID})`, () => {
  it('contains exactly 1,000,000 points, matching its metadata', () => {
    expect(points).toHaveLength(1_000_000);
    expect(countPoints(def)).toBe(1_000_000);
  });

  it('has sequential steps 0..999,999', () => {
    for (let i = 0; i < points.length; i++) {
      if (points[i]?.step !== i) throw new Error(`step mismatch at index ${i}: ${String(points[i]?.step)}`);
    }
  });

  it('contains only finite values (no NaN, Infinity or null)', () => {
    for (const p of points) {
      for (const m of METRICS) {
        if (!Number.isFinite(p[m])) throw new Error(`${m} at step ${p.step} is ${String(p[m])}`);
      }
    }
  });

  it(`has the spike at step ${LARGE_RUN_SPIKE.step} with loss exactly ${LARGE_RUN_SPIKE.value}`, () => {
    expect(points[LARGE_RUN_SPIKE.step]?.step).toBe(LARGE_RUN_SPIKE.step);
    expect(points[LARGE_RUN_SPIKE.step]?.loss).toBe(LARGE_RUN_SPIKE.value);
  });

  it('the spike is the unique maximum loss', () => {
    let maxIndex = -1;
    let max = Number.NEGATIVE_INFINITY;
    let countAtMax = 0;
    for (let i = 0; i < points.length; i++) {
      const loss = lossAt(i);
      if (loss > max) {
        max = loss;
        maxIndex = i;
        countAtMax = 1;
      } else if (loss === max) {
        countAtMax++;
      }
    }
    expect(maxIndex).toBe(LARGE_RUN_SPIKE.step);
    expect(countAtMax).toBe(1);
  });

  it('every other point stays within the clipped noise band of the baseline (no accidental spikes)', () => {
    const bound = Math.exp(GAUSSIAN_CLIP * def.curve.lossNoise) * (1 + 1e-12);
    let worst = 1;
    for (let i = 0; i < points.length; i++) {
      if (i === LARGE_RUN_SPIKE.step) continue;
      const ratio = lossAt(i) / baselineLossAt(def.curve, i);
      worst = Math.max(worst, ratio, 1 / ratio);
    }
    expect(worst).toBeLessThanOrEqual(bound);
  });

  it('the spike is extreme relative to its neighbours and to the whole run', () => {
    let secondLargest = 0;
    for (let i = 0; i < points.length; i++) {
      if (i !== LARGE_RUN_SPIKE.step) secondLargest = Math.max(secondLargest, lossAt(i));
    }
    let neighbourMax = 0;
    for (let i = LARGE_RUN_SPIKE.step - 1_000; i <= LARGE_RUN_SPIKE.step + 1_000; i++) {
      if (i !== LARGE_RUN_SPIKE.step) neighbourMax = Math.max(neighbourMax, lossAt(i));
    }
    expect(LARGE_RUN_SPIKE.value / neighbourMax).toBeGreaterThan(20);
    expect(LARGE_RUN_SPIKE.value / secondLargest).toBeGreaterThan(5);
  });

  it('only loss spikes: lr and grad_norm at the spike step are ordinary', () => {
    const spike = points[LARGE_RUN_SPIKE.step];
    const bound = Math.exp(GAUSSIAN_CLIP * def.curve.gradNormNoise) * (1 + 1e-12);
    const ratio = (spike?.grad_norm ?? Number.NaN) / baselineGradNormAt(def.curve, LARGE_RUN_SPIKE.step);
    expect(ratio).toBeLessThanOrEqual(bound);
    expect(ratio).toBeGreaterThanOrEqual(1 / bound);
    const lrBefore = points[LARGE_RUN_SPIKE.step - 1]?.lr ?? Number.NaN;
    expect(Math.abs((spike?.lr ?? Number.NaN) - lrBefore) / lrBefore).toBeLessThan(1e-4);
  });

  it('is deterministic: a second generation is identical point-for-point', () => {
    expect(samePoints(generateRun(def), points)).toBe(true);
  });
});
