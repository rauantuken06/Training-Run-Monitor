/**
 * Hook-level stale-response tests. The details page remounts per run (`key`),
 * which already hides stale updates there, so these tests change `runId` on a
 * single mounted hook to exercise the hook's own guard.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createControlledRepository } from '../../../test/controlledRepository';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { RunDataContext } from '../data/runDataContext';
import { useRunAnalysis } from './useRunAnalysis';

function setup(initialRunId: string) {
  const c = createControlledRepository();
  const analyze = vi.fn(analyzeRun);
  /** Every render's (prop, returned state) pair, to catch even a single stale render. */
  const renders: { runId: string; stateRunId: string; status: string }[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RunDataContext.Provider value={{ repository: c.repository, analyze }}>{children}</RunDataContext.Provider>
  );
  const hook = renderHook(
    ({ runId }: { runId: string }) => {
      const result = useRunAnalysis(runId);
      renders.push({ runId, stateRunId: result.state.runId, status: result.state.status });
      return result;
    },
    { wrapper, initialProps: { runId: initialRunId } },
  );
  return { c, analyze, hook, renders };
}

describe('useRunAnalysis', () => {
  it('ignores a slower response for a previous run ID', async () => {
    const { c, analyze, hook } = setup('run-11');
    await waitFor(() => {
      expect(c.isPending('run-11')).toBe(true);
    });

    hook.rerender({ runId: 'run-12' });
    expect(hook.result.current.state).toEqual({ status: 'loading', runId: 'run-12' });
    await waitFor(() => {
      expect(c.isPending('run-12')).toBe(true);
    });

    await act(() => c.resolve('run-11')); // stale
    expect(hook.result.current.state).toEqual({ status: 'loading', runId: 'run-12' });
    expect(analyze).not.toHaveBeenCalled();

    await act(() => c.resolve('run-12'));
    await waitFor(() => {
      expect(hook.result.current.state.status).toBe('ready');
    });
    const state = hook.result.current.state;
    expect(state.status === 'ready' && state.run.id).toBe('run-12');
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale error for a previous run ID', async () => {
    const { c, hook } = setup('run-01');
    await waitFor(() => {
      expect(c.isPending('run-01')).toBe(true);
    });
    hook.rerender({ runId: 'run-02' });
    act(() => {
      c.reject('run-01', new Error('old failure'));
    });
    await waitFor(() => {
      expect(c.isPending('run-02')).toBe(true);
    });
    expect(hook.result.current.state).toEqual({ status: 'loading', runId: 'run-02' });
  });

  it('never returns a state belonging to another run ID, even for one render', async () => {
    const { c, hook, renders } = setup('run-01');
    await waitFor(() => {
      expect(c.isPending('run-01')).toBe(true);
    });
    await act(() => c.resolve('run-01'));
    await waitFor(() => {
      expect(hook.result.current.state.status).toBe('ready');
    });

    hook.rerender({ runId: 'run-03' });
    // The render right after the ID change happens before the effect resets state.
    // In a browser that render can be painted, so it must already say "loading run-03".
    const mismatched = renders.filter((r) => r.stateRunId !== r.runId);
    expect(mismatched).toEqual([]);
    expect(renders.some((r) => r.runId === 'run-03' && r.status === 'loading')).toBe(true);
  });

  it('reports not_found when the repository has no data for the ID', async () => {
    const { c, hook } = setup('ghost');
    await waitFor(() => {
      expect(c.getRunCalls).toEqual(['ghost']);
    });
    expect(hook.result.current.state).toEqual({ status: 'loading', runId: 'ghost' });
    await act(() => c.resolve('ghost'));
    await waitFor(() => {
      expect(hook.result.current.state).toEqual({ status: 'not_found', runId: 'ghost' });
    });
  });
});
