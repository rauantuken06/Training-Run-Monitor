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
 * - Note: `getRun` returns a Promise, but generation and analysis are
 *   synchronous work on the main thread. The yield lets the loading state paint
 *   first; it does not stop the UI from blocking while the work runs.
 */
export function useRunAnalysis(runId: string): { state: RunAnalysisState; retry: () => void } {
  const { repository, analyze } = useRunData();
  const [state, setState] = useState<RunAnalysisState>({ status: 'loading', runId });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Read through a function: `active` is flipped by the cleanup below, after an `await`.
    const isActive = () => active;
    setState({ status: 'loading', runId });

    void (async () => {
      await yieldToBrowser();
      if (!isActive()) return;
      try {
        const run = await repository.getRun(runId);
        if (!isActive()) return;
        if (!run) {
          setState({ status: 'not_found', runId });
          return;
        }
        const analysis = analyze(run);
        if (isActive()) setState({ status: 'ready', runId, run, analysis });
      } catch (error: unknown) {
        if (isActive()) setState({ status: 'error', runId, error });
      }
    })();

    return () => {
      active = false;
    };
  }, [repository, analyze, runId, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const current: RunAnalysisState = state.runId === runId ? state : { status: 'loading', runId };
  return { state: current, retry };
}
