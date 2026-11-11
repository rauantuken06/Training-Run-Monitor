import { describe, expect, it } from 'vitest';
import { checkDownsample } from '../../../test/downsampleReference';
import { fixtureRun, pt } from '../../../test/integrityTestUtils';
import type { StepSampling, TrainingPoint } from '../../../types/training';
import { analyzeRun } from '../integrity/analyzeRun';
import { downsampleMetric, type Viewport } from './downsample';

function run(points: TrainingPoint[], sampling: StepSampling = { kind: 'fixed', interval: 10 }) {
  const input = fixtureRun(points, sampling);
  return { input, view: analyzeRun(input).view };
}
function ds(points: TrainingPoint[], viewport: Viewport, budget: number, sampling?: StepSampling) {
  const { input, view } = run(points, sampling);
  const result = downsampleMetric(view, 'loss', viewport, budget);
  return { result, violations: checkDownsample(input.points, input.sampling, 'loss', viewport, budget, result) };
}
const series = (values: (number | null)[], interval = 10) => values.map((v, i) => pt(i * interval, v));

describe('L. empty and all-invalid data', () => {
  it('handles an empty run', () => {
    const { result, violations } = ds([], { minStep: 0, maxStep: 100 }, 10);
    expect(violations).toEqual([]);
    expect(result).toMatchObject({ visibleStepRange: null, visibleCount: 0, inputCount: 0, outputCount: 0, reduced: false, points: [], segments: [], extrema: { min: null, max: null } });
  });

  it('handles an all-invalid run: no points, but every invalid value is reported', () => {
    const { result, violations } = ds(series([Number.NaN, Infinity, null, -Infinity, Number.NaN]), { minStep: 0, maxStep: 40 }, 10);
    expect(violations).toEqual([]);
    expect(result.points).toEqual([]);
    expect(result.invalidRuns).toEqual([
      { startPosition: 0, endPosition: 4, startStep: 0, endStep: 40, startSourceIndex: 0, endSourceIndex: 4, count: 5, kinds: { nan: 2, positive_infinity: 1, negative_infinity: 1, missing: 1 } },
    ]);
  });

  it('handles a viewport with no data in it', () => {
    const { result } = ds(series([1, 2, 3]), { minStep: 1_000, maxStep: 2_000 }, 10);
    expect(result).toMatchObject({ visibleCount: 0, outputCount: 0, points: [] });
  });
});

describe('K. very small budgets', () => {
  const values = Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) + (i === 321 ? 9 : 0) - (i === 77 ? 5 : 0));
  it.each([1, 2, 3, 4, 5, 7, 8, 9])('budget %i keeps the extrema and stays within budget unless warned', (budget) => {
    const { result, violations } = ds(series(values), { minStep: 0, maxStep: 4_990 }, budget);
    expect(violations).toEqual([]);
    expect(result.points.map((p) => p.step)).toEqual(expect.arrayContaining([770, 3_210]));
    if (budget >= 4) expect(result.outputCount).toBeLessThanOrEqual(budget);
  });
});

describe('M. narrow viewports', () => {
  it('a single-step viewport on a present step returns exactly that point', () => {
    const { result } = ds(series([1, 2, 3, 4]), { minStep: 20, maxStep: 20 }, 1);
    expect(result.points).toEqual([{ position: 2, sourceIndex: 2, step: 20, value: 3 }]);
    expect(result.segments).toEqual([{ start: 0, end: 0 }]);
  });

  it('a viewport between two recorded steps is empty, without error or invention', () => {
    const { result } = ds(series([1, 2, 3, 4]), { minStep: 11, maxStep: 19 }, 10);
    expect(result.points).toEqual([]);
    expect(result.gaps).toEqual([]); // interval 10: nothing is missing between 10 and 20
  });

  it('a single-step viewport on an invalid value shows a marker, not a point', () => {
    const { result } = ds(series([1, Number.NaN, 3]), { minStep: 10, maxStep: 10 }, 1);
    expect(result.points).toEqual([]);
    expect(result.invalidRuns).toMatchObject([{ startStep: 10, count: 1, kinds: { nan: 1 } }]);
  });
});

