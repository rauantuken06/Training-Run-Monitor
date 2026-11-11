/**
 * useRunAnalysis with a worker loader (the app's default path in browsers):
 * stale results, cancellation and errors. Jobs settle only when the test says so.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createRunRepository } from '../../data/repository/runRepository';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import type { LoadedRun } from '../../data/worker/runPayload';
import { RunDataContext } from '../data/runDataContext';
import type { RunLoader } from '../data/workerRunLoader';
import { useRunAnalysis } from './useRunAnalysis';

const repository = createRunRepository();

interface ControlledJob {
  runId: string;
  cancelled: boolean;
  resolve: (value: LoadedRun | undefined) => void;
  reject: (error: unknown) => void;
}

function controlledLoader() {
  const jobs: ControlledJob[] = [];
  const loader: RunLoader = {
    load(runId) {
      let resolve: ControlledJob['resolve'] = () => undefined;
      let reject: ControlledJob['reject'] = () => undefined;
      const promise = new Promise<LoadedRun | undefined>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const job: ControlledJob = { runId, cancelled: false, resolve, reject };
      jobs.push(job);
      return {
        promise,
        cancel: () => {
          job.cancelled = true;
        },
      };
    },
  };
  return { loader, jobs };
}

async function loaded(runId: string): Promise<LoadedRun> {
  const run = await repository.getRun(runId);
  if (!run) throw new Error('no run');
  return { run, analysis: analyzeRun(run) };
}

function setup(runId: string) {
  const { loader, jobs } = controlledLoader();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RunDataContext.Provider value={{ repository, analyze: analyzeRun, loadRun: loader }}>{children}</RunDataContext.Provider>
  );
  const hook = renderHook(({ id }: { id: string }) => useRunAnalysis(id), { wrapper, initialProps: { id: runId } });
  return { hook, jobs };
}

describe('useRunAnalysis with a worker loader', () => {
  it('cancels the superseded job and ignores its late result', async () => {
    const { hook, jobs } = setup('run-11');
    await waitFor(() => {
      expect(jobs).toHaveLength(1);
    });
    hook.rerender({ id: 'run-12' });
    await waitFor(() => {
      expect(jobs).toHaveLength(2);
    });
    expect(jobs[0]?.cancelled).toBe(true);

    await act(async () => {
      jobs[0]?.resolve(await loaded('run-11')); // arrives late anyway
    });
    expect(hook.result.current.state).toEqual({ status: 'loading', runId: 'run-12' });

    const run12 = await loaded('run-12');
    await act(async () => {
      jobs[1]?.resolve(run12);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.state.status).toBe('ready');
    });
    const state = hook.result.current.state;
    expect(state.status === 'ready' && state.run.id).toBe('run-12');
    expect(state.status === 'ready' && state.analysis).toBe(run12.analysis); // no re-analysis on the main thread
  });

  it('shows a worker failure as the error state', async () => {
    const { hook, jobs } = setup('run-01');
    await waitFor(() => {
      expect(jobs).toHaveLength(1);
    });
    act(() => {
      jobs[0]?.reject(new Error('Run worker crashed: script error'));
    });
    await waitFor(() => {
      expect(hook.result.current.state.status).toBe('error');
    });
    const state = hook.result.current.state;
    expect(state.status === 'error' && (state.error as Error).message).toBe('Run worker crashed: script error');
  });

  it('reports unknown runs as not_found', async () => {
    const { hook, jobs } = setup('run-01');
    await waitFor(() => {
      expect(jobs).toHaveLength(1);
    });
    act(() => {
      jobs[0]?.resolve(undefined);
    });
    await waitFor(() => {
      expect(hook.result.current.state).toEqual({ status: 'not_found', runId: 'run-01' });
    });
  });

  it('cancels the running job on unmount', async () => {
    const { hook, jobs } = setup('run-20');
    await waitFor(() => {
      expect(jobs).toHaveLength(1);
    });
    hook.unmount();
    expect(jobs[0]?.cancelled).toBe(true);
  });
});
