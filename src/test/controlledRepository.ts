import { createRunRepository, type RunRepository } from '../features/data/repository/runRepository';
import type { TrainingRun } from '../types/training';

interface Pending {
  readonly runId: string;
  readonly resolve: (run: TrainingRun | undefined) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * A repository over the real catalog whose `getRun` calls stay pending until
 * the test resolves or rejects them, in any order. Metadata calls are passed
 * through unchanged. Lets UI tests control loading order and timing
 * deterministically, with real data.
 */
export function createControlledRepository(base: RunRepository = createRunRepository()) {
  const pending: Pending[] = [];
  const getRunCalls: string[] = [];

  const repository: RunRepository = {
    listRuns: () => base.listRuns(),
    getRunMetadata: (runId) => base.getRunMetadata(runId),
    isGenerated: (runId) => base.isGenerated(runId),
    getRun: (runId) => {
      getRunCalls.push(runId);
      return new Promise<TrainingRun | undefined>((resolve, reject) => {
        pending.push({ runId, resolve, reject });
      });
    },
  };

  function take(runId: string): Pending {
    const index = pending.findIndex((p) => p.runId === runId);
    const found = pending[index];
    if (!found) throw new Error(`No pending getRun("${runId}")`);
    pending.splice(index, 1);
    return found;
  }

  return {
    repository,
    getRunCalls,
    isPending: (runId: string) => pending.some((p) => p.runId === runId),
    /** Resolve the oldest pending request for `runId` with the real run data. */
    async resolve(runId: string) {
      const p = take(runId);
      p.resolve(await base.getRun(runId));
    },
    reject(runId: string, error: unknown) {
      take(runId).reject(error);
    },
  };
}
