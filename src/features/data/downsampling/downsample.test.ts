import { describe, expect, it } from 'vitest';
import { checkDownsample } from '../../../test/downsampleReference';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import type { MetricKey, TrainingRun } from '../../../types/training';
import { analyzeRun, type ChartView } from '../integrity/analyzeRun';
import { downsampleMetric, type Viewport } from './downsample';

const IDS = ['run-01', 'run-05', 'run-11', 'run-12', 'run-13', 'run-14', 'run-15', 'run-16', 'run-17', 'run-18', 'run-19'];
const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];
const data = new Map(
  IDS.map((id) => {
    const run = loadFrozenRun(id);
    return [id, { run, view: analyzeRun(run).view }];
  }),
);
const get = (id: string) => data.get(id) as { run: TrainingRun; view: ChartView };

const VIEWPORTS: readonly Viewport[] = [
  { minStep: 0, maxStep: 19_990 }, // full range
  { minStep: -1_000, maxStep: 50_000 }, // wider than the data
  { minStep: 2_500, maxStep: 13_000 }, // middle, crossing several anomalies
  { minStep: 8_100, maxStep: 8_300 }, // narrow
  { minStep: 4_195, maxStep: 4_205 }, // around run-11's first NaN, bounds off-grid
];
const BUDGETS = [1, 2, 3, 4, 8, 20, 100, 1_000, 5_000];

