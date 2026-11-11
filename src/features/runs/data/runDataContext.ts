import { createContext, useContext } from 'react';
import { timed } from '../../../perf/userTiming';
import { analyzeRun, type RunIntegrity } from '../../data/integrity/analyzeRun';
import { runRepository, type RunRepository } from '../../data/repository/runRepository';
import type { TrainingRun } from '../../../types/training';
import { createWorkerRunLoader, type RunLoader } from './workerRunLoader';

/**
 * Data dependencies of the runs UI. The default value uses the real repository,
 * so the app needs no provider. Tests provide their own (e.g. a repository with
 * controlled delays, or a spied `analyze`).
 *
 * `loadRun`, when present, loads and analyzes a run off the main thread (Web
 * Worker); the app's default uses it whenever `Worker` exists. Without it, the
 * UI uses `repository.getRun` + `analyze` on the main thread, which is what
 * tests that supply their own repository exercise.
 */
export interface RunData {
  readonly repository: RunRepository;
  readonly analyze: (run: TrainingRun) => RunIntegrity;
  readonly loadRun?: RunLoader;
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
    result = timed(`analyze:${run.id}`, () => analyzeRun(run));
    analysisCache.set(run, result);
  }
  return result;
}

const defaultData: RunData =
  typeof Worker === 'function'
    ? { repository: runRepository, analyze: analyzeRunCached, loadRun: createWorkerRunLoader(runRepository) }
    : { repository: runRepository, analyze: analyzeRunCached };

export const RunDataContext = createContext<RunData>(defaultData);

export function useRunData(): RunData {
  return useContext(RunDataContext);
}
