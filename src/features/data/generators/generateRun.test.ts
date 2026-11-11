import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DETECTABLE_SCENARIOS,
  detectScenarioFeatures,
  getDefinition,
  gridSteps,
  METRICS,
  samePoints,
  stepsWhere,
} from '../../../test/dataTestUtils';
import { LARGE_RUN_ID, RUN_DEFINITIONS } from '../catalog/runCatalog';
import { baselineLossAt } from './curves';
import { generateRun } from './generateRun';
import { countPoints } from './runDefinition';

// The million-point run has its own test file.
const STANDARD = RUN_DEFINITIONS.filter((d) => d.metadata.id !== LARGE_RUN_ID);
const generated = new Map(STANDARD.map((d) => [d.metadata.id, generateRun(d)]));
const pointsOf = (id: string) => {
  const points = generated.get(id);
  if (!points) throw new Error(`not generated: ${id}`);
  return points;
};
const pointAt = (id: string, step: number, occurrence = 0) => {
  const point = pointsOf(id).filter((p) => p.step === step)[occurrence];
  if (!point) throw new Error(`${id}: no point #${occurrence} at step ${step}`);
  return point;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateRun: shape and determinism', () => {
  it.each(STANDARD.map((d) => d.metadata.id))('%s: every point has step, loss, lr and grad_norm', (id) => {
    const malformed = pointsOf(id).filter(
      (p) =>
        Object.keys(p).sort().join() !== 'grad_norm,loss,lr,step' ||
        typeof p.step !== 'number' ||
        METRICS.some((m) => p[m] !== null && typeof p[m] !== 'number'),
    );
    expect(malformed).toEqual([]);
  });

  it.each(STANDARD.map((d) => d.metadata.id))('%s: point count matches countPoints()', (id) => {
    expect(pointsOf(id)).toHaveLength(countPoints(getDefinition(id)));
  });

  it('produces identical output for the same definition and seed', () => {
    for (const def of STANDARD) {
      expect(samePoints(generateRun(def), pointsOf(def.metadata.id)), def.metadata.id).toBe(true);
    }
  });

  it('produces different values for a different seed', () => {
    const def = getDefinition('run-01');
    expect(samePoints(generateRun(def, def.seed + 1), pointsOf('run-01'))).toBe(false);
  });

  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    for (const def of STANDARD) generateRun(def);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not mutate the definition', () => {
    const def = getDefinition('run-19');
    const before = structuredClone(def);
    generateRun(def);
    expect(def).toEqual(before);
  });

  it('returns a fresh array on each call', () => {
    const def = getDefinition('run-01');
    const a = generateRun(def);
    const b = generateRun(def);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('throws instead of silently ignoring an off-grid anomaly step', () => {
    const def = getDefinition('run-01');
    expect(() =>
      generateRun({
        ...def,
        anomalies: { valueOverrides: [{ step: 15, metric: 'loss', value: Number.NaN }] },
      }),
    ).toThrow(/not on the base grid/);
  });
});

describe('generateRun: anomaly categories are independently identifiable', () => {
  it.each(STANDARD.map((d) => d.metadata.id))('%s contains exactly its declared anomaly types', (id) => {
    const def = getDefinition(id);
    const expected = def.metadata.scenarios.filter((s) => DETECTABLE_SCENARIOS.includes(s));
    const found = detectScenarioFeatures(pointsOf(id), def.stepInterval);
    expect([...found].sort()).toEqual([...expected].sort());
  });
});

describe('generateRun: curve scenarios', () => {
  const finiteLoss = (id: string) =>
    pointsOf(id).map((p) => p.loss).filter((v): v is number => v !== null && Number.isFinite(v));
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  };
  /** Mean absolute log-residual of loss against its noise-free baseline. */
  const noiseLevel = (id: string) => {
    const def = getDefinition(id);
    const residuals = pointsOf(id).map((p) =>
      Math.abs(Math.log((p.loss ?? Number.NaN) / baselineLossAt(def.curve, p.step))),
    );
    return residuals.reduce((a, b) => a + b, 0) / residuals.length;
  };

  it.each(['run-01', 'run-02', 'run-03', 'run-04'])('%s (healthy) is finite, sequential and converging', (id) => {
    const def = getDefinition(id);
    const points = pointsOf(id);
    expect(points.map((p) => p.step)).toEqual(gridSteps(0, (def.length - 1) * def.stepInterval, def.stepInterval));
    expect(points.filter((p) => METRICS.some((m) => !Number.isFinite(p[m])))).toEqual([]);
    const loss = finiteLoss(id);
    expect(median(loss.slice(-100))).toBeLessThan(median(loss.slice(0, 100)) * 0.75);
  });

  it('noisy runs are much noisier than the healthy baseline', () => {
    const healthy = noiseLevel('run-01');
    expect(noiseLevel('run-05')).toBeGreaterThan(healthy * 4);
    expect(noiseLevel('run-06')).toBeGreaterThan(healthy * 4);
  });

  it.each(['run-07', 'run-08'])('%s (plateau) stops improving in its second half', (id) => {
    const loss = finiteLoss(id);
    const middle = median(loss.slice(950, 1_050));
    const end = median(loss.slice(-100));
    expect(Math.abs(end - middle) / middle).toBeLessThan(0.03);
    expect(end).toBeGreaterThan(3); // plateaus at a high loss
  });

  it.each(['run-09', 'run-10'])('%s (diverging) grows far above its minimum but stays finite', (id) => {
    const points = pointsOf(id);
    expect(points.filter((p) => METRICS.some((m) => !Number.isFinite(p[m])))).toEqual([]);
    const loss = finiteLoss(id);
    const min = Math.min(...loss);
    const last = loss.at(-1) ?? Number.NaN;
    expect(last).toBeGreaterThan(min * 10);
    expect(last).toBeGreaterThan(loss[0] ?? Number.POSITIVE_INFINITY);
  });
});

