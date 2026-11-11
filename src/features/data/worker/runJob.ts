import { timed } from '../../../perf/userTiming';
import { RUN_DEFINITIONS } from '../catalog/runCatalog';
import { generateRun } from '../generators/generateRun';
import { runMetadata, type RunDefinition } from '../generators/runDefinition';
import { analyzeRun } from '../integrity/analyzeRun';
import { encodeRunPayload, type RunPayload } from './runPayload';

export interface RunJobRequest {
  readonly jobId: number;
  readonly runId: string;
}

export type RunJobResponse =
  | { readonly jobId: number; readonly ok: true; readonly payload: RunPayload | null }
  | { readonly jobId: number; readonly ok: false; readonly error: string };

/**
 * The work done inside the Web Worker: generate one run, analyze it with the
 * Task 03 engine, and encode the result for transfer. Pure, so it is unit-tested
 * directly. `payload: null` means the run ID is unknown.
 */
export function runJob(
  request: RunJobRequest,
  definitions: readonly RunDefinition[] = RUN_DEFINITIONS,
): { response: RunJobResponse; transfer: ArrayBuffer[] } {
  try {
    const def = definitions.find((d) => d.metadata.id === request.runId);
    if (!def) return { response: { jobId: request.jobId, ok: true, payload: null }, transfer: [] };
    const points = timed(`generate:${request.runId}`, () => generateRun(def));
    const analysis = timed(`analyze:${request.runId}`, () =>
      analyzeRun({ id: def.metadata.id, sampling: runMetadata(def).sampling, points }),
    );
    const { payload, transfer } = timed(`encode:${request.runId}`, () => encodeRunPayload(request.runId, points, analysis));
    return { response: { jobId: request.jobId, ok: true, payload }, transfer };
  } catch (error: unknown) {
    return {
      response: { jobId: request.jobId, ok: false, error: error instanceof Error ? error.message : String(error) },
      transfer: [],
    };
  }
}
