import { createContext, useContext } from 'react';
import { analyzeRun, type RunIntegrity } from '../../data/integrity/analyzeRun';
import { runRepository, type RunRepository } from '../../data/repository/runRepository';
import type { TrainingRun } from '../../../types/training';

/**
 * Data dependencies of the runs UI. The default value uses the real repository,
 * so the app needs no provider. Tests provide their own (e.g. a repository with
 * controlled delays, or a spied `analyze`).
 */
export interface RunData {
  readonly repository: RunRepository;
  readonly analyze: (run: TrainingRun) => RunIntegrity;
}

const analysisCache = new WeakMap<TrainingRun, RunIntegrity>();

/**
 * `analyzeRun`, memoized per run *object*. The repository returns the same
 * immutable `TrainingRun` for repeated requests, so re-opening a run reuses
 * its analysis. A different run object is always analyzed fresh, so a cached
 * result can never belong to other data. Entries go away with the run object.
 */
export function analyzeRunCached(run: TrainingRun): RunIntegrity {
  let result = analysisCache.get(run);
  if (!result) {
    result = analyzeRun(run);
    analysisCache.set(run, result);
  }
  return result;
}

export const RunDataContext = createContext<RunData>({
  repository: runRepository,
  analyze: analyzeRunCached,
});

export function useRunData(): RunData {
  return useContext(RunDataContext);
}
