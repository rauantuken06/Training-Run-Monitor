import { describe, expect, it, vi } from 'vitest';
import { getDefinition } from '../../../test/dataTestUtils';
import type { TrainingPoint } from '../../../types/training';
import { LARGE_RUN_ID, RUN_DEFINITIONS } from '../catalog/runCatalog';
import { generateRun } from '../generators/generateRun';
import type { RunDefinition } from '../generators/runDefinition';
import { createRunRepository, runRepository } from './runRepository';

function spyRepository() {
  const generate = vi.fn((def: RunDefinition): TrainingPoint[] => generateRun(def));
  return { repo: createRunRepository({ generate }), generate };
}

describe('runRepository (lazy loading)', () => {
  it('lists 20 runs with metadata without generating any points', () => {
    const { repo, generate } = spyRepository();
    const runs = repo.listRuns();
    expect(runs).toHaveLength(20);
    expect(runs.map((r) => r.id)).toEqual(RUN_DEFINITIONS.map((d) => d.metadata.id));
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports the million-point count from metadata alone, without generating it', () => {
    const { repo, generate } = spyRepository();
    expect(repo.getRunMetadata(LARGE_RUN_ID)?.pointCount).toBe(1_000_000);
    expect(repo.isGenerated(LARGE_RUN_ID)).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('the app-wide repository has generated nothing at import time', () => {
    runRepository.listRuns();
    for (const run of runRepository.listRuns()) {
      expect(runRepository.isGenerated(run.id), run.id).toBe(false);
    }
  });

  it('returns undefined for unknown IDs without generating anything', async () => {
    const { repo, generate } = spyRepository();
    expect(repo.getRunMetadata('nope')).toBeUndefined();
    await expect(repo.getRun('nope')).resolves.toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates only the requested run', async () => {
    const { repo, generate } = spyRepository();
    const run = await repo.getRun('run-03');
    expect(run?.points).toHaveLength(run?.pointCount ?? -1);
    expect(run?.name).toBe(getDefinition('run-03').metadata.name);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repo.isGenerated('run-03')).toBe(true);
    expect(repo.isGenerated('run-01')).toBe(false);
  });

  it('generates the million-point run once and returns the cached array on repeated access', async () => {
    const { repo, generate } = spyRepository();
    const first = await repo.getRun(LARGE_RUN_ID);
    const second = await repo.getRun(LARGE_RUN_ID);
    expect(first?.points).toHaveLength(1_000_000);
    expect(second?.points).toBe(first?.points);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('shares one generation between concurrent requests', async () => {
    const { repo, generate } = spyRepository();
    const [a, b] = await Promise.all([repo.getRun('run-01'), repo.getRun('run-01')]);
    expect(a).toBe(b);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed generation', async () => {
    const generate = vi
      .fn((def: RunDefinition): TrainingPoint[] => generateRun(def))
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    const repo = createRunRepository({ generate });
    await expect(repo.getRun('run-01')).rejects.toThrow('boom');
    expect(repo.isGenerated('run-01')).toBe(false);
    await expect(repo.getRun('run-01')).resolves.toBeDefined();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('rejects a catalog with duplicate IDs', () => {
    const def = getDefinition('run-01');
    expect(() => createRunRepository({ definitions: [def, def] })).toThrow(/Duplicate run ID/);
  });
});
