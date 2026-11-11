import { beforeAll, describe, expect, it } from 'vitest';
import { checkDownsample } from '../../../test/downsampleReference';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import type { TrainingRun } from '../../../types/training';
import { LARGE_RUN_ID, LARGE_RUN_SPIKE } from '../catalog/runCatalog';
import { analyzeRun, type ChartView } from '../integrity/analyzeRun';
import { downsampleMetric, type Viewport } from './downsample';

const SPIKE = LARGE_RUN_SPIKE; // step 500,123, loss 42.5
/**
 * The brute-force reference check over all 1,000,000 points takes about 2.5 s
 * by itself (measured in isolation), which is close to Vitest's 5 s default
 * once the suite runs in parallel. The limit is raised only for those tests;
 * no assertion is relaxed.
 */
const REFERENCE_CHECK_TIMEOUT = 30_000;
let run: TrainingRun;
let view: ChartView;

beforeAll(() => {
  run = loadFrozenRun(LARGE_RUN_ID);
  view = analyzeRun(run).view;
});

/** Brute-force loss extrema over the raw points in a viewport (steps are 0..999,999, one record each). */
function bruteExtrema({ minStep, maxStep }: Viewport) {
  let min = Infinity;
  let max = -Infinity;
  let maxIndex = -1;
  for (let s = Math.max(0, Math.ceil(minStep)); s <= Math.min(999_999, Math.floor(maxStep)); s++) {
    const v = run.points[s]?.loss as number;
    if (v < min) min = v;
    if (v > max) {
      max = v;
      maxIndex = s;
    }
  }
  return { min, max, maxIndex };
}

function expectSpike(viewport: Viewport, budget: number) {
  const r = downsampleMetric(view, 'loss', viewport, budget);
  const spike = r.points.find((p) => p.step === SPIKE.step);
  expect(spike, `[${viewport.minStep}, ${viewport.maxStep}] budget ${budget}`).toEqual({
    position: SPIKE.step,
    sourceIndex: SPIKE.step,
    step: SPIKE.step,
    value: SPIKE.value,
  });
  expect(r.extrema.max).toEqual(spike);
  // It is part of a drawable segment, not an isolated marker.
  expect(r.segments.some((s) => (r.points[s.start]?.step ?? Infinity) <= SPIKE.step && (r.points[s.end]?.step ?? -1) >= SPIKE.step)).toBe(true);
  return r;
}

describe(`spike preservation on the million-point run (step ${SPIKE.step}, loss ${SPIKE.value})`, () => {
  it('A. full range at a chart-sized budget keeps the exact spike and reduces to the budget', () => {
    const r = expectSpike({ minStep: 0, maxStep: 999_999 }, 4_000);
    expect(r).toMatchObject({ method: 'm4', inputCount: 1_000_000, reduced: true });
    expect(r.outputCount).toBeLessThanOrEqual(4_000);
    expect(checkDownsample(run.points, run.sampling, 'loss', { minStep: 0, maxStep: 999_999 }, 4_000, r)).toEqual([]);
  }, REFERENCE_CHECK_TIMEOUT);

  it('B. keeps the spike at every zoom level and budget', () => {
    const widths = [1_000_000, 300_000, 100_000, 10_000, 1_000, 100, 10, 2, 0];
    for (const width of widths) {
      for (const budget of [1, 4, 16, 100, 1_000, 4_000]) {
        // Centered, and with the spike near the left and right edges.
        for (const offset of [0.5, 0.01, 0.99]) {
          const minStep = SPIKE.step - Math.round(width * offset);
          expectSpike({ minStep, maxStep: minStep + width }, budget);
        }
      }
    }
  });

  it('B. keeps the spike when it is the first or last visible step', () => {
    expectSpike({ minStep: SPIKE.step, maxStep: SPIKE.step + 50_000 }, 8);
    expectSpike({ minStep: SPIKE.step - 50_000, maxStep: SPIKE.step }, 8);
    expectSpike({ minStep: SPIKE.step, maxStep: SPIKE.step }, 1); // single-point viewport
  });

  it('B. keeps the spike wherever it falls relative to bucket boundaries (sliding viewport)', () => {
    // 401 shifted windows of width 10,000 with 8 buckets: the spike lands on, before and
    // after many bucket boundaries.
    for (let shift = 0; shift <= 400; shift++) {
      const minStep = SPIKE.step - 5_000 + shift;
      const r = expectSpike({ minStep, maxStep: minStep + 10_000 }, 36);
      expect(r.bucketCount).toBe(8);
    }
  });

  it('never shows the spike in viewports that exclude it', () => {
    for (const viewport of [
      { minStep: 0, maxStep: SPIKE.step - 1 },
      { minStep: SPIKE.step + 1, maxStep: 999_999 },
      { minStep: SPIKE.step + 1, maxStep: SPIKE.step + 1 },
      { minStep: SPIKE.step - 1, maxStep: SPIKE.step - 1 },
      { minStep: SPIKE.step - 0.5, maxStep: SPIKE.step - 0.1 }, // fractional bounds around it
    ]) {
      const r = downsampleMetric(view, 'loss', viewport, 100);
      expect(r.points.some((p) => p.step === SPIKE.step || p.value === SPIKE.value)).toBe(false);
      expect(r.extrema.max?.value ?? 0).toBeLessThan(5);
    }
  });

  it('C/D. source indices and exact viewport min/max at many zoom levels (brute force)', () => {
    const viewports: Viewport[] = [
      { minStep: 0, maxStep: 999_999 },
      { minStep: 0, maxStep: 1_000 }, // early, high-loss region
      { minStep: 250_000, maxStep: 750_000 },
      { minStep: 499_000, maxStep: 501_000 },
      { minStep: 900_000, maxStep: 999_999 },
      { minStep: 123_456.7, maxStep: 123_999.2 },
    ];
    for (const viewport of viewports) {
      const r = downsampleMetric(view, 'loss', viewport, 1_000);
      const brute = bruteExtrema(viewport);
      expect(r.extrema.min?.value).toBe(brute.min);
      expect(r.extrema.max?.value).toBe(brute.max);
      expect(r.extrema.max?.sourceIndex).toBe(brute.maxIndex);
      for (const p of r.points) {
        expect(run.points[p.sourceIndex]?.loss).toBe(p.value);
        expect(run.points[p.sourceIndex]?.step).toBe(p.step);
      }
    }
  });

  it('Q. output size scales with the budget, not with the million input points', () => {
    const counts = [8, 40, 100, 1_000, 4_000, 10_000].map((budget) => {
      const r = downsampleMetric(view, 'loss', { minStep: 0, maxStep: 999_999 }, budget);
      expect(r.outputCount).toBeLessThanOrEqual(budget);
      // Noisy data rarely has first/last/min/max coincide, so M4 fills most of the budget.
      expect(r.outputCount).toBeGreaterThanOrEqual(budget / 2);
      expect(r.points.some((p) => p.step === SPIKE.step)).toBe(true);
      return r.outputCount;
    });
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it.each(['lr', 'grad_norm'] as const)(
    'Q. %s also reduces to the budget, with exact extrema (full reference check)',
    (metric) => {
      const r = downsampleMetric(view, metric, { minStep: 0, maxStep: 999_999 }, 2_000);
      expect(r.outputCount).toBeLessThanOrEqual(2_000);
      expect(r.segments).toHaveLength(1);
      expect(checkDownsample(run.points, run.sampling, metric, { minStep: 0, maxStep: 999_999 }, 2_000, r)).toEqual([]);
    },
    REFERENCE_CHECK_TIMEOUT,
  );
});
