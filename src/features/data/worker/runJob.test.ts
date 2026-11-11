import { describe, expect, it } from 'vitest';
import { getDefinition } from '../../../test/dataTestUtils';
import { runJob } from './runJob';

describe('runJob (the code the worker runs)', () => {
  it('returns payload null for an unknown run ID', () => {
    expect(runJob({ jobId: 1, runId: 'nope' })).toEqual({ response: { jobId: 1, ok: true, payload: null }, transfer: [] });
  });

  it('reports a failure as an error response instead of throwing', () => {
    const def = getDefinition('run-01');
    const broken = { ...def, anomalies: { valueOverrides: [{ step: 15, metric: 'loss' as const, value: Number.NaN }] } };
    const { response } = runJob({ jobId: 7, runId: 'run-01' }, [broken]);
    expect(response).toEqual({ jobId: 7, ok: false, error: 'Run run-01: step 15 is not on the base grid' });
  });

  it('is deterministic and transfers six buffers', () => {
    const a = runJob({ jobId: 1, runId: 'run-19' });
    const b = runJob({ jobId: 2, runId: 'run-19' });
    expect(a.transfer).toHaveLength(6);
    if (!a.response.ok || !b.response.ok || !a.response.payload || !b.response.payload) throw new Error('job failed');
    expect(Array.from(a.response.payload.columns.loss)).toEqual(Array.from(b.response.payload.columns.loss));
    expect(a.response.payload.analysis.diagnostics).toEqual(b.response.payload.analysis.diagnostics);
  });
});
