import { useCallback, useEffect, useState } from 'react';
import type { RunIntegrity } from '../../data/integrity/analyzeRun';
import type { TrainingRun } from '../../../types/training';
import { useRunData } from '../data/runDataContext';

export type RunAnalysisState =
  | { readonly status: 'loading'; readonly runId: string }
  | { readonly status: 'ready'; readonly runId: string; readonly run: TrainingRun; readonly analysis: RunIntegrity }
  | { readonly status: 'not_found'; readonly runId: string }
  | { readonly status: 'error'; readonly runId: string; readonly error: unknown };

/**
 * Let the browser paint (e.g. the loading state) before synchronous work starts.
 * A bare `setTimeout(0)` can run before the next frame. Scheduling the timer from
 * inside `requestAnimationFrame` makes it run after that frame has been painted.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Load one run's points and analyze them with the Task 03 engine.
 *
 * - Stale responses are ignored: each effect run has its own `active` flag, and
 *   a state that belongs to another run ID is never returned. Switching runs
 *   quickly therefore cannot show the previous run's data.
 * - Analysis happens once per load, in the effect, not during render, so
 *   unrelated re-renders never re-analyze.
 * - With `loadRun` (the app default when Web Workers exist), generation and
 *   analysis run in a worker; leaving the run cancels that job (the worker is
 *   terminated). Only decoding the transferred result runs on the main thread.
 * - Without `loadRun` (tests that supply a repository), `getRun` + `analyze` run
 *   on the main thread: `getRun` returns a Promise, but that work is synchronous
 *   and blocks the UI while it runs. The yield lets the loading state paint first.
 */
export function useRunAnalysis(runId: string): { state: RunAnalysisState; retry: () => void } {
  const { repository, analyze, loadRun } = useRunData();
  const [state, setState] = useState<RunAnalysisState>({ status: 'loading', runId });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Read through a function: `active` is flipped by the cleanup below, after an `await`.
    const isActive = () => active;
    let cancelJob: (() => void) | null = null;
    setState({ status: 'loading', runId });

    void (async () => {
      await yieldToBrowser();
      if (!isActive()) return;
      try {
        let loaded: { run: TrainingRun; analysis: RunIntegrity } | undefined;
        if (loadRun) {
          const job = loadRun.load(runId);
          cancelJob = job.cancel;
          loaded = await job.promise;
        } else {
          const run = await repository.getRun(runId);
          if (!isActive()) return;
          loaded = run ? { run, analysis: analyze(run) } : undefined;
        }
        if (!isActive()) return;
        if (!loaded) {
          setState({ status: 'not_found', runId });
          return;
        }
        setState({ status: 'ready', runId, run: loaded.run, analysis: loaded.analysis });
      } catch (error: unknown) {
        if (isActive()) setState({ status: 'error', runId, error });
      }
    })();

    return () => {
      active = false;
      cancelJob?.();
    };
  }, [repository, analyze, loadRun, runId, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const current: RunAnalysisState = state.runId === runId ? state : { status: 'loading', runId };
  return { state: current, retry };
}