describe('downsampleMetric on the real catalog runs', () => {
  it.each(IDS)('%s: every viewport × budget × metric satisfies all reference invariants', (id) => {
    const { run, view } = get(id);
    const violations: string[] = [];
    for (const metric of METRICS) {
      for (const viewport of VIEWPORTS) {
        for (const budget of BUDGETS) {
          const result = downsampleMetric(view, metric, viewport, budget);
          for (const msg of checkDownsample(run.points, run.sampling, metric, viewport, budget, result)) {
            violations.push(`${metric} [${viewport.minStep}, ${viewport.maxStep}] budget ${budget}: ${msg}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('is deterministic', () => {
    const { view } = get('run-19');
    const a = downsampleMetric(view, 'loss', { minStep: 0, maxStep: 19_990 }, 40);
    const b = downsampleMetric(view, 'loss', { minStep: 0, maxStep: 19_990 }, 40);
    expect(a).toEqual(b);
  });

  it('returns everything without reduction when the budget allows', () => {
    const r = downsampleMetric(get('run-01').view, 'loss', { minStep: 0, maxStep: 19_990 }, 5_000);
    expect(r).toMatchObject({ method: 'all', reduced: false, inputCount: 2_000, outputCount: 2_000 });
  });
});

describe('invalid values and gaps break lines', () => {
  it('run-11: each NaN ends a plotted segment, even at a tiny budget', () => {
    for (const budget of [3, 20, 5_000]) {
      const r = downsampleMetric(get('run-11').view, 'loss', { minStep: 0, maxStep: 19_990 }, budget);
      expect(r.segments).toHaveLength(4);
      expect(r.invalidRuns.map((x) => [x.startStep, x.kinds.nan])).toEqual([
        [4_200, 1],
        [9_150, 1],
        [15_000, 1],
      ]);
      expect(r.warnings).toContainEqual({ kind: 'invalid_values', count: 3, runCount: 3 });
    }
  });

  it('run-13 / run-19 / run-18: +Infinity, -Infinity and null are markers, never plotted values', () => {
    const inf = downsampleMetric(get('run-13').view, 'loss', { minStep: 0, maxStep: 19_990 }, 50);
    expect(inf.invalidRuns.map((x) => x.kinds.positive_infinity)).toEqual([1, 1]);
    expect(inf.extrema.max?.value).toBeLessThan(10);

    const neg = downsampleMetric(get('run-19').view, 'loss', { minStep: 7_000, maxStep: 8_000 }, 50);
    expect(neg.invalidRuns).toMatchObject([{ startStep: 7_770, count: 1, kinds: { negative_infinity: 1 } }]);
    expect(neg.extrema.min?.value).toBeGreaterThan(0);

    const missing = downsampleMetric(get('run-18').view, 'lr', { minStep: 0, maxStep: 19_990 }, 50);
    expect(missing.invalidRuns).toMatchObject([{ startStep: 2_000, endStep: 2_020, count: 3, kinds: { missing: 3 } }]);
    expect(missing.segments).toHaveLength(2);
  });

  it('run-12: the NaN tail is one invalid run after the last segment', () => {
    const r = downsampleMetric(get('run-12').view, 'loss', { minStep: 0, maxStep: 19_990 }, 100);
    expect(r.segments).toHaveLength(1);
    expect(r.points.at(-1)?.step).toBe(13_990);
    expect(r.invalidRuns).toMatchObject([{ startStep: 14_000, endStep: 19_990, count: 600, kinds: { nan: 600 } }]);
  });

  it('run-17: lines break at all three outages, and the gaps are reported', () => {
    const r = downsampleMetric(get('run-17').view, 'grad_norm', { minStep: 0, maxStep: 19_990 }, 40);
    expect(r.segments).toHaveLength(4);
    expect(r.gaps.map((g) => g.missingCount)).toEqual([100, 1, 200]);
    expect(r.warnings).toContainEqual({ kind: 'missing_steps', gapCount: 3, missingStepCount: 301 });
    // A viewport entirely inside an outage shows no points but still reports the gap.
    const inside = downsampleMetric(get('run-17').view, 'loss', { minStep: 17_500, maxStep: 18_000 }, 40);
    expect(inside.points).toEqual([]);
    expect(inside.gaps.map((g) => g.firstMissingStep)).toEqual([17_000]);
  });

  it('keeps every segment when there are more segments than budget, and says so', () => {
    const r = downsampleMetric(get('run-11').view, 'loss', { minStep: 0, maxStep: 19_990 }, 2);
    expect(r.method).toBe('endpoints_and_extrema');
    expect(r.segments).toHaveLength(4);
    expect(r.warnings).toContainEqual({ kind: 'budget_exceeded', budget: 2, required: r.outputCount, segmentCount: 4 });
  });
});

describe('duplicates', () => {
  it('run-15: conflicting duplicates in the viewport are listed with every raw record', () => {
    const { view, run } = get('run-15');
    const r = downsampleMetric(view, 'loss', { minStep: 8_000, maxStep: 8_490 }, 10);
    expect(r.conflicts.map((c) => c.step)).toEqual(Array.from({ length: 50 }, (_, k) => 8_000 + k * 10));
    expect(r.warnings).toContainEqual({ kind: 'conflicting_duplicates', count: 50 });
    for (const issue of r.conflicts) {
      expect(issue.records).toHaveLength(2);
      issue.records.forEach((record, k) => {
        expect(run.points[issue.sourceIndices[k] ?? -1]).toBe(record);
      });
    }
    // lr does not conflict, so it reports no conflicts.
    expect(downsampleMetric(view, 'lr', { minStep: 8_000, maxStep: 8_490 }, 10).conflicts).toEqual([]);
    // The identical double-write at 12,000 is not a conflict.
    expect(downsampleMetric(view, 'loss', { minStep: 11_000, maxStep: 13_000 }, 10).conflicts).toEqual([]);
  });

  it('run-15: plotted points use the displayed (last-recorded) copy', () => {
    const { view } = get('run-15');
    const r = downsampleMetric(view, 'loss', { minStep: 8_000, maxStep: 8_490 }, 1_000);
    for (const p of r.points) {
      const issue = r.conflicts.find((c) => c.step === p.step);
      if (issue) expect(p.sourceIndex).toBe(issue.displayedSourceIndex);
    }
  });
});

describe('validation', () => {
  const { view } = get('run-01');
  it.each([
    [{ minStep: Number.NaN, maxStep: 10 }, 10],
    [{ minStep: 0, maxStep: Infinity }, 10],
    [{ minStep: 10, maxStep: 5 }, 10],
    [{ minStep: 0, maxStep: 10 }, 0],
    [{ minStep: 0, maxStep: 10 }, -4],
    [{ minStep: 0, maxStep: 10 }, 2.5],
    [{ minStep: 0, maxStep: 10 }, Number.NaN],
  ])('rejects viewport %o with budget %s', (viewport, budget) => {
    expect(() => downsampleMetric(view, 'loss', viewport, budget)).toThrow(RangeError);
  });
});
