import { beforeAll, describe, expect, it } from 'vitest';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import type { TrainingRun } from '../../../types/training';
import { LARGE_RUN_ID, LARGE_RUN_SPIKE } from '../catalog/runCatalog';
import { analyzeRun, stepAt, valueAt, type RunIntegrity } from './analyzeRun';

let run: TrainingRun;
let result: RunIntegrity;

beforeAll(() => {
  run = loadFrozenRun(LARGE_RUN_ID);
  result = analyzeRun(run);
});

describe(`integrity of the million-point run (${LARGE_RUN_ID})`, () => {
  it('analyses all 1,000,000 records of the frozen input without issues', () => {
    expect(Object.isFrozen(run.points)).toBe(true);
    expect(result.diagnostics).toMatchObject({
      totalRecords: 1_000_000,
      distinctSteps: 1_000_000,
      isSorted: true,
      duplicateStepCount: 0,
      missingStepCount: 0,
      invalidStepCount: 0,
      issues: [],
    });
  });

  it('builds an index view, not a copy: one Uint32Array shared by all metrics', () => {
    expect(result.view.points).toBe(run.points);
    expect(result.view.displayIndex).toBeInstanceOf(Uint32Array);
    expect(result.view.displayIndex.length).toBe(1_000_000);
    expect(stepAt(result.view, 999_999)).toBe(999_999);
  });

  it(`preserves the spike: loss ${LARGE_RUN_SPIKE.value} at step ${LARGE_RUN_SPIKE.step}`, () => {
    const position = LARGE_RUN_SPIKE.step; // steps are 0..999,999, so position equals step
    expect(stepAt(result.view, position)).toBe(LARGE_RUN_SPIKE.step);
    expect(valueAt(result.view, 'loss', position)).toBe(LARGE_RUN_SPIKE.value);
    expect(result.summaries.loss.max).toEqual({
      value: LARGE_RUN_SPIKE.value,
      step: LARGE_RUN_SPIKE.step,
      sourceIndex: LARGE_RUN_SPIKE.step,
    });
  });

  it('keeps the spike inside one continuous loss line (a finite spike is data, not a break)', () => {
    expect(result.view.metrics.loss.segments).toEqual([{ start: 0, end: 999_999 }]);
    expect(result.view.metrics.loss.nonFinite).toEqual([]);
  });
});
