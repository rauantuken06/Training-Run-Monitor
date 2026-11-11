import { beforeAll, describe, expect, it } from 'vitest';
import { getDefinition, samePoints } from '../../../test/dataTestUtils';
import { fixtureRun, pt } from '../../../test/integrityTestUtils';
import type { TrainingPoint, TrainingRunMetadata } from '../../../types/training';
import { LARGE_RUN_ID, LARGE_RUN_SPIKE, RUN_DEFINITIONS } from '../catalog/runCatalog';
import { generateRun } from '../generators/generateRun';
import { runMetadata } from '../generators/runDefinition';
import { analyzeRun, type RunIntegrity } from '../integrity/analyzeRun';
import { decodeRunPayload, encodeRunPayload, type LoadedRun, type RunPayload } from './runPayload';

/** What postMessage does: structured clone, with the listed buffers transferred (not copied). */
function roundTrip(runId: string, points: TrainingPoint[], analysis: RunIntegrity, metadata: TrainingRunMetadata): LoadedRun {
  const { payload, transfer } = encodeRunPayload(runId, points, analysis);
  const received = structuredClone<RunPayload>(payload, { transfer });
  // Transferred, not copied: the sender's buffers are detached.
  for (const buffer of transfer) expect(buffer.byteLength).toBe(0);
  return decodeRunPayload(received, metadata);
}

function expectSameAsMainThread(decoded: LoadedRun, points: TrainingPoint[], analysis: RunIntegrity) {
  expect(samePoints(decoded.run.points, points)).toBe(true);
  expect(decoded.analysis.view.points).toBe(decoded.run.points);
  expect(Array.from(decoded.analysis.view.displayIndex)).toEqual(Array.from(analysis.view.displayIndex));
  expect(decoded.analysis.summaries).toEqual(analysis.summaries);
  expect(decoded.analysis.view.metrics).toEqual(analysis.view.metrics);
  expect(decoded.analysis.view.gaps).toEqual(analysis.view.gaps);
  expect(decoded.analysis.diagnostics).toEqual(analysis.diagnostics);
  // Duplicate issues point at the rebuilt objects, and the view and diagnostics share them.
  for (const { issue } of decoded.analysis.view.duplicates) {
    issue.records.forEach((record, k) => {
      expect(record).toBe(decoded.run.points[issue.sourceIndices[k] ?? -1]);
    });
    expect(decoded.analysis.diagnostics.issues).toContain(issue);
  }
}

describe('worker payload: lossless and identical to the main-thread pipeline', () => {
  it.each(RUN_DEFINITIONS.filter((d) => d.metadata.id !== LARGE_RUN_ID).map((d) => d.metadata.id))('%s', (id) => {
    const def = getDefinition(id);
    const metadata = runMetadata(def);
    const points = generateRun(def);
    const analysis = analyzeRun({ ...metadata, points });
    // Encode from fresh copies: transferring detaches buffers, so the originals stay intact for comparison.
    const decoded = roundTrip(id, generateRun(def), analyzeRun({ ...metadata, points: generateRun(def) }), metadata);
    expectSameAsMainThread(decoded, points, analysis);
  });

  it('keeps NaN, +Infinity, -Infinity, -0, 0 and null distinct in every metric', () => {
    const raw = [
      pt(0, Number.NaN, null, Infinity),
      pt(10, null, Number.NaN, -Infinity),
      pt(20, -0, 0, null),
      pt(30, Infinity, -Infinity, Number.NaN),
      pt(Number.NaN, 5e-324, -1.7976931348623157e308, 3),
    ];
    const run = fixtureRun(raw);
    const metadata = { ...runMetadata(getDefinition('run-01')), id: 'fixture', sampling: run.sampling };
    const decoded = roundTrip('fixture', raw, analyzeRun(run), metadata);
    expect(samePoints(decoded.run.points, raw)).toBe(true);
    expect(decoded.run.points[1]?.loss).toBeNull();
    expect(Number.isNaN(decoded.run.points[0]?.loss)).toBe(true);
    expect(Object.is(decoded.run.points[2]?.loss, -0)).toBe(true);
    expect(Number.isNaN(decoded.run.points[4]?.step)).toBe(true);
  });
});

describe('worker payload: the million-point run', () => {
  let decoded: LoadedRun;
  let analysis: RunIntegrity;
  beforeAll(() => {
    const def = getDefinition(LARGE_RUN_ID);
    const metadata = runMetadata(def);
    const points = generateRun(def);
    analysis = analyzeRun({ ...metadata, points });
    decoded = roundTrip(LARGE_RUN_ID, points, analysis, metadata);
  });

  it('keeps all 1,000,000 points and the exact spike', () => {
    expect(decoded.run.points).toHaveLength(1_000_000);
    expect(decoded.run.points[LARGE_RUN_SPIKE.step]).toEqual({ step: LARGE_RUN_SPIKE.step, loss: LARGE_RUN_SPIKE.value, lr: expect.any(Number) as number, grad_norm: expect.any(Number) as number });
    expect(decoded.analysis.summaries.loss.max).toEqual({ value: 42.5, step: 500_123, sourceIndex: 500_123 });
    expect(decoded.analysis.summaries).toEqual(analysis.summaries);
    expect(decoded.analysis.view.displayIndex).toHaveLength(1_000_000);
  });
});
