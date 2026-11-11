import { describe, expect, it } from 'vitest';
import { getDefinition, METRICS, samePoints } from '../../../test/dataTestUtils';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import type {
  DataQualityIssue,
  DataQualityIssueKind,
  MetricKey,
  TrainingRun,
} from '../../../types/training';
import { LARGE_RUN_ID, RUN_DEFINITIONS } from '../catalog/runCatalog';
import { generateRun } from '../generators/generateRun';
import { analyzeRun, stepAt, valueAt, type RunIntegrity } from './analyzeRun';

// Real Task 02 datasets (the million-point run has its own file).
const IDS = RUN_DEFINITIONS.map((d) => d.metadata.id).filter((id) => id !== LARGE_RUN_ID);
const runs = new Map<string, TrainingRun>(IDS.map((id) => [id, loadFrozenRun(id)]));
const results = new Map<string, RunIntegrity>(
  IDS.map((id) => [id, analyzeRun(runs.get(id) as TrainingRun)]),
);
const runOf = (id: string) => runs.get(id) as TrainingRun;
const resultOf = (id: string) => results.get(id) as RunIntegrity;

// Intersection (not Extract) so issue types whose `kind` is a union still narrow.
function issuesOf<K extends DataQualityIssueKind>(id: string, kind: K) {
  return resultOf(id).diagnostics.issues.filter(
    (i): i is DataQualityIssue & { kind: K } => i.kind === kind,
  );
}
const displaySteps = (id: string) => {
  const { view } = resultOf(id);
  return Array.from({ length: view.displayIndex.length }, (_, p) => stepAt(view, p));
};
const positionOfStep = (id: string, step: number) => displaySteps(id).indexOf(step);

describe('raw data preservation', () => {
  it.each(IDS)('%s: analysis of deeply frozen input succeeds and leaves every raw value intact', (id) => {
    const run = runOf(id);
    expect(Object.isFrozen(run.points)).toBe(true);
    expect(samePoints(run.points, generateRun(getDefinition(id)))).toBe(true);
    expect(resultOf(id).view.points).toBe(run.points); // a reference, not a copy
  });
});

describe('numeric validation', () => {
  it('run-11: NaN is reported at its exact steps and never read as 0', () => {
    const nanIssues = issuesOf('run-11', 'nan');
    expect(nanIssues.map((i) => [i.metric, i.step])).toEqual([
      ['loss', 4_200],
      ['loss', 9_150],
      ['loss', 15_000],
    ]);
    for (const issue of nanIssues) {
      expect(Number.isNaN(runOf('run-11').points[issue.sourceIndex]?.loss)).toBe(true);
    }
    const { summaries, view } = resultOf('run-11');
    expect(summaries.loss.counts).toEqual({ finite: 1_997, nan: 3, positiveInfinity: 0, negativeInfinity: 0, missing: 0 });
    expect(summaries.loss.min?.value).toBeGreaterThan(1); // a NaN read as 0 would be the minimum
    expect(Number.isNaN(valueAt(view, 'loss', positionOfStep('run-11', 9_150)))).toBe(true);
    expect(view.metrics.loss.nonFinite.map((s) => s.kind)).toEqual(['nan', 'nan', 'nan']);
  });

  it('run-13 / run-19: +Infinity and -Infinity are identified separately and excluded from min/max', () => {
    expect(issuesOf('run-13', 'positive_infinity').map((i) => i.step)).toEqual([6_000, 13_370]);
    expect(issuesOf('run-13', 'negative_infinity')).toEqual([]);
    expect(resultOf('run-13').summaries.loss.max?.value).toBeLessThan(10);

    expect(issuesOf('run-19', 'negative_infinity').map((i) => [i.metric, i.step])).toEqual([['loss', 7_770]]);
    expect(issuesOf('run-19', 'positive_infinity')).toEqual([]);
    expect(Number.isFinite(resultOf('run-19').summaries.loss.min?.value)).toBe(true);
    expect(resultOf('run-19').summaries.loss.counts.negativeInfinity).toBe(1);
  });

  it('run-18: null is reported as missing_value, never as NaN', () => {
    expect(issuesOf('run-18', 'missing_value').map((i) => [i.metric, i.step])).toEqual([
      ['lr', 2_000],
      ['lr', 2_010],
      ['lr', 2_020],
      ['grad_norm', 7_500],
      ['loss', 10_000],
    ]);
    expect(issuesOf('run-18', 'nan')).toEqual([]);
    const { summaries, view } = resultOf('run-18');
    for (const m of METRICS) expect(summaries[m].counts.nan).toBe(0);
    expect(summaries.lr.counts.missing).toBe(3);
    expect(view.metrics.lr.nonFinite.map((s) => s.kind)).toEqual(['missing', 'missing', 'missing']);
    expect(valueAt(view, 'loss', positionOfStep('run-18', 10_000))).toBeNull();
  });
});

