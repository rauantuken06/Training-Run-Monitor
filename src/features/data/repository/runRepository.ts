import type { TrainingPoint, TrainingRun, TrainingRunMetadata } from '../../../types/training';
import { timed } from '../../../perf/userTiming';
import { RUN_DEFINITIONS } from '../catalog/runCatalog';
import { generateRun } from '../generators/generateRun';
import { runMetadata, type RunDefinition } from '../generators/runDefinition';

/** Read access to training runs. The UI depends on this interface, not on generators. */
export interface RunRepository {
  /** Metadata for all runs. Never generates points. */
  listRuns(): readonly TrainingRunMetadata[];
  /** Metadata for one run, or `undefined` if the ID is unknown. Never generates points. */
  getRunMetadata(runId: string): TrainingRunMetadata | undefined;
  /**
   * The full run with raw points, or `undefined` if the ID is unknown.
   * Points are generated on first request and cached, so later calls return
   * the same array. Treat it as read-only.
   */
  getRun(runId: string): Promise<TrainingRun | undefined>;
  /** Whether a run's points have already been generated and cached. */
  isGenerated(runId: string): boolean;
}

export interface RunRepositoryOptions {
  definitions?: readonly RunDefinition[];
  /** Injectable for tests (e.g. a spy). Defaults to `generateRun`. */
  generate?: (def: RunDefinition) => TrainingPoint[];
}

/**
 * In-memory repository over the synthetic catalog.
 *
 * - Lazy: nothing is generated until `getRun` is called for that run.
 * - Cached: each run is generated at most once per repository. Concurrent
 *   requests share one in-flight promise. A failed generation is not cached.
 * - The cache is never evicted, so the million-point run stays in memory
 *   once it has been requested.
 */
export function createRunRepository(options: RunRepositoryOptions = {}): RunRepository {
  const definitions = options.definitions ?? RUN_DEFINITIONS;
  const generate = options.generate ?? generateRun;

  const byId = new Map<string, { def: RunDefinition; metadata: TrainingRunMetadata }>();
  for (const def of definitions) {
    if (byId.has(def.metadata.id)) {
      throw new Error(`Duplicate run ID in catalog: ${def.metadata.id}`);
    }
    byId.set(def.metadata.id, { def, metadata: runMetadata(def) });
  }
  const metadataList = [...byId.values()].map((entry) => entry.metadata);

  const inFlight = new Map<string, Promise<TrainingRun>>();
  const generated = new Set<string>();

  return {
    listRuns: () => metadataList,
    getRunMetadata: (runId) => byId.get(runId)?.metadata,
    isGenerated: (runId) => generated.has(runId),
    getRun(runId) {
      const entry = byId.get(runId);
      if (!entry) return Promise.resolve(undefined);

      const cached = inFlight.get(runId);
      if (cached) return cached;

      const pending = Promise.resolve().then(() => {
        const points = timed(`generate:${runId}`, () => generate(entry.def));
        generated.add(runId);
        return { ...entry.metadata, points };
      });
      inFlight.set(runId, pending);
      pending.catch(() => inFlight.delete(runId));
      return pending;
    },
  };
}

/** App-wide repository instance. Creating it generates nothing. */
export const runRepository: RunRepository = createRunRepository();
