import { describe, expect, it } from 'vitest';
import { fixtureRun, pt } from '../../../test/integrityTestUtils';
import { analyzeRun, stepAt } from './analyzeRun';
import { classifyValue, isValidStep } from './values';

const steps = (r: ReturnType<typeof analyzeRun>) =>
  Array.from({ length: r.view.displayIndex.length }, (_, p) => stepAt(r.view, p));

describe('classifyValue / isValidStep', () => {
  it('distinguishes all five value kinds', () => {
    expect([1.5, 0, -2, Number.NaN, Infinity, -Infinity, null].map(classifyValue)).toEqual([
      'finite', 'finite', 'finite', 'nan', 'positive_infinity', 'negative_infinity', 'missing',
    ]);
  });

  it('accepts only finite non-negative integer steps', () => {
    expect([0, 10, 1e6, -1, 2.5, Number.NaN, Infinity].map(isValidStep)).toEqual([
      true, true, true, false, false, false, false,
    ]);
  });
});

describe('empty and all-invalid datasets', () => {
  it('handles an empty run', () => {
    const r = analyzeRun(fixtureRun([]));
    expect(r.diagnostics).toMatchObject({ totalRecords: 0, distinctSteps: 0, isSorted: true, missingStepCount: 0, issues: [] });
    for (const s of Object.values(r.summaries)) {
      expect(s).toMatchObject({ min: null, max: null, firstFinite: null, lastFinite: null, last: null, endsNonFinite: false, invalidCount: 0 });
    }
    for (const m of Object.values(r.view.metrics)) expect(m.segments).toEqual([]);
  });

  it('handles a run whose loss is entirely invalid without inventing values', () => {
    const r = analyzeRun(
      fixtureRun([pt(0, Number.NaN), pt(10, Infinity), pt(20, null), pt(30, -Infinity), pt(40, Number.NaN)]),
    );
    const loss = r.summaries.loss;
    expect(loss).toMatchObject({ min: null, max: null, firstFinite: null, lastFinite: null, endsNonFinite: true, invalidCount: 4 });
    expect(loss.counts).toEqual({ finite: 0, nan: 2, positiveInfinity: 1, negativeInfinity: 1, missing: 1 });
    expect(r.view.metrics.loss.segments).toEqual([]);
    expect(r.diagnostics.issues.filter((i) => i.kind === 'non_finite_tail')).toEqual([
      { kind: 'non_finite_tail', severity: 'error', metric: 'loss', fromStep: 0, count: 5, lastValueKind: 'nan' },
    ]);
    // Other metrics are unaffected.
    expect(r.view.metrics.lr.segments).toEqual([{ start: 0, end: 4 }]);
  });
});

describe('invalid steps', () => {
  it('excludes unplaceable records from the view but reports and counts them', () => {
    const r = analyzeRun(
      fixtureRun([pt(0, 2), pt(Number.NaN, 0.001), pt(10, 2), pt(-10, 2), pt(2.5, 2), pt(Infinity, 2), pt(20, 2)]),
    );
    expect(steps(r)).toEqual([0, 10, 20]);
    expect(r.diagnostics.issues.filter((i) => i.kind === 'invalid_step').map((i) => i.sourceIndex)).toEqual([1, 3, 4, 5]);
    expect(r.diagnostics.invalidStepCount).toBe(4);
    expect(r.summaries.loss.counts.finite).toBe(7);
    // Documented policy: min/max only use records that can be placed on the axis.
    expect(r.summaries.loss.min?.value).toBe(2);
  });
});

describe('ordering', () => {
  it('sorts steps numerically, not lexicographically', () => {
    const r = analyzeRun(fixtureRun([pt(100, 1), pt(20, 1), pt(3, 1), pt(1000, 1)], { kind: 'irregular' }));
    expect(steps(r)).toEqual([3, 20, 100, 1000]);
    expect(r.diagnostics.isSorted).toBe(false);
  });
});

describe('duplicates', () => {
  it('treats NaN == NaN as identical, but NaN vs null as a conflict', () => {
    const same = analyzeRun(fixtureRun([pt(0, Number.NaN), pt(0, Number.NaN)]));
    expect(same.view.duplicates[0]?.issue.conflictingMetrics).toEqual([]);
    const differ = analyzeRun(fixtureRun([pt(0, Number.NaN), pt(0, null)]));
    expect(differ.view.duplicates[0]?.issue.conflictingMetrics).toEqual(['loss']);
  });

  it('displays the last of three conflicting records and keeps all three', () => {
    const r = analyzeRun(fixtureRun([pt(10, 1), pt(0, 5), pt(10, 2), pt(10, 3)]));
    const dup = r.view.duplicates[0]?.issue;
    expect(dup?.sourceIndices).toEqual([0, 2, 3]);
    expect(dup?.records.map((p) => p.loss)).toEqual([1, 2, 3]);
    expect(dup?.displayedSourceIndex).toBe(3);
    expect(r.view.displayIndex[1]).toBe(3);
    // Extremes still see the hidden copies.
    expect(r.summaries.loss.min).toEqual({ value: 1, step: 10, sourceIndex: 0 });
  });
});

describe('missing steps', () => {
  const irregularSteps = [0, 10, 25, 40, 100].map((s) => pt(s, 1));

  it('reports nothing for declared irregular sampling', () => {
    const r = analyzeRun(fixtureRun(irregularSteps, { kind: 'irregular' }));
    expect(r.view.gaps).toEqual([]);
    expect(r.view.metrics.loss.segments).toEqual([{ start: 0, end: 4 }]);
  });

  it('counts grid steps under fixed sampling', () => {
    const r = analyzeRun(fixtureRun(irregularSteps, { kind: 'fixed', interval: 5 }));
    expect(r.view.gaps.map((g) => [g.issue.firstMissingStep, g.issue.lastMissingStep, g.issue.missingCount])).toEqual([
      [5, 5, 1],
      [15, 20, 2],
      [30, 35, 2],
      [45, 95, 11],
    ]);
  });

  it('reports an off-grid step without inventing a gap around it', () => {
    const r = analyzeRun(fixtureRun([pt(0, 1), pt(10, 1), pt(15, 1), pt(20, 1)]));
    expect(r.diagnostics.issues.map((i) => i.kind)).toEqual(['off_grid_step']);
    expect(r.view.gaps).toEqual([]);
  });

  it('anchors the grid at the first present step', () => {
    const r = analyzeRun(fixtureRun([pt(5, 1), pt(15, 1), pt(45, 1)]));
    expect(r.view.gaps.map((g) => [g.issue.firstMissingStep, g.issue.lastMissingStep])).toEqual([[25, 35]]);
  });

  it('rejects an invalid declared interval instead of guessing', () => {
    expect(() => analyzeRun(fixtureRun([pt(0, 1)], { kind: 'fixed', interval: 0 }))).toThrow(/positive integer/);
    expect(() => analyzeRun(fixtureRun([pt(0, 1)], { kind: 'fixed', interval: 2.5 }))).toThrow(/positive integer/);
  });
});