describe('step ordering', () => {
  it('run-16: out-of-order records are detected where they occur, with source indices', () => {
    const { diagnostics } = resultOf('run-16');
    expect(diagnostics.isSorted).toBe(false);
    const unsorted = issuesOf('run-16', 'unsorted_step');
    expect(unsorted.map((i) => [i.previousStep, i.step])).toEqual([
      [5_490, 5_000],
      [11_500, 11_000],
    ]);
    for (const issue of unsorted) expect(runOf('run-16').points[issue.sourceIndex]?.step).toBe(issue.step);
  });

  it.each(IDS)('%s: display steps are strictly ascending numbers', (id) => {
    const steps = displaySteps(id);
    const notAscending = steps.filter((s, i) => i > 0 && s <= (steps[i - 1] ?? Number.NaN));
    expect(notAscending).toEqual([]);
  });

  it('only the runs with delayed records are unsorted', () => {
    const unsortedRuns = IDS.filter((id) => !resultOf(id).diagnostics.isSorted);
    expect(unsortedRuns).toEqual(['run-16', 'run-19']);
  });
});

describe('duplicate steps', () => {
  it('run-15: the identical double-write at step 12,000 is detected as non-conflicting', () => {
    const issue = issuesOf('run-15', 'duplicate_step').find((i) => i.step === 12_000);
    expect(issue?.conflictingMetrics).toEqual([]);
    expect(issue?.severity).toBe('info');
    expect(issue?.records).toHaveLength(2);
  });

  it('run-15: conflicting duplicates show the last-recorded value, never an average', () => {
    const conflicts = issuesOf('run-15', 'duplicate_step').filter((i) => i.conflictingMetrics.length > 0);
    expect(conflicts.map((i) => i.step)).toEqual(Array.from({ length: 50 }, (_, k) => 8_000 + k * 10));

    const { view } = resultOf('run-15');
    for (const issue of conflicts) {
      expect(issue.conflictingMetrics).toEqual(['loss', 'grad_norm']); // lr follows the same schedule
      const [first, second] = issue.records;
      const shown = valueAt(view, 'loss', positionOfStep('run-15', issue.step));
      expect(shown).toBe(second?.loss); // last recorded
      expect(shown).not.toBe(((first?.loss ?? 0) + (second?.loss ?? 0)) / 2);
      // Both raw records are preserved by reference, with their source indices.
      issue.records.forEach((record, k) => {
        expect(runOf('run-15').points[issue.sourceIndices[k] ?? -1]).toBe(record);
      });
      expect(issue.displayedSourceIndex).toBe(issue.sourceIndices.at(-1));
    }
  });

  it('run-15: counts distinct steps, duplicates and conflicts', () => {
    const { diagnostics } = resultOf('run-15');
    expect(diagnostics.totalRecords).toBe(2_051);
    expect(diagnostics.distinctSteps).toBe(2_000);
    expect(diagnostics.duplicateStepCount).toBe(51);
    expect(diagnostics.conflictingDuplicateCount).toBe(50);
  });
});