describe('generateRun: invalid numeric values are preserved', () => {
  it('run-11 keeps NaN loss at exactly the declared steps (not 0, not null)', () => {
    expect(stepsWhere(pointsOf('run-11'), (p) => Number.isNaN(p.loss))).toEqual([4_200, 9_150, 15_000]);
    const p = pointAt('run-11', 9_150);
    expect(p.loss).not.toBe(0);
    expect(p.loss).not.toBeNull();
    expect(Number.isFinite(p.lr) && Number.isFinite(p.grad_norm)).toBe(true);
  });

  it('run-12 has NaN loss for every step from 14,000 and finite loss before it', () => {
    const points = pointsOf('run-12');
    expect(stepsWhere(points, (p) => Number.isNaN(p.loss) !== p.step >= 14_000)).toEqual([]);
    expect(stepsWhere(points, (p) => Number.isNaN(p.loss))).toHaveLength(600);
  });

  it('run-13 keeps +Infinity loss at exactly the declared steps', () => {
    expect(stepsWhere(pointsOf('run-13'), (p) => p.loss === Number.POSITIVE_INFINITY)).toEqual([6_000, 13_370]);
    expect(stepsWhere(pointsOf('run-13'), (p) => !Number.isFinite(p.loss))).toEqual([6_000, 13_370]);
  });

  it('run-14 has +Infinity loss for every step from 16,500', () => {
    const points = pointsOf('run-14');
    expect(stepsWhere(points, (p) => (p.loss === Number.POSITIVE_INFINITY) !== p.step >= 16_500)).toEqual([]);
    expect(stepsWhere(points, (p) => p.loss === Number.POSITIVE_INFINITY)).toHaveLength(350);
  });

  it('run-18 keeps missing values as null, distinct from NaN', () => {
    const points = pointsOf('run-18');
    expect(stepsWhere(points, (p) => p.lr === null)).toEqual([2_000, 2_010, 2_020]);
    expect(stepsWhere(points, (p) => p.grad_norm === null)).toEqual([7_500]);
    expect(stepsWhere(points, (p) => p.loss === null)).toEqual([10_000]);
    expect(points.filter((p) => METRICS.some((m) => Number.isNaN(p[m])))).toEqual([]);
  });

  it('run-19 keeps NaN, -Infinity and null exactly where declared', () => {
    expect(Number.isNaN(pointAt('run-19', 3_330).loss)).toBe(true);
    expect(pointAt('run-19', 7_770).loss).toBe(Number.NEGATIVE_INFINITY);
    expect(pointAt('run-19', 9_990).grad_norm).toBeNull();
  });
});

describe('generateRun: step-structure anomalies', () => {
  const countBy = (steps: number[]) => {
    const counts = new Map<number, number>();
    for (const s of steps) counts.set(s, (counts.get(s) ?? 0) + 1);
    return counts;
  };

  it('run-15 logs steps 8,000–8,490 twice with conflicting values, and step 12,000 twice identically', () => {
    const points = pointsOf('run-15');
    const counts = countBy(points.map((p) => p.step));
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([s]) => s);
    expect(duplicated).toEqual([...gridSteps(8_000, 8_490, 10), 12_000]);
    expect(Math.max(...counts.values())).toBe(2);

    // Each copy directly follows its original, so the steps never decrease.
    const first = points.findIndex((p) => p.step === 8_000);
    expect(points.slice(first, first + 4).map((p) => p.step)).toEqual([8_000, 8_000, 8_010, 8_010]);

    // Re-logged copies carry different values, so duplicates conflict.
    expect(pointAt('run-15', 8_200, 1).loss).not.toBe(pointAt('run-15', 8_200, 0).loss);
    // The double-write is an exact copy.
    expect(pointAt('run-15', 12_000, 1)).toEqual(pointAt('run-15', 12_000, 0));
  });

  it('run-16 has steps out of order exactly at the two delayed blocks, with nothing lost or duplicated', () => {
    const points = pointsOf('run-16');
    const descents: [number, number][] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]?.step ?? 0;
      const cur = points[i]?.step ?? 0;
      if (cur < prev) descents.push([prev, cur]);
    }
    expect(descents).toEqual([
      [5_490, 5_000],
      [11_500, 11_000],
    ]);
    expect(points.map((p) => p.step).sort((a, b) => a - b)).toEqual(gridSteps(0, 19_990, 10));
  });

  it('run-17 is missing exactly the declared steps, reproducibly', () => {
    const expectedMissing = [
      ...gridSteps(3_000, 3_990, 10),
      12_500,
      ...gridSteps(17_000, 18_990, 10),
    ];
    const missingIn = (steps: number[]) => {
      const present = new Set(steps);
      return gridSteps(0, 19_990, 10).filter((s) => !present.has(s));
    };
    const first = missingIn(pointsOf('run-17').map((p) => p.step));
    const second = missingIn(generateRun(getDefinition('run-17')).map((p) => p.step));
    expect(first).toEqual(expectedMissing);
    expect(second).toEqual(first);
    expect(first).toHaveLength(301);
  });

  it('run-19 combines a gap, an identical duplicate and a delayed block', () => {
    const steps = pointsOf('run-19').map((p) => p.step);
    expect(steps.filter((s) => s >= 14_000 && s <= 14_490)).toEqual([]);
    expect(steps.filter((s) => s === 6_010)).toHaveLength(2);
    const after10200 = steps.indexOf(10_200);
    expect(steps.slice(after10200 + 1, after10200 + 6)).toEqual(gridSteps(10_000, 10_040, 10));
  });
});
