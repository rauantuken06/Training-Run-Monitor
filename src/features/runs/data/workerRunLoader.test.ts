import { describe, expect, it, vi } from 'vitest';
import { getDefinition, samePoints } from '../../../test/dataTestUtils';
import { createRunRepository } from '../../data/repository/runRepository';
import { generateRun } from '../../data/generators/generateRun';
import { runJob, type RunJobRequest, type RunJobResponse } from '../../data/worker/runJob';
import { createWorkerRunLoader, RunLoadCancelledError, WORKER_TIMEOUT_MS, type WorkerLike } from './workerRunLoader';

/** A Worker stand-in that runs the real job code when the test says so. */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<RunJobResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: RunJobRequest | null = null;
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: RunJobRequest) {
    this.request = message;
  }
  terminate() {
    this.terminated = true;
  }
  /** Deliver the real job's result (structured clone with transfer, as postMessage does). */
  respond(override?: RunJobResponse) {
    if (!this.request) throw new Error('no request');
    const { response, transfer } = runJob(this.request);
    const data = structuredClone(override ?? response, { transfer: override ? [] : transfer });
    this.onmessage?.({ data } as MessageEvent<RunJobResponse>);
  }
  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function setup() {
  FakeWorker.all = [];
  const loader = createWorkerRunLoader(createRunRepository(), () => new FakeWorker());
  return { loader, workers: FakeWorker.all };
}

describe('createWorkerRunLoader', () => {
  it('loads a run in a worker, decodes it exactly, and terminates the worker', async () => {
    const { loader, workers } = setup();
    const job = loader.load('run-15');
    expect(workers).toHaveLength(1);
    expect(workers[0]?.request).toEqual({ jobId: 1, runId: 'run-15' });
    workers[0]?.respond();
    const loaded = await job.promise;
    expect(samePoints(loaded?.run.points ?? [], generateRun(getDefinition('run-15')))).toBe(true);
    expect(loaded?.run.name).toBe('duplicate-steps-multi-rank-logging');
    expect(loaded?.analysis.diagnostics.conflictingDuplicateCount).toBe(50);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('resolves unknown IDs without starting a worker', async () => {
    const { loader, workers } = setup();
    await expect(loader.load('nope').promise).resolves.toBeUndefined();
    expect(workers).toHaveLength(0);
  });

  it('reuses a successful result instead of starting another worker', async () => {
    const { loader, workers } = setup();
    const first = loader.load('run-01');
    workers[0]?.respond();
    const a = await first.promise;
    const b = await loader.load('run-01').promise;
    expect(b).toBe(a);
    expect(workers).toHaveLength(1);
  });

  it('cancelling terminates the worker, rejects, is not cached, and ignores a late result', async () => {
    const { loader, workers } = setup();
    const job = loader.load('run-12');
    const worker = workers[0];
    job.cancel();
    expect(worker?.terminated).toBe(true);
    await expect(job.promise).rejects.toBeInstanceOf(RunLoadCancelledError);
    expect(worker?.onmessage).toBeNull(); // a late message has nowhere to go
    const again = loader.load('run-12');
    expect(workers).toHaveLength(2);
    workers[1]?.respond();
    await expect(again.promise).resolves.toBeDefined();
  });

  it('turns a posted error into a rejection, does not cache it, and allows a retry', async () => {
    const { loader, workers } = setup();
    const job = loader.load('run-01');
    workers[0]?.respond({ jobId: 1, ok: false, error: 'out of memory' });
    await expect(job.promise).rejects.toThrow('Run worker failed: out of memory');
    expect(workers[0]?.terminated).toBe(true);
    const retry = loader.load('run-01');
    expect(workers).toHaveLength(2);
    workers[1]?.respond();
    await expect(retry.promise).resolves.toBeDefined();
  });

  it('regression: a worker that never answers is terminated after the timeout, and Retry can succeed', async () => {
    vi.useFakeTimers();
    try {
      FakeWorker.all = [];
      const loader = createWorkerRunLoader(createRunRepository(), () => new FakeWorker(), 5_000);
      const job = loader.load('run-17');
      const rejection = expect(job.promise).rejects.toThrow('Run worker did not respond within 5 s');
      vi.advanceTimersByTime(4_999);
      expect(FakeWorker.all[0]?.terminated).toBe(false);
      vi.advanceTimersByTime(1);
      await rejection;
      expect(FakeWorker.all[0]?.terminated).toBe(true);
      expect(FakeWorker.all[0]?.onmessage).toBeNull(); // a very late answer is ignored

      const retry = loader.load('run-17'); // not cached: a new worker
      expect(FakeWorker.all).toHaveLength(2);
      FakeWorker.all[1]?.respond();
      vi.advanceTimersByTime(10_000); // the answered job's watchdog was cleared
      await expect(retry.promise).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a 60 s default timeout', () => {
    expect(WORKER_TIMEOUT_MS).toBe(60_000);
  });

  it('turns a worker crash into a rejection', async () => {
    const { loader, workers } = setup();
    const job = loader.load('run-01');
    workers[0]?.crash('script error');
    await expect(job.promise).rejects.toThrow('Run worker crashed: script error');
    expect(workers[0]?.terminated).toBe(true);
  });
});
