import { timed } from '../../../perf/userTiming';
import type { RunRepository } from '../../data/repository/runRepository';
import type { RunJobRequest, RunJobResponse } from '../../data/worker/runJob';
import { decodeRunPayload, type LoadedRun } from '../../data/worker/runPayload';

/** The subset of the Worker API the loader uses (so tests can provide a fake). */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<RunJobResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RunJobRequest): void;
  terminate(): void;
}

export interface RunLoadJob {
  readonly promise: Promise<LoadedRun | undefined>;
  /** Stop the job if it is still running (terminates its worker). No effect once settled. */
  readonly cancel: () => void;
}

export interface RunLoader {
  load(runId: string): RunLoadJob;
}

export class RunLoadCancelledError extends Error {
  override name = 'RunLoadCancelledError';
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('../../data/worker/run.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Loads runs in a Web Worker: generation and analysis run off the main thread,
 * and only decoding (rebuilding point objects from transferred columns) runs on it.
 *
 * - One worker per job, terminated when the job settles or is cancelled, so a
 *   superseded load stops using CPU and no data stays in a worker.
 * - Successful results are cached per run ID (the catalog is immutable), the same
 *   policy as the repository's cache. Failed or cancelled jobs are not cached.
 * - Worker errors (posted errors and crashes) reject the promise, which the UI shows
 *   as its error state.
 * - A worker that never answers (e.g. its script request hangs) is terminated after
 *   `timeoutMs` and the job rejects, so the page cannot sit on "Loading…" forever.
 *   Found in the Task 09 QA run: one Chrome e2e run left pages loading for 30+ s with
 *   no error. The default is far above the slowest measured job (~2 s at 4x throttling).
 */
export const WORKER_TIMEOUT_MS = 60_000;

export function createWorkerRunLoader(
  repository: Pick<RunRepository, 'getRunMetadata'>,
  createWorker: () => WorkerLike = defaultCreateWorker,
  timeoutMs: number = WORKER_TIMEOUT_MS,
): RunLoader {
  const cache = new Map<string, Promise<LoadedRun | undefined>>();
  let nextJobId = 1;

  return {
    load(runId) {
      const metadata = repository.getRunMetadata(runId);
      if (!metadata) return { promise: Promise.resolve(undefined), cancel: () => undefined };
      const cached = cache.get(runId);
      if (cached) return { promise: cached, cancel: () => undefined };

      const worker = createWorker();
      const jobId = nextJobId++;
      let settled = false;
      let rejectJob: (error: unknown) => void = () => undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        settled = true;
        clearTimeout(watchdog);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      };

      const promise = new Promise<LoadedRun | undefined>((resolve, reject) => {
        rejectJob = reject;
        worker.onmessage = (event) => {
          const response = event.data;
          if (response.jobId !== jobId) return; // not ours (cannot happen with one job per worker)
          finish();
          if (!response.ok) {
            reject(new Error(`Run worker failed: ${response.error}`));
            return;
          }
          try {
            resolve(response.payload ? timed(`decode:${runId}`, () => decodeRunPayload(response.payload as NonNullable<typeof response.payload>, metadata)) : undefined);
          } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        worker.onerror = (event) => {
          finish();
          reject(new Error(`Run worker crashed: ${event.message || 'unknown error'}`));
        };
        watchdog = setTimeout(() => {
          finish();
          reject(new Error(`Run worker did not respond within ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        worker.postMessage({ jobId, runId });
      });

      cache.set(runId, promise);
      promise.catch(() => {
        if (cache.get(runId) === promise) cache.delete(runId);
      });

      return {
        promise,
        cancel: () => {
          if (settled) return;
          finish();
          if (cache.get(runId) === promise) cache.delete(runId);
          rejectJob(new RunLoadCancelledError(`Loading ${runId} was cancelled`));
        },
      };
    },
  };
}