describe('traceability', () => {
  it.each(IDS)('%s: every raw record is displayed, a hidden duplicate, or an invalid step, exactly once', (id) => {
    const { view, diagnostics } = resultOf(id);
    const seen = new Array<number>(runOf(id).points.length).fill(0);
    const stepMismatches: number[] = [];
    view.displayIndex.forEach((si, p) => {
      seen[si] = (seen[si] ?? 0) + 1;
      if (runOf(id).points[si]?.step !== stepAt(view, p)) stepMismatches.push(p);
    });
    expect(stepMismatches).toEqual([]);
    for (const { issue } of view.duplicates) {
      for (const si of issue.sourceIndices) if (si !== issue.displayedSourceIndex) seen[si] = (seen[si] ?? 0) + 1;
    }
    for (const issue of diagnostics.issues) if (issue.kind === 'invalid_step') seen[issue.sourceIndex] = (seen[issue.sourceIndex] ?? 0) + 1;
    expect(seen.every((n) => n === 1)).toBe(true);
  });
});

describe('missing steps', () => {
  it('run-17: reports exactly the three outages with interval 10', () => {
    const gaps = issuesOf('run-17', 'missing_steps').map(({ afterStep, beforeStep, firstMissingStep, lastMissingStep, missingCount }) => ({
      afterStep, beforeStep, firstMissingStep, lastMissingStep, missingCount,
    }));
    expect(gaps).toEqual([
      { afterStep: 2_990, beforeStep: 4_000, firstMissingStep: 3_000, lastMissingStep: 3_990, missingCount: 100 },
      { afterStep: 12_490, beforeStep: 12_510, firstMissingStep: 12_500, lastMissingStep: 12_500, missingCount: 1 },
      { afterStep: 16_990, beforeStep: 19_000, firstMissingStep: 17_000, lastMissingStep: 18_990, missingCount: 200 },
    ]);
    expect(resultOf('run-17').diagnostics.missingStepCount).toBe(301);
  });

  it('interval-10 runs without outages report no missing steps (no 1-step assumption)', () => {
    const withGaps = IDS.filter((id) => resultOf(id).diagnostics.missingStepCount > 0);
    expect(withGaps).toEqual(['run-17', 'run-19']);
    expect(resultOf('run-19').diagnostics.missingStepCount).toBe(50);
    expect(resultOf('run-01').diagnostics.issues).toEqual([]);
  });

  it('the declared interval drives detection: the same data read as interval 1 has 9 missing steps per record', () => {
    const run = runOf('run-01');
    const asInterval1 = analyzeRun({ ...run, sampling: { kind: 'fixed', interval: 1 } });
    expect(asInterval1.diagnostics.missingStepCount).toBe(1_999 * 9);
    const asIrregular = analyzeRun({ ...run, sampling: { kind: 'irregular' } });
    expect(asIrregular.diagnostics.missingStepCount).toBe(0);
  });

  it('missing steps and missing values are distinct findings', () => {
    expect(resultOf('run-18').diagnostics.missingStepCount).toBe(0);
    expect(issuesOf('run-18', 'missing_value').length).toBeGreaterThan(0);
    expect(resultOf('run-17').diagnostics.missingStepCount).toBe(301);
    expect(issuesOf('run-17', 'missing_value')).toEqual([]);
  });
});