describe('N. step intervals and irregular sampling', () => {
  it('interval 1, 10 and 250 behave the same up to scale', () => {
    const values = Array.from({ length: 300 }, (_, i) => Math.cos(i / 9) * (i % 17));
    for (const interval of [1, 10, 250]) {
      const pts = series(values, interval);
      const { result, violations } = ds(pts, { minStep: 0, maxStep: 299 * interval }, 40, { kind: 'fixed', interval });
      expect(violations).toEqual([]);
      expect(result.points.map((p) => p.step / interval)).toEqual(
        ds(series(values, 1), { minStep: 0, maxStep: 299 }, 40, { kind: 'fixed', interval: 1 }).result.points.map((p) => p.step),
      );
    }
  });

  it('irregular steps: dense and sparse regions are bucketed by step, not by index', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 500, 1_000, 1_001, 5_000];
    const pts = steps.map((s, i) => pt(s, (i * 37) % 11));
    const { result, violations } = ds(pts, { minStep: 0, maxStep: 5_000 }, 12, { kind: 'irregular' });
    expect(violations).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.segments).toHaveLength(1); // irregular sampling: big step jumps are not gaps
  });
});

describe('O. numerical fidelity', () => {
  it('keeps tiny, negative, zero, huge and subnormal values exactly', () => {
    const values = [5e-324, -1e-300, 0, -0, 1.7976931348623157e308, -1.7976931348623157e308, 1e-12, -3.5, 2 ** 53 + 2, 0.1 + 0.2];
    const { result, violations } = ds(series(values), { minStep: 0, maxStep: 90 }, 1_000);
    expect(violations).toEqual([]);
    expect(result.points.map((p) => p.value)).toEqual(values);
    expect(Object.is(result.points[3]?.value, -0)).toBe(true);
    expect(result.extrema.min?.value).toBe(-1.7976931348623157e308);
    expect(result.extrema.max?.value).toBe(1.7976931348623157e308);
  });

  it('keeps exact extrema of negative and near-zero series when reducing', () => {
    const values = Array.from({ length: 1_000 }, (_, i) => -1e-9 * (1 + ((i * 7919) % 101)));
    const { result, violations } = ds(series(values, 1), { minStep: 0, maxStep: 999 }, 20, { kind: 'fixed', interval: 1 });
    expect(violations).toEqual([]);
    expect(result.extrema.min?.value).toBe(Math.min(...values));
    expect(result.extrema.max?.value).toBe(Math.max(...values));
  });

  it('a constant series reduces to segment endpoints with identical min and max', () => {
    const { result, violations } = ds(series(Array.from({ length: 400 }, () => 0.25)),{ minStep: 0, maxStep: 3_990 }, 8);
    expect(violations).toEqual([]);
    expect(result.extrema.min?.value).toBe(0.25);
    expect(result.extrema.max?.value).toBe(0.25);
    expect(result.points[0]?.step).toBe(0);
    expect(result.points.at(-1)?.step).toBe(3_990);
  });
});

describe('J. hidden duplicate values', () => {
  it('warns when a hidden copy lies outside the plotted extrema', () => {
    // Step 20 is logged twice. The displayed (last) copy is 3; the hidden copy is 100.
    const { result } = ds([pt(0, 1), pt(10, 2), pt(20, 100), pt(20, 3), pt(30, 4)], { minStep: 0, maxStep: 30 }, 10);
    expect(result.extrema.max?.value).toBe(4);
    expect(result.conflicts).toHaveLength(1);
    expect(result.warnings).toContainEqual(expect.objectContaining({ kind: 'hidden_duplicate_outside_extrema', step: 20, sourceIndex: 2, value: 100 }));
  });

  it('does not warn when hidden copies are within the plotted extrema', () => {
    const { result } = ds([pt(0, 1), pt(10, 2.5), pt(10, 2), pt(20, 4)], { minStep: 0, maxStep: 30 }, 10);
    expect(result.conflicts).toHaveLength(1);
    expect(result.warnings.some((w) => w.kind === 'hidden_duplicate_outside_extrema')).toBe(false);
  });
});