describe('chart continuity', () => {
  const segmentSteps = (id: string, metric: MetricKey) => {
    const { view } = resultOf(id);
    return view.metrics[metric].segments.map((s) => [stepAt(view, s.start), stepAt(view, s.end)]);
  };

  it('run-11: each NaN splits the loss line; lr stays one line', () => {
    expect(segmentSteps('run-11', 'loss')).toEqual([
      [0, 4_190],
      [4_210, 9_140],
      [9_160, 14_990],
      [15_010, 19_990],
    ]);
    expect(segmentSteps('run-11', 'lr')).toEqual([[0, 19_990]]);
  });

  it('run-17: every metric breaks at each outage instead of bridging it', () => {
    for (const m of METRICS) {
      expect(segmentSteps('run-17', m)).toEqual([
        [0, 2_990],
        [4_000, 12_490],
        [12_510, 16_990],
        [19_000, 19_990],
      ]);
    }
  });

  it('run-12: the loss line ends where the NaN tail begins', () => {
    expect(segmentSteps('run-12', 'loss')).toEqual([[0, 13_990]]);
    expect(resultOf('run-12').view.metrics.loss.nonFinite).toHaveLength(600);
  });

  it.each(IDS)('%s: no segment contains a non-finite value or spans a gap', (id) => {
    const { view } = resultOf(id);
    const gapAfter = new Set(view.gaps.map((g) => g.afterPosition));
    const violations: string[] = [];
    for (const m of METRICS) {
      for (const { start, end } of view.metrics[m].segments) {
        for (let p = start; p <= end; p++) {
          if (!Number.isFinite(valueAt(view, m, p))) violations.push(`${m}@${p} non-finite`);
          if (p < end && gapAfter.has(p)) violations.push(`${m}@${p} spans gap`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('summaries', () => {
  it.each(IDS)('%s: counts and min/max match a brute-force pass over raw finite values', (id) => {
    const { summaries, diagnostics } = resultOf(id);
    for (const m of METRICS) {
      const s = summaries[m];
      const c = s.counts;
      expect(c.finite + c.nan + c.positiveInfinity + c.negativeInfinity + c.missing).toBe(diagnostics.totalRecords);
      expect(s.invalidCount).toBe(c.nan + c.positiveInfinity + c.negativeInfinity);

      const finite = runOf(id).points.map((p) => p[m]).filter((v): v is number => v !== null && Number.isFinite(v));
      expect(c.finite).toBe(finite.length);
      expect(s.min?.value).toBe(finite.reduce((a, b) => Math.min(a, b)));
      expect(s.max?.value).toBe(finite.reduce((a, b) => Math.max(a, b)));
      expect(runOf(id).points[s.max?.sourceIndex ?? -1]?.[m]).toBe(s.max?.value);
    }
  });

  it('run-12: a run ending in NaN is visible in the summary and the diagnostics', () => {
    const { summaries } = resultOf('run-12');
    expect(summaries.loss.last?.kind).toBe('nan');
    expect(summaries.loss.endsNonFinite).toBe(true);
    expect(summaries.loss.lastFinite?.step).toBe(13_990);
    expect(issuesOf('run-12', 'non_finite_tail')).toEqual([
      { kind: 'non_finite_tail', severity: 'error', metric: 'loss', fromStep: 14_000, count: 600, lastValueKind: 'nan' },
    ]);
  });

  it('run-14: a run ending in +Infinity is visible in the summary and the diagnostics', () => {
    const { summaries } = resultOf('run-14');
    expect(summaries.loss.last?.value).toBe(Number.POSITIVE_INFINITY);
    expect(summaries.loss.endsNonFinite).toBe(true);
    expect(issuesOf('run-14', 'non_finite_tail')[0]).toMatchObject({ fromStep: 16_500, count: 350, lastValueKind: 'positive_infinity' });
  });

  it('run-01: a healthy run reports first/last finite values from the display view', () => {
    const { summaries, view } = resultOf('run-01');
    expect(summaries.loss.firstFinite).toEqual({ value: valueAt(view, 'loss', 0), step: 0, sourceIndex: 0 });
    expect(summaries.loss.last?.kind).toBe('finite');
    expect(summaries.loss.lastFinite?.step).toBe(19_990);
    expect(summaries.loss.endsNonFinite).toBe(false);
  });
});

describe('determinism', () => {
  it.each(IDS)('%s: analysing twice gives equal results', (id) => {
    expect(analyzeRun(runOf(id))).toEqual(resultOf(id));
  });
});
